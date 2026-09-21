import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, gte, ilike, inArray, isNotNull, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import {
  formatLicenseKey, isValidLicenseKeyShape, maskLicenseKey, normalizeLicenseKey,
  type LicenseSource, type LicenseStatus,
} from '@license-hub/shared';
import { CONFIG_TOKEN, type AppConfig } from '../../config/configuration';
import { CryptoService } from '../../crypto/crypto.service';
import { DB } from '../../db/db.module';
import type { DatabaseHandle } from '../../db/db.provider';
import { customers, licenseActivations, licenseEvents, licenses, plans, products } from '../../db/schema';
import { AppError, ErrorCodes } from '../../common/errors';
import { normalizePaging, type PageResult } from '../../common/pagination';
import { ProductsService } from '../products/products.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { parseCsv, toCsv } from './csv';
import type {
  BatchCreateLicensesDto, CreateLicenseDto, ExportLicensesDto, ImportLicensesDto,
  ListLicensesDto, UpdateLicenseDto,
} from './dto';

export interface LicenseView {
  id: string;
  keyMasked: string;
  status: LicenseStatus;
  productId: string;
  productName: string;
  planId: string;
  planName: string;
  planCode: string;
  licenseType: string;
  customerEmail: string | null;
  maxDevices: number;
  activationCount: number;
  validFrom: Date;
  expiresAt: Date | null;
  featureKeys: string[];
  remainingUsages: number | null;
  maxDomains: number;
  allowSubdomains: boolean;
  domainCount: number;
  source: LicenseSource;
  notes: string | null;
  lastVerifiedAt: Date | null;
  createdAt: Date;
}

export interface CreateResult {
  license: LicenseView;
  /** 授权码明文：仅在创建/换发时返回一次，之后只能通过 reveal 接口获取（写审计） */
  key: string;
  keyFormatted: string;
}

const EXPORT_COLUMNS = [
  'id', 'product', 'plan', 'key', 'status', 'customer_email', 'max_devices',
  'activation_count', 'valid_from', 'expires_at', 'source', 'notes', 'created_at',
];

@Injectable()
export class LicensesService {
  constructor(
    @Inject(DB) private readonly handle: DatabaseHandle,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
    private readonly crypto: CryptoService,
    private readonly products: ProductsService,
    private readonly webhooks: WebhooksService,
  ) {}

  private get db() {
    return this.handle.db;
  }

  /** 解析产品与策略：支持 planId 或 planCode 两种写法。 */
  private async resolvePlan(productId: string, planId?: string, planCode?: string) {
    await this.products.findById(productId);
    let plan = null;
    if (planId) {
      plan = await this.products.findPlan(planId);
      if (plan.productId !== productId) {
        throw AppError.badRequest(ErrorCodes.VALIDATION_FAILED, '策略不属于该产品');
      }
    } else if (planCode) {
      plan = await this.products.findPlanByCode(productId, planCode);
      if (!plan) throw AppError.notFound('该产品下不存在策略：' + planCode);
    } else {
      throw AppError.badRequest(ErrorCodes.VALIDATION_FAILED, '必须提供 planId 或 planCode');
    }
    return plan;
  }

  private computeExpiry(
    plan: { licenseType: string; durationDays: number | null },
    explicit?: string,
    durationDays?: number,
  ): Date | null {
    if (explicit) return new Date(explicit);
    const days = durationDays ?? plan.durationDays;
    if (plan.licenseType === 'perpetual') return null;
    if (!days) return null;
    return new Date(Date.now() + days * 86_400_000);
  }

  private async recordEvent(input: {
    licenseId: string;
    type: string;
    actorType?: 'admin' | 'customer' | 'system' | 'api';
    actorId?: string | null;
    actorLabel?: string | null;
    message?: string | null;
    payload?: Record<string, unknown>;
    ip?: string | null;
  }): Promise<void> {
    await this.db.insert(licenseEvents).values({
      licenseId: input.licenseId,
      type: input.type,
      actorType: input.actorType ?? 'admin',
      actorId: input.actorId ?? null,
      actorLabel: input.actorLabel ?? null,
      message: input.message ?? null,
      payload: input.payload ?? {},
      ip: input.ip ?? null,
    });
  }

