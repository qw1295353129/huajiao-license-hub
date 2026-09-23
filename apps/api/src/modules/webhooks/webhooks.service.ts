import { createHmac, randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, count, desc, eq, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import type { WebhookEvent } from '@license-hub/shared';
import { CryptoService } from '../../crypto/crypto.service';
import { DB } from '../../db/db.module';
import type { DatabaseHandle } from '../../db/db.provider';
import { webhookDeliveries, webhookEndpoints } from '../../db/schema';
import { AppError, ErrorCodes } from '../../common/errors';
import { normalizePaging } from '../../common/pagination';
import { isSafeWebhookUrl } from './dto';
import type { CreateWebhookDto, ListDeliveriesDto, UpdateWebhookDto } from './dto';

/** 退避重试节奏（秒）：30s → 2m → 10m → 1h → 6h，共 6 次后置为 failed。 */
const BACKOFF_SECONDS = [30, 120, 600, 3600, 21600];
const MAX_ATTEMPTS = 6;
const DELIVERY_TIMEOUT_MS = 10_000;

export interface EmitResult {
  event: WebhookEvent;
  queued: number;
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger('Webhooks');

  constructor(
    @Inject(DB) private readonly handle: DatabaseHandle,
    private readonly crypto: CryptoService,
  ) {}

  private get db() {
    return this.handle.db;
  }

  /* ------------------------------------------------ 端点管理 */

  private toPublic(row: typeof webhookEndpoints.$inferSelect) {
    return {
      id: row.id,
      url: row.url,
      description: row.description,
      secretMasked: row.secretMasked,
      events: row.events,
      status: row.status,
      createdAt: row.createdAt,
    };
  }

  async list() {
    const rows = await this.db.select().from(webhookEndpoints).orderBy(desc(webhookEndpoints.createdAt));
    const counts = await this.db.select({
      endpointId: webhookDeliveries.endpointId,
      total: count(),
      failed: sql<number>`count(*) filter (where ${webhookDeliveries.status} = 'failed')::int`,
      pending: sql<number>`count(*) filter (where ${webhookDeliveries.status} = 'pending')::int`,
    }).from(webhookDeliveries).groupBy(webhookDeliveries.endpointId);
    const byId = new Map(counts.map((row) => [row.endpointId, row]));
    return rows.map((row) => ({
      ...this.toPublic(row),
      stats: {
        total: Number(byId.get(row.id)?.total ?? 0),
        failed: byId.get(row.id)?.failed ?? 0,
        pending: byId.get(row.id)?.pending ?? 0,
      },
    }));
  }

  async create(dto: CreateWebhookDto, actor: { id?: string }) {
    // N15（SSRF）：创建入口再拦一次（DTO 已校验，此处兜底直调 service 的路径）
    if (!isSafeWebhookUrl(dto.url)) {
      throw AppError.badRequest(ErrorCodes.VALIDATION_FAILED, 'Webhook 地址不能指向内网/元数据主机');
    }
    const secret = dto.secret ?? 'whsec_' + this.crypto.randomToken(24);
    const [row] = await this.db.insert(webhookEndpoints).values({
      url: dto.url,
      description: dto.description ?? '',
      secretEnc: this.crypto.encrypt(secret),
      secretMasked: secret.slice(0, 6) + '****' + secret.slice(-2),
      events: dto.events,
    }).returning();
    void actor;
    // 明文密钥只在创建时返回一次
    return { endpoint: this.toPublic(row), secret };
  }

  async update(id: string, dto: UpdateWebhookDto) {
    if (dto.url !== undefined && !isSafeWebhookUrl(dto.url)) {
      throw AppError.badRequest(ErrorCodes.VALIDATION_FAILED, 'Webhook 地址不能指向内网/元数据主机');
    }
    const [existing] = await this.db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, id)).limit(1);
    if (!existing) throw AppError.notFound('Webhook 不存在');
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.url !== undefined) patch.url = dto.url;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.events !== undefined) patch.events = dto.events;
    if (dto.status !== undefined) patch.status = dto.status;
    let secret: string | undefined;
    if (dto.rotateSecret) {
      secret = 'whsec_' + this.crypto.randomToken(24);
      patch.secretEnc = this.crypto.encrypt(secret);
      patch.secretMasked = secret.slice(0, 6) + '****' + secret.slice(-2);
    }
    const [row] = await this.db.update(webhookEndpoints).set(patch).where(eq(webhookEndpoints.id, id)).returning();
    return { endpoint: this.toPublic(row), ...(secret ? { secret } : {}) };
  }

  async remove(id: string) {
    const rows = await this.db.delete(webhookEndpoints).where(eq(webhookEndpoints.id, id)).returning({ id: webhookEndpoints.id });
    if (rows.length === 0) throw AppError.notFound('Webhook 不存在');
    return { ok: true };
  }

  async revealSecret(id: string) {
    const [row] = await this.db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, id)).limit(1);
    if (!row) throw AppError.notFound('Webhook 不存在');
    return { secret: this.crypto.decrypt(row.secretEnc) };
  }

  /* ------------------------------------------------ 事件投递 */

  /** 事件入库：为每个订阅了该事件的活跃端点生成一条待投递记录。 */
  async emit(event: WebhookEvent, payload: Record<string, unknown>, eventId?: string): Promise<EmitResult> {
    const endpoints = await this.db.select().from(webhookEndpoints)
      .where(eq(webhookEndpoints.status, 'active'));
    const targets = endpoints.filter((endpoint) => endpoint.events.includes(event));
    if (targets.length === 0) return { event, queued: 0 };

    const id = eventId ?? randomUUID();
    const rows = targets.map((endpoint) => ({
      endpointId: endpoint.id,
      event,
      eventId: id,
      payload: { event, id, createdAt: new Date().toISOString(), data: payload } as Record<string, unknown>,
      status: 'pending' as const,
      nextRetryAt: new Date(),
    }));

    // 唯一索引 (endpoint_id, event_id) 保证同一事件不会重复入队
    const inserted: { id: string }[] = [];
    for (const row of rows) {
      try {
        const [created] = await this.db.insert(webhookDeliveries).values(row).returning({ id: webhookDeliveries.id });
        inserted.push(created);
      } catch {
        // 重复事件：跳过
      }
    }
    return { event, queued: inserted.length };
  }

  /** 组装签名头：签名覆盖 timestamp + body，防重放。 */
  private buildHeaders(endpoint: typeof webhookEndpoints.$inferSelect, delivery: typeof webhookDeliveries.$inferSelect) {
    const secret = this.crypto.decrypt(endpoint.secretEnc);
    const body = JSON.stringify(delivery.payload);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = createHmac('sha256', secret).update(timestamp + '.' + body).digest('hex');
    return {
      body,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'LicenseHub-Webhook/1.0',
        'X-LH-Event': delivery.event,
        'X-LH-Delivery': delivery.id,
        'X-LH-Timestamp': timestamp,
        'X-LH-Signature': 'sha256=' + signature,
      },
    };
  }

  /** 投递单条；成功/失败都会落库，失败按退避安排下次重试。 */
  async deliverOne(deliveryId: string): Promise<{ ok: boolean; status: number | null; error?: string }> {
    const [delivery] = await this.db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, deliveryId)).limit(1);
    if (!delivery) throw AppError.notFound('投递记录不存在');
    const [endpoint] = await this.db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, delivery.endpointId)).limit(1);
    if (!endpoint) throw AppError.notFound('Webhook 端点已删除');

    const { body, headers } = this.buildHeaders(endpoint, delivery);
    const attempts = delivery.attempts + 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

    try {
      const response = await fetch(endpoint.url, { method: 'POST', headers, body, signal: controller.signal });
      const text = await response.text().catch(() => '');
      const ok = response.status >= 200 && response.status < 300;
      await this.db.update(webhookDeliveries).set({
        attempts,
        status: ok ? 'success' : attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
        responseCode: response.status,
        responseBody: text.slice(0, 2000),
        error: ok ? null : 'HTTP ' + response.status,
        deliveredAt: ok ? new Date() : null,
        nextRetryAt: ok ? null : this.nextRetryAt(attempts),
      }).where(eq(webhookDeliveries.id, deliveryId));
      return { ok, status: response.status };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.db.update(webhookDeliveries).set({
        attempts,
        status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
        error: message,
        nextRetryAt: this.nextRetryAt(attempts),
      }).where(eq(webhookDeliveries.id, deliveryId));
      return { ok: false, status: null, error: message };
    } finally {
      clearTimeout(timer);
    }
  }

  private nextRetryAt(attempts: number): Date | null {
    const index = Math.min(attempts - 1, BACKOFF_SECONDS.length - 1);
    if (attempts >= MAX_ATTEMPTS) return null;
    return new Date(Date.now() + BACKOFF_SECONDS[index] * 1000);
  }

  /** 定时任务调用：把到期的待投递记录批量投出去。 */
  async processPending(limit = 20): Promise<{ processed: number; succeeded: number; failed: number }> {
    const due = await this.db.select({ id: webhookDeliveries.id }).from(webhookDeliveries)
      .where(and(
        eq(webhookDeliveries.status, 'pending'),
        or(isNull(webhookDeliveries.nextRetryAt), lte(webhookDeliveries.nextRetryAt, new Date())),
      ))
      .orderBy(webhookDeliveries.createdAt)
      .limit(limit);

    let succeeded = 0;
    let failed = 0;
    for (const row of due) {
      const result = await this.deliverOne(row.id);
      if (result.ok) succeeded += 1;
      else failed += 1;
    }
    if (due.length > 0) {
      this.logger.log('Webhook 投递：处理 ' + due.length + ' 条（成功 ' + succeeded + ' / 失败 ' + failed + '）');
    }
    return { processed: due.length, succeeded, failed };
  }

  async test(id: string, event = 'license.created') {
    const [endpoint] = await this.db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, id)).limit(1);
    if (!endpoint) throw AppError.notFound('Webhook 不存在');
    const payload = {
      event,
      id: 'test-' + randomUUID(),
      createdAt: new Date().toISOString(),
      data: { test: true, message: '这是一条来自 LicenseHub 的测试事件' },
    };
    const [delivery] = await this.db.insert(webhookDeliveries).values({
      endpointId: id,
      event: event as WebhookEvent,
      eventId: payload.id,
      payload: payload as unknown as Record<string, unknown>,
      status: 'pending',
      nextRetryAt: new Date(),
    }).returning();
    const result = await this.deliverOne(delivery.id);
    return { ...result, deliveryId: delivery.id };
  }

  async listDeliveries(query: ListDeliveriesDto) {
    const { page, pageSize, offset } = normalizePaging(query.page, query.pageSize);
    const conditions: SQL[] = [];
    if (query.endpointId) conditions.push(eq(webhookDeliveries.endpointId, query.endpointId));
    if (query.status) conditions.push(eq(webhookDeliveries.status, query.status));
    if (query.q) conditions.push(eq(webhookDeliveries.event, query.q as WebhookEvent));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const items = await this.db.select().from(webhookDeliveries).where(where)
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(pageSize).offset(offset);
    const [totalRow] = await this.db.select({ value: count() }).from(webhookDeliveries).where(where);
    return { items, total: Number(totalRow?.value ?? 0), page, pageSize };
  }

  /** 手工重放：重置状态与重试时间后立即投递一次。 */
  async replay(deliveryId: string) {
    const [delivery] = await this.db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, deliveryId)).limit(1);
    if (!delivery) throw AppError.notFound('投递记录不存在');
    await this.db.update(webhookDeliveries)
      .set({ status: 'pending', attempts: 0, nextRetryAt: new Date(), error: null })
      .where(eq(webhookDeliveries.id, deliveryId));
    return this.deliverOne(deliveryId);
  }

  /** 清理 30 天前的成功投递记录，避免日志表无限增长。 */
  async cleanupOldDeliveries(days = 30): Promise<number> {
    const rows = await this.db.delete(webhookDeliveries)
      .where(and(
        eq(webhookDeliveries.status, 'success'),
        sql`${webhookDeliveries.createdAt} < now() - (${days} || ' days')::interval`,
      ))
      .returning({ id: webhookDeliveries.id });
    return rows.length;
  }

  /** 供其它模块查询：某事件订阅了多少端点（用于自检/文档）。 */
  async subscriberCount(event: WebhookEvent): Promise<number> {
    const rows = await this.db.select({ events: webhookEndpoints.events }).from(webhookEndpoints)
      .where(eq(webhookEndpoints.status, 'active'));
    return rows.filter((row) => row.events.includes(event)).length;
  }

  /** 批量重放失败记录（排障用）。 */
  async replayFailed(endpointId?: string): Promise<number> {
    const conditions: SQL[] = [eq(webhookDeliveries.status, 'failed')];
    if (endpointId) conditions.push(eq(webhookDeliveries.endpointId, endpointId));
    const rows = await this.db.update(webhookDeliveries)
      .set({ status: 'pending', attempts: 0, nextRetryAt: new Date(), error: null })
      .where(and(...conditions))
      .returning({ id: webhookDeliveries.id });
    return rows.length;
  }
}