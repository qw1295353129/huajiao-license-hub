import { Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { and, count, desc, eq, inArray, isNull, like, or, sql, type SQL } from 'drizzle-orm';
import type { Entitlements, LicenseStatus } from '@license-hub/shared';
import { domainMatches, normalizeDomain } from '@license-hub/shared';
import { CONFIG_TOKEN, type AppConfig } from '../../config/configuration';
import { CryptoService } from '../../crypto/crypto.service';
import { DB } from '../../db/db.module';
import type { DatabaseHandle } from '../../db/db.provider';
import { authorizedDomains, customers, domainEvents, domainLicenses, plans, products } from '../../db/schema';
import { AppError, ErrorCodes } from '../../common/errors';
import { normalizePaging } from '../../common/pagination';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ProductsService } from '../products/products.service';
import { LicenseSignerService } from '../activation/license-signer.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import type {
  AddDomainDto, CreateDomainLicenseDto, DomainActivateDto, DomainDeactivateDto, DomainVerifyDto,
  ListDomainLicensesDto, UpdateDomainLicenseDto,
} from './dto';

const CLIENT_TOKEN_AUDIENCE = 'domain-client';

/** 域名客户端调用上下文：apiKey 绑定了产品时必须约束在该产品内（C3/N20）。 */
export interface DomainClientContext {
  ip?: string;
  apiKeyProductId?: string | null;
}

export interface DomainLicenseView {
  id: string;
  productId: string;
  productName: string;
  productSlug: string;
  planId: string;
  planCode: string;
  planName: string;
  customerId: string | null;
  customerEmail: string | null;
  status: LicenseStatus;
  maxDomains: number;
  allowSubdomains: boolean;
  domainCount: number;
  featureKeys: string[];
  validFrom: Date;
  expiresAt: Date | null;
  notes: string | null;
  lastVerifiedAt: Date | null;
  createdAt: Date;
}

/**
 * 域名授权服务（独立体系，**不依赖授权码**）。
 *
 * 运营者直接给「域名 + 套餐 + 到期」发授权；客户在自己网站后台填域名即可激活。
 * 域名是唯一凭据，因此激活接口只按域名匹配，不需要任何 key。
 */
@Injectable()
export class DomainLicensesService {
  private readonly logger = new Logger('DomainLicenses');

  constructor(
    @Inject(DB) private readonly handle: DatabaseHandle,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
    private readonly crypto: CryptoService,
    private readonly products: ProductsService,
    private readonly signer: LicenseSignerService,
    private readonly mail: NotificationsService,
    private readonly webhooks: WebhooksService,
    private readonly audit: AuditService,
    private readonly jwt: JwtService,
  ) {}

  private get db() {
    return this.handle.db;
  }

  /* ------------------------------------------------ 事件与签名 */

  private async recordEvent(input: {
    domainLicenseId: string;
    type: string;
    actorType?: 'admin' | 'customer' | 'system' | 'api';
    actorId?: string | null;
    actorLabel?: string | null;
    domain?: string | null;
    message?: string | null;
    payload?: Record<string, unknown>;
    ip?: string | null;
  }): Promise<void> {
    await this.db.insert(domainEvents).values({
      domainLicenseId: input.domainLicenseId,
      type: input.type,
      actorType: input.actorType ?? 'system',
      actorId: input.actorId ?? null,
      actorLabel: input.actorLabel ?? null,
      domain: input.domain ?? null,
      message: input.message ?? null,
      payload: input.payload ?? {},
      ip: input.ip ?? null,
    });
  }

  private async signFile(row: typeof domainLicenses.$inferSelect, context: {
    productSlug: string;
    planCode: string;
    domain: string;
    usedDomains: number;
    offlineGraceDays: number;
  }) {
    return this.signer.signDomain({
      domainLicenseId: row.id,
      product: context.productSlug,
      plan: context.planCode,
      customer: row.customerEmail,
      domain: context.domain,
      allowSubdomains: row.allowSubdomains,
      maxDomains: row.maxDomains,
      usedDomains: context.usedDomains,
      features: row.featureKeys,
      validFrom: row.validFrom.toISOString(),
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
      perpetual: row.expiresAt === null,
      offlineGraceDays: context.offlineGraceDays,
    });
  }

  private async signClientToken(domainLicenseId: string, domain: string, heartbeatHours: number): Promise<string> {
    const ttlHours = Math.min(72, Math.max(6, heartbeatHours * 3));
    return this.signer.signDomainClientToken(
      { sub: domainLicenseId, domain, aud: CLIENT_TOKEN_AUDIENCE },
      ttlHours * 3600,
    );
  }

  /** API Key 绑定了产品时：解析出的产品必须一致（C3）。 */
  private apiKeyProductMatches(
    resolved: { product: { id: string } },
    apiKeyProductId: string | null | undefined,
  ): boolean {
    return !apiKeyProductId || resolved.product.id === apiKeyProductId;
  }