  /**
   * 按邮箱解析客户账号。
   * 关键点：授权一旦带上客户邮箱，就应同时写入 customer_id —— 否则用户登录后
   * 在门户里看不到自己刚兑换/购买到的授权（曾出现：卡密兑换后门户 404）。
   */
  private async resolveCustomerId(email: string | null | undefined): Promise<string | null> {
    if (!email) return null;
    const [row] = await this.db.select({ id: customers.id }).from(customers)
      .where(eq(customers.email, email.trim().toLowerCase())).limit(1);
    return row?.id ?? null;
  }

  private buildValues(input: {
    productId: string;
    planId: string;
    plan: typeof plans.$inferSelect;
    rawKey: string;
    customerEmail?: string | null;
    customerId?: string | null;
    expiresAt: Date | null;
    maxDevices?: number;
    featureKeys?: string[];
    maxUsages?: number | null;
    maxDomains?: number | null;
    allowSubdomains?: boolean | null;
    notes?: string | null;
    source: LicenseSource;
    issuedBy?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    const normalized = normalizeLicenseKey(input.rawKey);
    return {
      productId: input.productId,
      planId: input.planId,
      keyLookup: this.crypto.blindIndex(normalized, 'license'),
      keyEnc: this.crypto.encrypt(normalized),
      keyMasked: maskLicenseKey(normalized),
      status: 'issued' as const,
      customerEmail: input.customerEmail?.trim().toLowerCase() ?? null,
      customerId: input.customerId ?? null,
      maxDevices: input.maxDevices ?? input.plan.maxDevices,
      validFrom: new Date(),
      expiresAt: input.expiresAt,
      featureKeys: input.featureKeys ?? input.plan.featureKeys,
      maxUsages: input.maxUsages ?? input.plan.maxUsages ?? null,
      remainingUsages: (input.maxUsages ?? input.plan.maxUsages) ?? null,
      maxDomains: input.maxDomains ?? input.plan.maxDomains ?? 0,
      allowSubdomains: input.allowSubdomains ?? input.plan.allowSubdomains ?? true,
      source: input.source,
      notes: input.notes ?? null,
      issuedBy: input.issuedBy ?? null,
      metadata: input.metadata ?? {},
    };
  }

  async create(dto: CreateLicenseDto, actor: { id?: string; email?: string }): Promise<CreateResult> {
    const plan = await this.resolvePlan(dto.productId, dto.planId, dto.planCode);

    if (dto.key) {
      const normalized = normalizeLicenseKey(dto.key);
      if (!isValidLicenseKeyShape(normalized)) {
        throw AppError.badRequest(ErrorCodes.VALIDATION_FAILED, '自定义授权码必须是 16 位合法字符（不含 I/L/O/U）');
      }
      const existing = await this.findByRawKey(normalized);
      if (existing) throw AppError.conflict('该授权码已存在');
    }

    const rawKey = dto.key ? normalizeLicenseKey(dto.key) : this.crypto.generateCode(16);
    // 有邮箱就尝试关联到已注册客户，让用户在门户立刻看到授权
    const customerId = await this.resolveCustomerId(dto.customerEmail);
    const values = this.buildValues({
      productId: dto.productId,
      planId: plan.id,
      plan,
      rawKey,
      customerEmail: dto.customerEmail,
      customerId,
      expiresAt: this.computeExpiry(plan, dto.expiresAt, dto.durationDays),
      maxDevices: dto.maxDevices,
      featureKeys: dto.featureKeys,
      maxUsages: dto.maxUsages ?? null,
      maxDomains: dto.maxDomains ?? null,
      allowSubdomains: dto.allowSubdomains ?? null,
      notes: dto.notes,
      source: dto.source ?? 'manual',
      issuedBy: actor.id ?? null,
    });

    const [row] = await this.db.insert(licenses).values(values).returning();
    await this.recordEvent({
      licenseId: row.id,
      type: 'created',
      actorId: actor.id ?? null,
      actorLabel: actor.email ?? null,
      message: '创建授权（来源：' + values.source + '）',
    });
    const view = await this.toView(row.id);
    await this.webhooks.emit('license.created', {
      licenseId: row.id,
      keyMasked: view.keyMasked,
      product: view.productName,
      plan: view.planCode,
      customerEmail: view.customerEmail,
      expiresAt: view.expiresAt ? view.expiresAt.toISOString() : null,
      source: view.source,
    }).catch(() => undefined);

    return { license: view, key: rawKey, keyFormatted: formatLicenseKey(rawKey) };
  }

  /** 批量发码：分块插入，返回明文列表（仅此一次）。 */
  async createBatch(dto: BatchCreateLicensesDto, actor: { id?: string; email?: string }): Promise<{
    created: number;
    keys: string[];
    batchLabel: string | null;
    licenseIds: string[];
  }> {
    const plan = await this.resolvePlan(dto.productId, dto.planId, dto.planCode);
    const expiresAt = this.computeExpiry(plan, dto.expiresAt, dto.durationDays);
    const label = dto.batchLabel ?? 'batch-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '');
    const keys: string[] = [];
    const seen = new Set<string>();
    while (keys.length < dto.count) {
      const candidate = this.crypto.generateCode(16);
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      keys.push(candidate);
    }

    const rows: (typeof licenses.$inferInsert)[] = keys.map((rawKey) => ({
      ...this.buildValues({
        productId: dto.productId,
        planId: plan.id,
        plan,
        rawKey,
        customerEmail: null,
        expiresAt,
        maxDevices: dto.maxDevices,
        featureKeys: dto.featureKeys,
        maxDomains: dto.maxDomains ?? null,
        allowSubdomains: dto.allowSubdomains ?? null,
        notes: dto.notes ?? null,
        source: 'batch',
        issuedBy: actor.id ?? null,
        metadata: { batchLabel: label },
      }),
    }));

    const inserted: { id: string }[] = [];
    const chunkSize = 500;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const result = await this.db.insert(licenses).values(chunk).returning({ id: licenses.id });
      inserted.push(...result);
    }
    // 事件逐条写入（批量场景下用单条 SQL 拼多值，避免 N 次往返）
    if (inserted.length > 0) {
      await this.db.insert(licenseEvents).values(inserted.map((row) => ({
        licenseId: row.id,
        type: 'created',
        actorType: 'admin' as const,
        actorId: actor.id ?? null,
        actorLabel: actor.email ?? null,
        message: '批量创建（' + label + '）',
        payload: { batchLabel: label } as Record<string, unknown>,
      })));
    }

    return {
      created: inserted.length,
      keys: keys.map((k) => formatLicenseKey(k)),
      batchLabel: label,
      licenseIds: inserted.map((row) => row.id),
    };
  }

