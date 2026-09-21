import { Inject, Injectable, Logger } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import nodemailer, { type Transporter } from 'nodemailer';
import { CONFIG_TOKEN, type AppConfig } from '../../config/configuration';
import { DB } from '../../db/db.module';
import type { DatabaseHandle } from '../../db/db.provider';
import { emailLogs } from '../../db/schema';
import { normalizePaging } from '../../common/pagination';
import { renderTemplate, type EmailTemplate } from './templates';

export interface SendMailInput {
  to: string;
  template: EmailTemplate;
  vars: Record<string, string | number | null | undefined>;
  relatedType?: string;
  relatedId?: string;
}

/**
 * 邮件发送。
 * 未配置 SMTP 时不会真发信，只写 email_logs 并打日志 —— 避免本地开发误发真实邮件。
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('Mail');
  private transporter: Transporter | null = null;

  constructor(
    @Inject(DB) private readonly handle: DatabaseHandle,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
  ) {
    if (config.smtp.host) {
      this.transporter = nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.secure,
        ...(config.smtp.user ? { auth: { user: config.smtp.user, pass: config.smtp.password ?? '' } } : {}),
      });
    }
  }

  get enabled(): boolean {
    return this.transporter !== null;
  }

  async send(input: SendMailInput): Promise<{ ok: boolean; skipped?: boolean }> {
    const { subject, text, html } = renderTemplate(input.template, {
      siteName: this.config.appOrigin,
      ...input.vars,
    });

    const [log] = await this.handle.db.insert(emailLogs).values({
      to: input.to,
      template: input.template,
      subject,
      status: 'queued',
      relatedType: input.relatedType ?? null,
      relatedId: input.relatedId ?? null,
    }).returning({ id: emailLogs.id });

    if (!this.transporter) {
      this.logger.log('[未配置 SMTP，仅记录] -> ' + input.to + ' | ' + subject);
      await this.handle.db.update(emailLogs)
        .set({ status: 'sent', error: 'SMTP 未配置，仅记录未发送' })
        .where(eq(emailLogs.id, log.id));
      return { ok: true, skipped: true };
    }

    try {
      const info = await this.transporter.sendMail({
        from: this.config.smtp.from,
        to: input.to,
        subject,
        text,
        html,
      });
      await this.handle.db.update(emailLogs)
        .set({ status: 'sent', providerMessageId: info.messageId ?? null })
        .where(eq(emailLogs.id, log.id));
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('发送失败 -> ' + input.to + '：' + message);
      await this.handle.db.update(emailLogs)
        .set({ status: 'failed', error: message })
        .where(eq(emailLogs.id, log.id));
      return { ok: false };
    }
  }

  async list(query: { page?: number; pageSize?: number }) {
    const { page, pageSize, offset } = normalizePaging(query.page, query.pageSize);
    const items = await this.handle.db.select().from(emailLogs)
      .orderBy(desc(emailLogs.createdAt))
      .limit(pageSize).offset(offset);
    const all = await this.handle.db.select({ id: emailLogs.id }).from(emailLogs);
    return { items, total: all.length, page, pageSize };
  }
}