  /** API Key 绑定产品且请求未带 product 时，用该产品的 slug 过滤（C3/N20）。 */
  private async apiKeyProductSlug(productId: string | null | undefined): Promise<string | undefined> {
    if (!productId) return undefined;
    const product = await this.products.findById(productId);
    return product.slug;
  }

  /** 客户端令牌校验：aud 必须是 domain-client，且签发给该授权与该域名。 */
  private async verifyClientToken(
    accessToken: string,
    expect: { domainLicenseId: string; domain: string },
  ): Promise<void> {
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; domain: string; aud: string }>(accessToken);
      if (payload.aud !== CLIENT_TOKEN_AUDIENCE) throw new Error('audience mismatch');
      if (payload.sub !== expect.domainLicenseId) throw new Error('subject mismatch');
      if (payload.domain !== expect.domain) throw new Error('domain mismatch');
    } catch {
      throw AppError.unauthorized(ErrorCodes.UNAUTHENTICATED, '访问令牌无效或不属于该域名');
    }
  }

  /** 门户归属：邮箱兜底仅对已验证邮箱开放（否则任意人可注册受害者邮箱抢走域名授权，C2）。 */
  private async ownsByVerifiedEmail(customerId: string, customerEmail: string | null): Promise<boolean> {
    if (!customerEmail) return false;
    const [customer] = await this.db.select({
      email: customers.email,
      emailVerifiedAt: customers.emailVerifiedAt,
    }).from(customers).where(eq(customers.id, customerId)).limit(1);
    if (!customer?.emailVerifiedAt) return false;
    return customer.email.toLowerCase() === customerEmail.toLowerCase();
  }

  private validateState(row: typeof domainLicenses.$inferSelect): { reason: Entitlements['reason']; message: string } | null {
    if (row.status === 'revoked') return { reason: 'invalid_revoked', message: '该域名授权已被吊销' };
    if (row.status === 'banned') return { reason: 'invalid_banned', message: '该域名授权已被封禁' };
    if (row.status === 'suspended') return { reason: 'invalid_suspended', message: '该域名授权已被暂停' };
    if (row.validFrom.getTime() > Date.now()) return { reason: 'invalid_not_found', message: '该域名授权尚未生效' };
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return { reason: 'invalid_expired', message: '该域名授权已到期' };
    return null;
  }

  private toEntitlements(
    row: typeof domainLicenses.$inferSelect,
    meta: { productSlug: string; planCode: string; domain: string; heartbeatHours: number; offlineGraceDays: number },
    override?: { valid: boolean; reason?: Entitlements['reason']; message?: string },
  ): Entitlements {
    return {
      valid: override?.valid ?? true,
      ...(override?.reason ? { reason: override.reason } : {}),
      ...(override?.message ? { message: override.message } : {}),
      domainLicenseId: row.id,
      product: meta.productSlug,
      plan: meta.planCode,
      status: row.status,
      domain: meta.domain,
      domainCount: row.domainCount,
      maxDomains: row.maxDomains,
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
      perpetual: row.expiresAt === null,
      features: row.featureKeys,
      heartbeatIntervalHours: meta.heartbeatHours,
      offlineGraceDays: meta.offlineGraceDays,
    };
  }

  /* ------------------------------------------------ 管理端 CRUD */

  private baseSelect() {
    return this.db.select({
      id: domainLicenses.id,
      productId: domainLicenses.productId,
      productName: products.name,
      productSlug: products.slug,
      planId: domainLicenses.planId,
      planCode: plans.code,
      planName: plans.name,
      customerId: domainLicenses.customerId,
      customerEmail: domainLicenses.customerEmail,
      status: domainLicenses.status,
      maxDomains: domainLicenses.maxDomains,
      allowSubdomains: domainLicenses.allowSubdomains,
      domainCount: domainLicenses.domainCount,
      featureKeys: domainLicenses.featureKeys,
      validFrom: domainLicenses.validFrom,
      expiresAt: domainLicenses.expiresAt,
      notes: domainLicenses.notes,
      lastVerifiedAt: domainLicenses.lastVerifiedAt,
      createdAt: domainLicenses.createdAt,
    }).from(domainLicenses)
      .innerJoin(products, eq(products.id, domainLicenses.productId))
      .innerJoin(plans, eq(plans.id, domainLicenses.planId));
  }

  async list(query: ListDomainLicensesDto) {
    const { page, pageSize, offset } = normalizePaging(query.page, query.pageSize);
    const conditions: SQL[] = [];
    if (query.productId) conditions.push(eq(domainLicenses.productId, query.productId));
    if (query.status) conditions.push(eq(domainLicenses.status, query.status));
    if (query.customerEmail) conditions.push(sql`lower(${domainLicenses.customerEmail}) like ${'%' + query.customerEmail.toLowerCase() + '%'}`);
    if (query.q) {
      const like = '%' + query.q + '%';
      const search = or(
        sql`lower(${domainLicenses.customerEmail}) like ${like.toLowerCase()}`,
        sql`${domainLicenses.notes} ilike ${like}`,
        sql`exists (select 1 from ${authorizedDomains} where ${authorizedDomains.domainLicenseId} = ${domainLicenses.id} and ${authorizedDomains.domain} ilike ${like})`,
      );
      if (search) conditions.push(search);
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const items = await this.baseSelect().where(where)
      .orderBy(desc(domainLicenses.createdAt))
      .limit(pageSize).offset(offset);
    const [totalRow] = await this.db.select({ value: count() }).from(domainLicenses).where(where);
    return { items: items as DomainLicenseView[], total: Number(totalRow?.value ?? 0), page, pageSize };
  }

  async stats() {
    const [row] = await this.db.select({
      total: count(),
      active: sql<number>`count(*) filter (where ${domainLicenses.status} = 'active')::int`,
      expiring7d: sql<number>`count(*) filter (where ${domainLicenses.expiresAt} is not null and ${domainLicenses.expiresAt} between now() and now() + interval '7 days')::int`,
    }).from(domainLicenses);
    const [domains] = await this.db.select({ value: count() }).from(authorizedDomains)
      .where(eq(authorizedDomains.status, 'active'));
    return {
      total: Number(row?.total ?? 0),
      active: row?.active ?? 0,
      expiring7d: row?.expiring7d ?? 0,
      activeDomains: Number(domains?.value ?? 0),
    };
  }

  async get(id: string): Promise<DomainLicenseView> {
    const [row] = await this.baseSelect().where(eq(domainLicenses.id, id)).limit(1);
    if (!row) throw AppError.notFound('域名授权不存在');
    return row as DomainLicenseView;
  }

  async detail(id: string) {
    const license = await this.get(id);
    const [domains, events] = await Promise.all([
      this.listDomains(id),
      this.db.select().from(domainEvents).where(eq(domainEvents.domainLicenseId, id))
        .orderBy(desc(domainEvents.createdAt)).limit(50),
    ]);
    return { ...license, domains, events };
  }

  private async resolvePlan(productId: string, planId?: string, planCode?: string) {
    await this.products.findById(productId);
    const plan = planId
      ? await this.products.findPlan(planId)
      : planCode
        ? await this.products.findPlanByCode(productId, planCode)
        : null;
    if (!plan) throw AppError.badRequest(ErrorCodes.VALIDATION_FAILED, '必须提供 planId 或 planCode');
    if (plan.productId !== productId) throw AppError.badRequest(ErrorCodes.VALIDATION_FAILED, '套餐不属于该产品');
    return plan;
  }

  async create(dto: CreateDomainLicenseDto, actor: { id?: string; email?: string }) {
    const plan = await this.resolvePlan(dto.productId, dto.planId, dto.planCode);
    if ((dto.maxDomains ?? plan.maxDomains) <= 0) {
      throw AppError.badRequest(
        ErrorCodes.DOMAIN_NOT_ALLOWED,
        '该套餐未开启域名授权（域名额度为 0），请先在产品里配置「域名授权」或手工指定额度',
      );
    }

    const email = dto.customerEmail?.trim().toLowerCase() ?? null;
    let customerId: string | null = null;
    if (email) {
      const [customer] = await this.db.select({ id: customers.id }).from(customers)
        .where(eq(customers.email, email)).limit(1);
      customerId = customer?.id ?? null;
    }

    const expiresAt = dto.expiresAt
      ? new Date(dto.expiresAt)
      : plan.durationDays
        ? new Date(Date.now() + plan.durationDays * 86_400_000)
        : null;

    const [row] = await this.db.insert(domainLicenses).values({
      productId: dto.productId,
      planId: plan.id,
      customerId,
      customerEmail: email,
      status: 'active',
      maxDomains: dto.maxDomains ?? plan.maxDomains,
      allowSubdomains: dto.allowSubdomains ?? plan.allowSubdomains,
      featureKeys: plan.featureKeys,
      validFrom: new Date(),
      expiresAt,
      notes: dto.notes ?? null,
      issuedBy: actor.id ?? null,
    }).returning();

    await this.recordEvent({
      domainLicenseId: row.id,
      type: 'created',
      actorType: 'admin',
      actorId: actor.id ?? null,
      actorLabel: actor.email ?? null,
      message: '创建域名授权（' + plan.name + '）',
    });

    const rawDomains = Array.isArray(dto.domains)
      ? dto.domains
      : typeof dto.domains === 'string'
        ? dto.domains.split(/[,\n;]/)
        : [];
    const added: string[] = [];
    const failed: { domain: string; message: string }[] = [];
    for (const raw of rawDomains.map((item) => String(item).trim()).filter(Boolean)) {
      try {
        const result = await this.addDomain(row.id, { domain: raw }, { id: actor.id, email: actor.email, type: 'admin' });
        added.push(result.domain);
      } catch (error) {
        failed.push({ domain: raw, message: error instanceof Error ? error.message : String(error) });
      }
    }

    return { license: await this.detail(row.id), addedDomains: added, failedDomains: failed };
  }

  async update(id: string, dto: UpdateDomainLicenseDto, actor: { id?: string; email?: string }) {
    await this.get(id);
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.expiresAt !== undefined) patch.expiresAt = dto.expiresAt === null ? null : new Date(dto.expiresAt);
    if (dto.maxDomains !== undefined) patch.maxDomains = dto.maxDomains;
    if (dto.allowSubdomains !== undefined) patch.allowSubdomains = dto.allowSubdomains;
    if (dto.notes !== undefined) patch.notes = dto.notes;
    if (dto.customerEmail !== undefined) {
      const email = dto.customerEmail ? dto.customerEmail.trim().toLowerCase() : null;
      patch.customerEmail = email;
      if (email) {
        const [customer] = await this.db.select({ id: customers.id }).from(customers).where(eq(customers.email, email)).limit(1);
        patch.customerId = customer?.id ?? null;
      } else {
        patch.customerId = null;
      }
    }
    if (dto.status !== undefined) {
      patch.status = dto.status;
      if (dto.status === 'revoked' || dto.status === 'banned') {
        patch.revokedAt = new Date();
      }
    }
    await this.db.update(domainLicenses).set(patch).where(eq(domainLicenses.id, id));
    await this.recordEvent({
      domainLicenseId: id,
      type: 'updated',
      actorType: 'admin',
      actorId: actor.id ?? null,
      actorLabel: actor.email ?? null,
      message: '修改域名授权',
      payload: patch as Record<string, unknown>,
    });
    return this.detail(id);
  }

  async transition(id: string, action: 'revoke' | 'suspend' | 'resume' | 'ban', reason: string | undefined, actor: { id?: string; email?: string }) {
    const current = await this.get(id);
    const target: Record<typeof action, LicenseStatus> = { revoke: 'revoked', suspend: 'suspended', resume: 'active', ban: 'banned' };
    const next = target[action];
    if (current.status === next) throw AppError.conflict('域名授权已处于「' + next + '」状态');
    // resume 仅允许从 suspended 恢复：不得把 banned/revoked 复活（N11）
    if (action === 'resume' && current.status !== 'suspended') {
      throw AppError.conflict('仅「已暂停」的域名授权可以恢复（当前状态：' + current.status + '）');
    }
    const patch: Record<string, unknown> = { status: next, updatedAt: new Date() };
    if (action === 'revoke' || action === 'ban') {
      patch.revokedAt = new Date();
      patch.revokedReason = reason ?? null;
    }
    if (action === 'resume') {
      patch.revokedAt = null;
      patch.revokedReason = null;
    }
    await this.db.update(domainLicenses).set(patch).where(eq(domainLicenses.id, id));
    await this.recordEvent({
      domainLicenseId: id,
      type: action === 'ban' ? 'banned' : action === 'revoke' ? 'revoked' : action === 'suspend' ? 'suspended' : 'resumed',
      actorType: 'admin',
      actorId: actor.id ?? null,
      actorLabel: actor.email ?? null,
      message: reason ?? null,
      payload: { from: current.status, to: next },
    });
    return this.get(id);
  }

  async extend(id: string, days: number, reason: string | undefined, actor: { id?: string; email?: string }) {
    const current = await this.get(id);
    const base = current.expiresAt && current.expiresAt.getTime() > Date.now() ? current.expiresAt.getTime() : Date.now();
    const next = new Date(base + days * 86_400_000);
    await this.db.update(domainLicenses)
      .set({ expiresAt: next, status: current.status === 'expired' ? 'active' : current.status, updatedAt: new Date() })
      .where(eq(domainLicenses.id, id));
    await this.recordEvent({
      domainLicenseId: id,
      type: 'extended',
      actorType: 'admin',
      actorId: actor.id ?? null,
      actorLabel: actor.email ?? null,
      message: reason ?? '延长 ' + days + ' 天',
      payload: { days, to: next.toISOString() },
    });
    return this.get(id);
  }

  /**
   * 删除域名授权（不可恢复）：已授权域名与事件随外键级联删除。
   * 想保留记录只让站点失效，请用 revoke/suspend 而不是删除。
   */
  async remove(id: string, actor: { id?: string; email?: string }) {
    const snapshot = await this.detail(id);
    const rows = await this.db.delete(domainLicenses).where(eq(domainLicenses.id, id)).returning({ id: domainLicenses.id });
    if (rows.length === 0) throw AppError.notFound('域名授权不存在');

    const activeDomains = snapshot.domains.filter((row) => row.status === 'active').map((row) => row.domain);
    for (const domain of activeDomains) {
      await this.webhooks.emit('domain.unbound', {
        domainLicenseId: id,
        domain,
        reason: 'domain_license_deleted',
        domainCount: 0,
      }).catch(() => undefined);
    }
    await this.audit.record({
      actorType: 'admin',
      actorId: actor.id ?? null,
      actorEmail: actor.email ?? null,
      action: 'domain_license.delete',
      targetType: 'domain_license',
      targetId: id,
      diff: {
        before: {
          product: snapshot.productName,
          plan: snapshot.planCode,
          customerEmail: snapshot.customerEmail,
          status: snapshot.status,
          releasedDomains: activeDomains,
        },
      },
    });
    return { ok: true, releasedDomains: activeDomains };
  }

  /* ------------------------------------------------ 域名绑定 */

  async listDomains(domainLicenseId: string) {
    return this.db.select().from(authorizedDomains)
      .where(eq(authorizedDomains.domainLicenseId, domainLicenseId))
      .orderBy(desc(authorizedDomains.lastSeenAt));
  }

  /** 绑定域名：额度校验 + 全局唯一（同一域名不能同时属于两张有效授权）。 */
  async addDomain(
    domainLicenseId: string,
    dto: AddDomainDto,
    actor: { id?: string; email?: string; type?: 'admin' | 'customer' },
  ) {
    const parsed = normalizeDomain(dto.domain);
    if (!parsed.valid) {
      throw AppError.badRequest(
        ErrorCodes.DOMAIN_INVALID,
        '域名格式不正确：' + (dto.domain || '(空)') + '（示例：example.com 或 https://www.example.com）',
        { reason: parsed.reason },
      );
    }

    const [license] = await this.db.select().from(domainLicenses).where(eq(domainLicenses.id, domainLicenseId)).limit(1);
    if (!license) throw AppError.notFound('域名授权不存在');

    const existingInThis = await this.db.select().from(authorizedDomains)
      .where(and(eq(authorizedDomains.domainLicenseId, domainLicenseId), eq(authorizedDomains.status, 'active')));
    if (existingInThis.some((row) => row.domain === parsed.domain)) {
      // 用同一个错误码，客户端不必区分「自己重复」还是「被别人占用」
      throw new AppError(ErrorCodes.DOMAIN_ALREADY_AUTHORIZED, '该域名已在当前授权下：' + parsed.domain, 409);
    }

    const [conflict] = await this.db.select({ id: authorizedDomains.id, licenseId: authorizedDomains.domainLicenseId })
      .from(authorizedDomains)
      .where(and(eq(authorizedDomains.domain, parsed.domain), eq(authorizedDomains.status, 'active')))
      .limit(1);
    if (conflict) {
      throw new AppError(ErrorCodes.DOMAIN_ALREADY_AUTHORIZED, '域名 ' + parsed.domain + ' 已被另一张域名授权占用', 409);
    }

    if (license.domainCount >= license.maxDomains) {
      throw new AppError(
        ErrorCodes.DOMAIN_LIMIT_REACHED,
        '域名额度已用完（' + license.maxDomains + ' 个），请先解绑不用的域名',
        409,
        { maxDomains: license.maxDomains, domainCount: license.domainCount },
      );
    }

    // 原子占额：条件更新防止并发 TOCTOU 超发（N9）
    const claimed = await this.db.update(domainLicenses)
      .set({ domainCount: sql`${domainLicenses.domainCount} + 1`, updatedAt: new Date() })
      .where(and(
        eq(domainLicenses.id, domainLicenseId),
        sql`${domainLicenses.domainCount} < ${domainLicenses.maxDomains}`,
      ))
      .returning({ domainCount: domainLicenses.domainCount, maxDomains: domainLicenses.maxDomains });
    if (claimed.length === 0) {
      const [fresh] = await this.db.select().from(domainLicenses).where(eq(domainLicenses.id, domainLicenseId)).limit(1);
      throw new AppError(
        ErrorCodes.DOMAIN_LIMIT_REACHED,
        '域名额度已用完（' + (fresh?.maxDomains ?? license.maxDomains) + ' 个），请先解绑不用的域名',
        409,
        { maxDomains: fresh?.maxDomains ?? license.maxDomains, domainCount: fresh?.domainCount ?? license.domainCount },
      );
    }
    const domainCount = claimed[0].domainCount;
    const maxDomains = claimed[0].maxDomains;

    let row: (typeof authorizedDomains.$inferSelect) | undefined;
    try {
      [row] = await this.db.insert(authorizedDomains).values({
        domainLicenseId,
        domain: parsed.domain,
        domainRaw: dto.domain,
        environment: dto.environment ?? 'production',
        source: actor.type ?? 'admin',
        metadata: actor.id ? { addedBy: actor.id } : {},
      }).returning();
    } catch (error) {
      // 插入失败回滚占额，避免额度被白白吃掉
      await this.db.update(domainLicenses)
        .set({ domainCount: sql`${domainLicenses.domainCount} - 1`, updatedAt: new Date() })
        .where(eq(domainLicenses.id, domainLicenseId));
      throw error;
    }
    if (!row) throw AppError.conflict('域名绑定失败，请重试');

    await this.recordEvent({
      domainLicenseId,
      type: 'domain_added',
      actorType: actor.type === 'customer' ? 'customer' : 'admin',
      actorId: actor.id ?? null,
      actorLabel: actor.email ?? null,
      domain: parsed.domain,
      message: '绑定域名：' + parsed.domain + (parsed.isLocal ? '（本地/内网）' : ''),
    });
    await this.webhooks.emit('domain.bound', {
      domainLicenseId,
      domain: parsed.domain,
      customerEmail: license.customerEmail,
      domainCount,
      maxDomains,
    }).catch(() => undefined);

    return { ...row, domainCount, maxDomains };
  }

  /** 解绑域名（管理端与门户共用）。 */
  async removeDomain(domainId: string, actor: { id?: string; email?: string; type?: 'admin' | 'customer' }, reason?: string) {
    const [row] = await this.db.select().from(authorizedDomains).where(eq(authorizedDomains.id, domainId)).limit(1);
    if (!row) throw AppError.notFound('域名绑定记录不存在');
    if (row.status !== 'active') throw AppError.conflict('该域名未处于绑定状态');

    await this.db.update(authorizedDomains)
      .set({ status: 'deactivated', deactivatedAt: new Date(), unbindReason: reason ?? 'unbind' })
      .where(eq(authorizedDomains.id, domainId));

    const [activeRow] = await this.db.select({ value: count() }).from(authorizedDomains)
      .where(and(eq(authorizedDomains.domainLicenseId, row.domainLicenseId), eq(authorizedDomains.status, 'active')));
    const domainCount = Number(activeRow?.value ?? 0);
    await this.db.update(domainLicenses)
      .set({ domainCount, updatedAt: new Date() })
      .where(eq(domainLicenses.id, row.domainLicenseId));

    await this.recordEvent({
      domainLicenseId: row.domainLicenseId,
      type: 'domain_removed',
      actorType: actor.type === 'customer' ? 'customer' : 'admin',
      actorId: actor.id ?? null,
      actorLabel: actor.email ?? null,
      domain: row.domain,
      message: (reason ?? '解绑域名') + '：' + row.domain,
    });
    await this.webhooks.emit('domain.unbound', {
      domainLicenseId: row.domainLicenseId,
      domain: row.domain,
      reason: reason ?? 'unbind',
      domainCount,
    }).catch(() => undefined);

    return { ok: true, domain: row.domain, domainCount };
  }

  /* ------------------------------------------------ 客户端（网站自助激活） */

  /**
   * 按域名查找有效授权。
   * 先精确匹配，再在允许子域时按父域名匹配（授权 example.com 覆盖 a.example.com）。
   */
  private async resolveByDomain(domain: string, productSlug?: string) {
    const rows = await this.db.select({
      domain: authorizedDomains,
      license: domainLicenses,
      plan: plans,
      product: products,
    }).from(authorizedDomains)
      .innerJoin(domainLicenses, eq(domainLicenses.id, authorizedDomains.domainLicenseId))
      .innerJoin(plans, eq(plans.id, domainLicenses.planId))
      .innerJoin(products, eq(products.id, domainLicenses.productId))
      .where(and(
        eq(authorizedDomains.status, 'active'),
        productSlug ? eq(products.slug, productSlug) : sql`true`,
        or(
          eq(authorizedDomains.domain, domain),
          // 父域名候选：取候选自身的后缀（如 a.b.com → b.com）
          like(authorizedDomains.domain, '%' + domain.slice(domain.indexOf('.') + 1)),
        ),
      ));

    const exact = rows.find((row) => row.domain.domain === domain);
    if (exact) return exact;
    return rows.find((row) => domainMatches(domain, row.domain.domain, row.license.allowSubdomains)) ?? null;
  }

  async activate(dto: DomainActivateDto, ctx: DomainClientContext) {
    const parsed = normalizeDomain(dto.domain);
    if (!parsed.valid) {
      throw AppError.badRequest(ErrorCodes.DOMAIN_INVALID, '域名格式不正确：' + (dto.domain || '(空)'), { reason: parsed.reason });
    }
    // API Key 绑定产品且未显式传 product 时，按 API Key 的产品过滤（C3/N20）
    const productFilter = dto.product ?? await this.apiKeyProductSlug(ctx.apiKeyProductId);
    const resolved = await this.resolveByDomain(parsed.domain, productFilter);
    if (!resolved || !this.apiKeyProductMatches(resolved, ctx.apiKeyProductId)) {
      throw new AppError(
        ErrorCodes.DOMAIN_NOT_AUTHORIZED,
        '域名 ' + parsed.domain + ' 尚未获得授权，请在服务商后台为该域名开通授权后重试',
        404,
        { domain: parsed.domain },
      );
    }

    const { license, plan, product } = resolved;
    const invalid = this.validateState(license);
    if (invalid) {
      throw new AppError(
        invalid.reason === 'invalid_expired' ? ErrorCodes.LICENSE_EXPIRED : ErrorCodes.LICENSE_REVOKED,
        invalid.message,
        410,
      );
    }

    await this.db.update(authorizedDomains)
      .set({
        lastSeenAt: new Date(),
        lastIp: ctx.ip ?? resolved.domain.lastIp,
        userAgent: dto.userAgent ?? resolved.domain.userAgent,
        environment: dto.environment ?? resolved.domain.environment,
        verifyCount: resolved.domain.verifyCount + 1,
      })
      .where(eq(authorizedDomains.id, resolved.domain.id));
    await this.db.update(domainLicenses)
      .set({ lastVerifiedAt: new Date() })
      .where(eq(domainLicenses.id, license.id));

    const file = await this.signFile(license, {
      productSlug: product.slug,
      planCode: plan.code,
      domain: resolved.domain.domain,
      usedDomains: license.domainCount,
      offlineGraceDays: plan.offlineGraceDays,
    });
    const accessToken = await this.signClientToken(license.id, resolved.domain.domain, plan.heartbeatIntervalHours);

    return {
      valid: true as const,
      domain: resolved.domain.domain,
      accessToken,
      expiresIn: Math.min(72, Math.max(6, plan.heartbeatIntervalHours * 3)) * 3600,
      licenseFile: file,
      entitlements: this.toEntitlements(license, {
        productSlug: product.slug,
        planCode: plan.code,
        domain: resolved.domain.domain,
        heartbeatHours: plan.heartbeatIntervalHours,
        offlineGraceDays: plan.offlineGraceDays,
      }),
    };
  }

  async verify(dto: DomainVerifyDto, ctx: Pick<DomainClientContext, 'apiKeyProductId'> = {}): Promise<Entitlements> {
    const parsed = normalizeDomain(dto.domain);
    if (!parsed.valid) {
      return { valid: false, reason: 'invalid_device', message: '域名格式不正确：' + dto.domain, domain: dto.domain };
    }

    // 传入 product 过滤（请求显式 product 优先，否则用 API Key 绑定的产品）（N20）
    const productFilter = dto.product ?? await this.apiKeyProductSlug(ctx.apiKeyProductId);
    const resolved = await this.resolveByDomain(parsed.domain, productFilter);
    if (!resolved || !this.apiKeyProductMatches(resolved, ctx.apiKeyProductId)) {
      return { valid: false, reason: 'invalid_not_found', message: '域名未授权', domain: parsed.domain };
    }
    const { license, plan, product } = resolved;

    // 携带 accessToken 时必须校验：domain-client 受众 + 绑定该授权/域名
    if (dto.accessToken) {
      try {
        await this.verifyClientToken(dto.accessToken, {
          domainLicenseId: license.id,
          domain: resolved.domain.domain,
        });
      } catch {
        return { valid: false, reason: 'invalid_device', message: '访问令牌无效', domain: resolved.domain.domain };
      }
    }

    const meta = {
      productSlug: product.slug,
      planCode: plan.code,
      domain: resolved.domain.domain,
      heartbeatHours: plan.heartbeatIntervalHours,
      offlineGraceDays: plan.offlineGraceDays,
    };
    const invalid = this.validateState(license);
    if (invalid) return this.toEntitlements(license, meta, { valid: false, reason: invalid.reason, message: invalid.message });

    await this.db.update(authorizedDomains)
      .set({
        lastSeenAt: new Date(),
        userAgent: dto.userAgent ?? resolved.domain.userAgent,
        verifyCount: resolved.domain.verifyCount + 1,
      })
      .where(eq(authorizedDomains.id, resolved.domain.id));

    return this.toEntitlements(license, meta);
  }

  async deactivate(dto: DomainDeactivateDto, ctx: Pick<DomainClientContext, 'apiKeyProductId'> = {}) {
    const parsed = normalizeDomain(dto.domain);
    if (!parsed.valid) throw AppError.badRequest(ErrorCodes.DOMAIN_INVALID, '域名格式不正确');
    const productFilter = await this.apiKeyProductSlug(ctx.apiKeyProductId);
    const resolved = await this.resolveByDomain(parsed.domain, productFilter);
    if (!resolved || !this.apiKeyProductMatches(resolved, ctx.apiKeyProductId)) {
      throw new AppError(ErrorCodes.DOMAIN_NOT_AUTHORIZED, '该域名未获得授权', 404);
    }
    // 解绑必须持有签发给该域名的 domain-client 令牌（C3）
    await this.verifyClientToken(dto.accessToken, {
      domainLicenseId: resolved.license.id,
      domain: resolved.domain.domain,
    });
    return this.removeDomain(resolved.domain.id, { type: 'admin' }, dto.reason ?? 'client_request');
  }

  /* ------------------------------------------------ 门户（客户自助） */

  async listForCustomer(customerId: string, email: string) {
    // 邮箱兜底仅对已验证邮箱开放（C2）
    const [customer] = await this.db.select({
      email: customers.email,
      emailVerifiedAt: customers.emailVerifiedAt,
    }).from(customers).where(eq(customers.id, customerId)).limit(1);
    const emailVerified = Boolean(customer?.emailVerifiedAt);
    const ownership = emailVerified
      ? or(
        eq(domainLicenses.customerId, customerId),
        sql`lower(${domainLicenses.customerEmail}) = ${email.toLowerCase()}`,
      )
      : eq(domainLicenses.customerId, customerId);
    const rows = await this.baseSelect()
      .where(ownership)
      .orderBy(desc(domainLicenses.createdAt));
    const ids = rows.map((row) => row.id);
    const domains = ids.length > 0
      ? await this.db.select().from(authorizedDomains).where(inArray(authorizedDomains.domainLicenseId, ids))
      : [];
    return rows.map((row) => ({
      ...row,
      domains: domains.filter((domain) => domain.domainLicenseId === row.id),
    }));
  }

  /** 客户自助添加域名（在自己的额度内）。 */
  async addDomainForCustomer(customerId: string, email: string, domainLicenseId: string, domain: string) {
    const [license] = await this.db.select().from(domainLicenses).where(eq(domainLicenses.id, domainLicenseId)).limit(1);
    if (!license) throw AppError.notFound('域名授权不存在');
    const owns = license.customerId === customerId
      || await this.ownsByVerifiedEmail(customerId, license.customerEmail);
    if (!owns) throw AppError.notFound('域名授权不存在或不属于当前账号');

    const parsed = normalizeDomain(domain);
    if (!parsed.valid) {
      throw AppError.badRequest(ErrorCodes.DOMAIN_INVALID, '域名格式不正确：' + (domain || '(空)'), { reason: parsed.reason });
    }
    const result = await this.addDomain(domainLicenseId, { domain }, { id: customerId, email, type: 'customer' });
    await this.mail.send({
      to: email,
      template: 'domain_authorized',
      vars: { name: email, domain: parsed.domain, expiresAt: license.expiresAt ? license.expiresAt.toISOString().slice(0, 10) : '长期有效' },
      relatedType: 'domain_license',
      relatedId: domainLicenseId,
    }).catch(() => undefined);
    return result;
  }

  async removeDomainForCustomer(customerId: string, email: string, domainId: string) {
    const [row] = await this.db.select().from(authorizedDomains).where(eq(authorizedDomains.id, domainId)).limit(1);
    if (!row) throw AppError.notFound('域名绑定记录不存在');
    const [license] = await this.db.select().from(domainLicenses).where(eq(domainLicenses.id, row.domainLicenseId)).limit(1);
    const owns = license && (license.customerId === customerId
      || await this.ownsByVerifiedEmail(customerId, license.customerEmail));
    if (!owns) throw AppError.notFound('域名授权不存在或不属于当前账号');
    return this.removeDomain(domainId, { id: customerId, email, type: 'customer' }, 'customer_self_service');
  }

  /** 定时任务：把到期的域名授权置为 expired，并自动解绑其域名。 */
  async expireOverdue(): Promise<number> {
    const rows = await this.db.update(domainLicenses)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(and(
        sql`${domainLicenses.expiresAt} is not null and ${domainLicenses.expiresAt} < now()`,
        inArray(domainLicenses.status, ['active', 'suspended']),
      ))
      .returning({ id: domainLicenses.id });
    for (const row of rows) {
      await this.recordEvent({
        domainLicenseId: row.id,
        type: 'expired',
        actorType: 'system',
        message: '域名授权到期自动失效',
      });
    }
    return rows.length;
  }

  /** 待办统计：7 天内到期的域名授权数。 */
  async expiringSoonCount(): Promise<number> {
    const [row] = await this.db.select({ value: count() }).from(domainLicenses)
      .where(and(
        isNull(domainLicenses.revokedAt),
        sql`${domainLicenses.expiresAt} is not null`,
        sql`${domainLicenses.expiresAt} between now() and now() + interval '7 days'`,
        inArray(domainLicenses.status, ['active']),
      ));
    return Number(row?.value ?? 0);
  }
}