  async findByRawKey(rawKey: string) {
    const lookup = this.crypto.blindIndex(normalizeLicenseKey(rawKey), 'license');
    const [row] = await this.db.select().from(licenses).where(eq(licenses.keyLookup, lookup)).limit(1);
    return row ?? null;
  }

  private baseSelect() {
    return this.db.select({
      id: licenses.id,
      keyMasked: licenses.keyMasked,
      status: licenses.status,
      productId: licenses.productId,
      productName: products.name,
      planId: licenses.planId,
      planName: plans.name,
      planCode: plans.code,
      licenseType: plans.licenseType,
      customerEmail: licenses.customerEmail,
      maxDevices: licenses.maxDevices,
      activationCount: licenses.activationCount,
      validFrom: licenses.validFrom,
      expiresAt: licenses.expiresAt,
      featureKeys: licenses.featureKeys,
      remainingUsages: licenses.remainingUsages,
      maxDomains: licenses.maxDomains,
      allowSubdomains: licenses.allowSubdomains,
      domainCount: licenses.domainCount,
      source: licenses.source,
      notes: licenses.notes,
      lastVerifiedAt: licenses.lastVerifiedAt,
      createdAt: licenses.createdAt,
    }).from(licenses)
      .innerJoin(products, eq(products.id, licenses.productId))
      .innerJoin(plans, eq(plans.id, licenses.planId));
  }

