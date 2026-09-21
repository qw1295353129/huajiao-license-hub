import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, count, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { CONFIG_TOKEN, type AppConfig } from '../../config/configuration';
import { DB } from '../../db/db.module';
import type { DatabaseHandle } from '../../db/db.provider';
import { licenseEvents, licenses, products, redeemCodes, verificationLogs, webhookDeliveries } from '../../db/schema';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { TokenService } from '../auth/token.service';
import { WebhooksService } from '../webhooks/webhooks.service';

export interface TaskResult {
  task: string;
  detail: Record<string, number>;
}

/**
 * 后台定时任务。
 * 设计原则：可重复执行且幂等；同时提供手动触发入口（POST /api/admin/tasks/run），
 * 便于运维排查与端到端测试，不必等到凌晨 3 点。
 */
@Injectable()
export class TasksService {
  private readonly logger = new Logger('Tasks');
  private running = false;

  constructor(
    @Inject(DB) private readonly handle: DatabaseHandle,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
    private readonly mail: NotificationsService,
    private readonly settings: SettingsService,
    private readonly tokens: TokenService,
    private readonly webhooks: WebhooksService,
  ) {}

  private get db() {
    return this.handle.db;
  }

  /* ------------------------------------------------ 到期处理（每 10 分钟） */

  @Cron('*/10 * * * *', { name: 'expire-licenses' })
  async expireLicenses(): Promise<TaskResult> {
    const expired = await this.db.update(licenses)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(and(
        isNotNull(licenses.expiresAt),
        lt(licenses.expiresAt, new Date()),
        inArray(licenses.status, ['issued', 'active', 'suspended']),
      ))
      .returning({
        id: licenses.id,
        customerEmail: licenses.customerEmail,
        keyMasked: licenses.keyMasked,
        expiresAt: licenses.expiresAt,
      });

    for (const row of expired) {
      await this.db.insert(licenseEvents).values({
        licenseId: row.id,
        type: 'expired',
        actorType: 'system',
        message: '授权到期自动失效',
        payload: { expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null },
      });
      await this.webhooks.emit('license.expired', {
        licenseId: row.id,
        keyMasked: row.keyMasked,
        customerEmail: row.customerEmail,
        expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
      }).catch(() => undefined);
    }

    const voidedCodes = await this.db.update(redeemCodes)
      .set({ status: 'void' })
      .where(and(
        eq(redeemCodes.status, 'unused'),
        isNotNull(redeemCodes.expiresAt),
        lt(redeemCodes.expiresAt, new Date()),
      ))
      .returning({ id: redeemCodes.id });

    if (expired.length > 0 || voidedCodes.length > 0) {
      this.logger.log('到期处理：授权 ' + expired.length + ' 条，卡密 ' + voidedCodes.length + ' 张');
    }
    return {
      task: 'expire-licenses',
      detail: { expiredLicenses: expired.length, voidedRedeemCodes: voidedCodes.length },
    };
  }

  /* ------------------------------------------------ 到期提醒（每天 09:00，站点时区） */

  @Cron('0 9 * * *', { name: 'expiry-reminders', timeZone: process.env.TIMEZONE ?? 'Asia/Shanghai' })
  async sendExpiryReminders(): Promise<TaskResult> {
    const settings = await this.settings.get();
    const daysList = settings.expireReminderDays.length > 0 ? settings.expireReminderDays : [7, 3, 1];
    let sent = 0;
    let skipped = 0;

    // ⚠️ 日期比较必须按「站点时区」而不是数据库会话时区：
    // 否则 TIMEZONE=Asia/Shanghai 的运营者在 UTC 数据库上会算错一天（跨零点时尤其明显）。
    const tz = this.config.timezone;

    for (const days of daysList) {
      // 到期日正好是「站点时区的今天 + days」天的授权
      const rows = await this.db.select({
        id: licenses.id,
        keyMasked: licenses.keyMasked,
        customerEmail: licenses.customerEmail,
        expiresAt: licenses.expiresAt,
        productName: products.name,
      }).from(licenses)
        .innerJoin(products, eq(products.id, licenses.productId))
        .where(and(
          isNotNull(licenses.expiresAt),
          inArray(licenses.status, ['active', 'issued']),
          isNotNull(licenses.customerEmail),
          sql`(${licenses.expiresAt} at time zone ${tz})::date
                = (now() at time zone ${tz})::date + make_interval(days => ${days})`,
        ));

      for (const row of rows) {
        // 幂等：同一授权同一剩余天数只提醒一次
        const existing = await this.db.select({ id: licenseEvents.id }).from(licenseEvents)
          .where(and(
            eq(licenseEvents.licenseId, row.id),
            eq(licenseEvents.type, 'reminder_sent'),
            sql`${licenseEvents.payload}->>'daysLeft' = ${String(days)}`,
          ))
          .limit(1);
        if (existing.length > 0) {
          skipped += 1;
          continue;
        }

        await this.mail.send({
          to: row.customerEmail as string,
          template: 'license_expiring',
          vars: {
            name: row.customerEmail as string,
            product: row.productName,
            licenseKey: row.keyMasked,
            expiresAt: row.expiresAt ? row.expiresAt.toISOString().slice(0, 10) : '',
            daysLeft: days,
          },
          relatedType: 'license',
          relatedId: row.id,
        }).catch(() => undefined);

        await this.db.insert(licenseEvents).values({
          licenseId: row.id,
          type: 'reminder_sent',
          actorType: 'system',
          message: '已发送到期提醒（剩余 ' + days + ' 天）',
          payload: { daysLeft: days },
        });
        sent += 1;
      }
    }
    if (sent > 0) this.logger.log('到期提醒：已发送 ' + sent + ' 封（跳过 ' + skipped + ' 封）');
    return { task: 'expiry-reminders', detail: { sent, skipped } };
  }