  async list(query: ListLicensesDto): Promise<PageResult<LicenseView>> {
    const { page, pageSize, offset } = normalizePaging(query.page, query.pageSize);
    const where = this.buildWhere(query);
    const sortColumn = {
      createdAt: licenses.createdAt,
      expiresAt: licenses.expiresAt,
      lastVerifiedAt: licenses.lastVerifiedAt,
      activationCount: licenses.activationCount,
    }[query.sortBy ?? 'createdAt'];
    const direction = (query.sortDir ?? 'desc') === 'asc' ? asc : desc;

    const items = await this.baseSelect()
      .where(where)
      .orderBy(direction(sortColumn))
      .limit(pageSize).offset(offset);
    const [totalRow] = await this.db.select({ value: count() }).from(licenses).where(where);
    return { items: items as LicenseView[], total: Number(totalRow?.value ?? 0), page, pageSize };
  }

  private buildWhere(query: ListLicensesDto): SQL | undefined {
    const conditions: SQL[] = [];
    if (query.productId) conditions.push(eq(licenses.productId, query.productId));
    if (query.planId) conditions.push(eq(licenses.planId, query.planId));
    if (query.status) conditions.push(eq(licenses.status, query.status));
    if (query.source) conditions.push(eq(licenses.source, query.source));
    if (query.customerEmail) conditions.push(ilike(licenses.customerEmail, '%' + query.customerEmail + '%'));
    if (query.expiringInDays) {
      conditions.push(isNotNull(licenses.expiresAt));
      conditions.push(lte(licenses.expiresAt, new Date(Date.now() + query.expiringInDays * 86_400_000)));
      conditions.push(gte(licenses.expiresAt, new Date()));
    }
    if (query.q) {
      const trimmed = query.q.trim();
      const like = '%' + trimmed + '%';
      const parts: (SQL | undefined)[] = [
        ilike(licenses.customerEmail, like),
        ilike(licenses.notes, like),
        ilike(licenses.keyMasked, like),
      ];
      // 粘贴完整授权码时走盲索引精确匹配
      const normalized = normalizeLicenseKey(trimmed);
      if (normalized.length === 16) {
        parts.push(eq(licenses.keyLookup, this.crypto.blindIndex(normalized, 'license')));
      }
      const search = or(...parts);
      if (search) conditions.push(search);
    }
    return conditions.length > 0 ? and(...conditions) : undefined;
  }

  async get(id: string): Promise<LicenseView> {
    const [row] = await this.baseSelect().where(eq(licenses.id, id)).limit(1);
    if (!row) throw AppError.notFound('授权不存在');
    return row as LicenseView;
  }

  private async toView(id: string): Promise<LicenseView> {
    return this.get(id);
  }

  async detail(id: string) {
    const license = await this.get(id);
    const events = await this.db.select().from(licenseEvents)
      .where(eq(licenseEvents.licenseId, id))
      .orderBy(desc(licenseEvents.createdAt))
      .limit(50);
    return { ...license, events };
  }

  /** 解密返回授权码明文：仅 owner/admin，调用方必须写审计。 */
  async reveal(id: string): Promise<{ key: string; keyFormatted: string }> {
    const [row] = await this.db.select({ keyEnc: licenses.keyEnc }).from(licenses).where(eq(licenses.id, id)).limit(1);
    if (!row) throw AppError.notFound('授权不存在');
    const key = this.crypto.decrypt(row.keyEnc);
    return { key, keyFormatted: formatLicenseKey(key) };
  }

  async update(id: string, dto: UpdateLicenseDto, actor: { id?: string; email?: string }): Promise<LicenseView> {
    const current = await this.get(id);
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.expiresAt !== undefined) {
      patch.expiresAt = dto.expiresAt === null ? null : new Date(dto.expiresAt);
    }
    if (dto.maxDevices !== undefined) patch.maxDevices = dto.maxDevices;
    if (dto.featureKeys !== undefined) patch.featureKeys = dto.featureKeys;
    if (dto.customerEmail !== undefined) {
      patch.customerEmail = dto.customerEmail ? dto.customerEmail.trim().toLowerCase() : null;
    }
    if (dto.notes !== undefined) patch.notes = dto.notes;
    if (dto.remainingUsages !== undefined) patch.remainingUsages = dto.remainingUsages;
    if (dto.maxDomains !== undefined) patch.maxDomains = dto.maxDomains;
    if (dto.allowSubdomains !== undefined) patch.allowSubdomains = dto.allowSubdomains;

    await this.db.update(licenses).set(patch).where(eq(licenses.id, id));
    await this.recordEvent({
      licenseId: id,
      type: 'updated',
      actorId: actor.id ?? null,
      actorLabel: actor.email ?? null,
      message: '修改授权信息',
      payload: {
        before: { expiresAt: current.expiresAt, maxDevices: current.maxDevices, notes: current.notes },
        after: { expiresAt: patch.expiresAt ?? current.expiresAt, maxDevices: patch.maxDevices ?? current.maxDevices },
      },
    });
    return this.get(id);
  }

  /** 状态流转：revoke / suspend / resume / ban。 */
  async transition(
    id: string,
    action: 'revoke' | 'suspend' | 'resume' | 'ban',
    reason: string | undefined,
    actor: { id?: string; email?: string },
  ): Promise<LicenseView> {
    const current = await this.get(id);
    const target: Record<typeof action, LicenseStatus> = {
      revoke: 'revoked',
      suspend: 'suspended',
      resume: 'active',
      ban: 'banned',
    };
    const next = target[action];
    if (current.status === next) {
      throw AppError.conflict('授权已处于「' + next + '」状态');
    }
    const patch: Record<string, unknown> = { status: next, updatedAt: new Date() };
    if (action === 'revoke' || action === 'ban') {
      patch.revokedAt = new Date();
      patch.revokedReason = reason ?? null;
    }
    if (action === 'resume') {
      patch.revokedAt = null;
      patch.revokedReason = null;
      // 恢复时若已过期，按原有效期判断仍会过期；这里只恢复状态
    }
    await this.db.update(licenses).set(patch).where(eq(licenses.id, id));
    await this.recordEvent({
      licenseId: id,
      type: action === 'ban' ? 'banned' : action === 'revoke' ? 'revoked' : action === 'suspend' ? 'suspended' : 'resumed',
      actorId: actor.id ?? null,
      actorLabel: actor.email ?? null,
      message: reason ?? null,
      payload: { from: current.status, to: next },
    });
    if (action === 'revoke' || action === 'ban') {
      await this.webhooks.emit('license.revoked', {
        licenseId: id,
        keyMasked: current.keyMasked,
        from: current.status,
        to: next,
        reason: reason ?? null,
      }).catch(() => undefined);
    }
    return this.get(id);
  }

  async extend(id: string, days: number, reason: string | undefined, actor: { id?: string; email?: string }): Promise<LicenseView> {
    const current = await this.get(id);
    const base = current.expiresAt && current.expiresAt.getTime() > Date.now()
      ? current.expiresAt.getTime()
      : Date.now();
    const next = new Date(base + days * 86_400_000);
    await this.db.update(licenses)
      .set({ expiresAt: next, status: current.status === 'expired' ? 'active' : current.status, updatedAt: new Date() })
      .where(eq(licenses.id, id));
    await this.recordEvent({
      licenseId: id,
      type: 'extended',
      actorId: actor.id ?? null,
      actorLabel: actor.email ?? null,
      message: reason ?? '延长 ' + days + ' 天',
      payload: { days, from: current.expiresAt, to: next },
    });
    await this.webhooks.emit('license.extended', {
      licenseId: id,
      keyMasked: current.keyMasked,
      days,
      expiresAt: next.toISOString(),
    }).catch(() => undefined);
    return this.get(id);
  }

  async resetDevices(id: string, actor: { id?: string; email?: string }): Promise<{ ok: true; released: number }> {
    const result = await this.db.update(licenseActivations)
      .set({ status: 'deactivated', deactivatedAt: new Date(), unbindReason: 'admin_reset' })
      .where(and(eq(licenseActivations.licenseId, id), eq(licenseActivations.status, 'active')))
      .returning({ id: licenseActivations.id });
    await this.db.update(licenses).set({ activationCount: 0, updatedAt: new Date() }).where(eq(licenses.id, id));
    await this.recordEvent({
      licenseId: id,
      type: 'devices_reset',
      actorId: actor.id ?? null,
      actorLabel: actor.email ?? null,
      message: '管理员清空设备绑定',
      payload: { released: result.length },
    });
    return { ok: true, released: result.length };
  }

  /** 换发新码：旧码立即吊销，历史保留可追溯。 */
  async reissue(id: string, actor: { id?: string; email?: string }): Promise<CreateResult> {
    const current = await this.get(id);
    const newRaw = this.crypto.generateCode(16);
    const normalized = normalizeLicenseKey(newRaw);
    await this.db.update(licenses)
      .set({
        keyLookup: this.crypto.blindIndex(normalized, 'license'),
        keyEnc: this.crypto.encrypt(normalized),
        keyMasked: maskLicenseKey(normalized),
        status: 'issued',
        activationCount: 0,
        revokedAt: null,
        revokedReason: null,
        updatedAt: new Date(),
      })
      .where(eq(licenses.id, id));
    await this.db.update(licenseActivations)
      .set({ status: 'deactivated', deactivatedAt: new Date(), unbindReason: 'reissued' })
      .where(and(eq(licenseActivations.licenseId, id), eq(licenseActivations.status, 'active')));
    await this.recordEvent({
      licenseId: id,
      type: 'reissued',
      actorId: actor.id ?? null,
      actorLabel: actor.email ?? null,
      message: '换发新授权码（旧码 ' + current.keyMasked + ' 已失效）',
    });
    return { license: await this.get(id), key: newRaw, keyFormatted: formatLicenseKey(newRaw) };
  }

  async exportCsv(query: ExportLicensesDto, actor: { id?: string; email?: string }): Promise<string> {
    const where = this.buildWhere(query);
    const rows = await this.baseSelect().where(where).orderBy(desc(licenses.createdAt)).limit(20000);
    const data = [];
    for (const row of rows) {
      let key = row.keyMasked;
      if (query.reveal) {
        const [enc] = await this.db.select({ keyEnc: licenses.keyEnc }).from(licenses).where(eq(licenses.id, row.id)).limit(1);
        key = enc ? formatLicenseKey(this.crypto.decrypt(enc.keyEnc)) : row.keyMasked;
      }
      data.push({
        id: row.id,
        product: row.productName,
        plan: row.planCode,
        key,
        status: row.status,
        customer_email: row.customerEmail ?? '',
        max_devices: row.maxDevices,
        activation_count: row.activationCount,
        valid_from: row.validFrom,
        expires_at: row.expiresAt ?? '',
        source: row.source,
        notes: row.notes ?? '',
        created_at: row.createdAt,
      });
    }
    return toCsv(data, EXPORT_COLUMNS);
  }

  async importCsv(dto: ImportLicensesDto, actor: { id?: string; email?: string }) {
    const records = parseCsv(dto.csv);
    if (records.length === 0) {
      throw AppError.badRequest(ErrorCodes.VALIDATION_FAILED, 'CSV 没有数据行（第一行必须是表头）');
    }
    if (records.length > 5000) {
      throw AppError.badRequest(ErrorCodes.VALIDATION_FAILED, '单次最多导入 5000 条');
    }

    const productCache = new Map<string, typeof products.$inferSelect>();
    const results = { created: 0, skipped: 0, errors: [] as { row: number; message: string }[] };

    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      const rowNo = index + 2; // 含表头，从 2 开始
      try {
        const slug = record.product_slug || record.product;
        if (!slug) throw new Error('缺少 product_slug 列');
        let product = productCache.get(slug);
        if (!product) {
          const found = await this.products.findBySlug(slug);
          if (!found) throw new Error('产品不存在：' + slug);
          product = found;
          productCache.set(slug, found);
        }
        const planCode = record.plan_code || record.plan;
        if (!planCode) throw new Error('缺少 plan_code 列');
        const plan = await this.products.findPlanByCode(product.id, planCode);
        if (!plan) throw new Error('策略不存在：' + planCode);

        const maxDevices = record.max_devices ? Number(record.max_devices) : undefined;
        const durationDays = record.duration_days ? Number(record.duration_days) : undefined;
        const expiresAt = record.expires_at ? new Date(record.expires_at) : undefined;
        if (record.expires_at && Number.isNaN(expiresAt?.getTime())) throw new Error('expires_at 不是合法日期');

        if (dto.dryRun) {
          results.created += 1;
          continue;
        }

        await this.create({
          productId: product.id,
          planId: plan.id,
          key: record.key || undefined,
          customerEmail: record.customer_email || undefined,
          expiresAt: expiresAt ? expiresAt.toISOString() : undefined,
          durationDays,
          maxDevices,
          notes: record.notes || undefined,
          source: 'import',
        }, actor);
        results.created += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('已存在')) {
          results.skipped += 1;
        } else {
          results.errors.push({ row: rowNo, message });
        }
      }
    }
    return { ...results, dryRun: dto.dryRun === true, total: records.length };
  }

  async stats() {
    const [row] = await this.db.select({
      total: count(),
      issued: sql<number>`count(*) filter (where ${licenses.status} = 'issued')::int`,
      active: sql<number>`count(*) filter (where ${licenses.status} = 'active')::int`,
      expired: sql<number>`count(*) filter (where ${licenses.status} = 'expired')::int`,
      suspended: sql<number>`count(*) filter (where ${licenses.status} = 'suspended')::int`,
      revoked: sql<number>`count(*) filter (where ${licenses.status} in ('revoked','banned'))::int`,
      expiring7d: sql<number>`count(*) filter (where ${licenses.expiresAt} is not null and ${licenses.expiresAt} between now() and now() + interval '7 days')::int`,
    }).from(licenses);
    return {
      total: Number(row?.total ?? 0),
      issued: row?.issued ?? 0,
      active: row?.active ?? 0,
      expired: row?.expired ?? 0,
      suspended: row?.suspended ?? 0,
      revoked: row?.revoked ?? 0,
      expiring7d: row?.expiring7d ?? 0,
    };
  }

  /** 定时任务使用：把已过期的授权置为 expired。 */
  async expireOverdue(): Promise<number> {
    const rows = await this.db.update(licenses)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(and(
        isNotNull(licenses.expiresAt),
        lt(licenses.expiresAt, new Date()),
        inArray(licenses.status, ['issued', 'active', 'suspended']),
      ))
      .returning({ id: licenses.id });
    return rows.length;
  }

  async listActivations(licenseId: string) {
    const table = licenseActivations;
    return this.db.select().from(table).where(eq(table.licenseId, licenseId)).orderBy(desc(table.lastSeenAt));
  }
}