  /* ------------------------------------------------ Webhook 投递（每分钟） */

  @Cron('* * * * *', { name: 'webhook-deliveries' })
  async deliverWebhooks(): Promise<TaskResult> {
    const result = await this.webhooks.processPending(20);
    return {
      task: 'webhook-deliveries',
      detail: { processed: result.processed, succeeded: result.succeeded, failed: result.failed },
    };
  }

  /* ------------------------------------------------ 清理（每天 03:00） */

  @Cron('0 3 * * *', { name: 'cleanup', timeZone: process.env.TIMEZONE ?? 'Asia/Shanghai' })
  async cleanup(): Promise<TaskResult> {
    const logs = await this.db.delete(verificationLogs)
      .where(sql`${verificationLogs.at} < now() - interval '90 days'`)
      .returning({ id: verificationLogs.id });
    const sessions = await this.tokens.cleanupExpired();
    const deliveries = await this.webhooks.cleanupOldDeliveries(30);
    this.logger.log(
      '清理：心跳日志 ' + logs.length + ' 条，过期会话 ' + sessions + ' 个，投递记录 ' + deliveries + ' 条',
    );
    return {
      task: 'cleanup',
      detail: { verificationLogs: logs.length, sessions, webhookDeliveries: deliveries },
    };
  }

  /* ------------------------------------------------ 手动触发与待办统计 */

  async run(task: string): Promise<TaskResult> {
    if (this.running) return { task, detail: { skipped: 1 } };
    this.running = true;
    try {
      switch (task) {
        case 'expire-licenses': return await this.expireLicenses();
        case 'expiry-reminders': return await this.sendExpiryReminders();
        case 'webhook-deliveries': return await this.deliverWebhooks();
        case 'cleanup': return await this.cleanup();
        default:
          throw new Error('未知任务：' + task + '（可用：expire-licenses / expiry-reminders / webhook-deliveries / cleanup）');
      }
    } finally {
      this.running = false;
    }
  }

  async backlog() {
    const [pendingWebhooks] = await this.db.select({ value: count() }).from(webhookDeliveries)
      .where(eq(webhookDeliveries.status, 'pending'));
    const [expiringSoon] = await this.db.select({ value: count() }).from(licenses)
      .where(and(
        isNotNull(licenses.expiresAt),
        gte(licenses.expiresAt, new Date()),
        inArray(licenses.status, ['active', 'issued']),
        sql`${licenses.expiresAt} < now() + interval '7 days'`,
      ));
    return {
      pendingWebhookDeliveries: Number(pendingWebhooks?.value ?? 0),
      licensesExpiringIn7Days: Number(expiringSoon?.value ?? 0),
    };
  }

  /** 重新武装某条授权的到期提醒（延期后再次提醒）。 */
  async resetReminders(licenseId: string): Promise<number> {
    const rows = await this.db.delete(licenseEvents)
      .where(and(eq(licenseEvents.licenseId, licenseId), eq(licenseEvents.type, 'reminder_sent')))
      .returning({ id: licenseEvents.id });
    return rows.length;
  }
}