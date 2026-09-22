import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { DB } from '../../db/db.module';
import type { DatabaseHandle } from '../../db/db.provider';
import { licenses, plans, productFeatures, productReleases, products } from '../../db/schema';
import { AppError, ErrorCodes } from '../../common/errors';
import { normalizePaging, type PageResult } from '../../common/pagination';
import type {
  CreateFeatureDto, CreatePlanDto, CreateProductDto, CreateReleaseDto,
  ProductListDto, UpdatePlanDto, UpdateProductDto,
} from './dto';

export interface ProductWithCounts {
  id: string;
  slug: string;
  name: string;
  description: string;
  logoUrl: string | null;
  websiteUrl: string | null;
  status: string;
  keyPrefix: string | null;
  planCount: number;
  licenseCount: number;
  activeLicenseCount: number;
  createdAt: Date;
}

@Injectable()
export class ProductsService {
  constructor(@Inject(DB) private readonly handle: DatabaseHandle) {}

  private get db() {
    return this.handle.db;
  }

  /* ------------------------------------------------ 产品 */

  async list(query: ProductListDto): Promise<PageResult<ProductWithCounts>> {
    const { page, pageSize, offset } = normalizePaging(query.page, query.pageSize);
    const conditions: SQL[] = [];
    if (query.status) conditions.push(eq(products.status, query.status));
    if (query.q) {
      const like = '%' + query.q + '%';
      const search = or(ilike(products.name, like), ilike(products.slug, like));
      if (search) conditions.push(search);
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await this.db.select({
      id: products.id,
      slug: products.slug,
      name: products.name,
      description: products.description,
      logoUrl: products.logoUrl,
      websiteUrl: products.websiteUrl,
      status: products.status,
      keyPrefix: products.keyPrefix,
      createdAt: products.createdAt,
      // ⚠️ 关联子查询必须写成「无插值的裸 SQL」：
      // drizzle 在 sql 模板里遇到表对象会省略表限定名（生成 where "product_id" = "id"），
      // 子查询里会退化成自比较，静默返回 0。这里显式写全表名。
      planCount: sql<number>`(select count(*)::int from plans where plans.product_id = products.id)`,
      licenseCount: sql<number>`(select count(*)::int from licenses where licenses.product_id = products.id)`,
      activeLicenseCount: sql<number>`(select count(*)::int from licenses where licenses.product_id = products.id and licenses.status = 'active')`,
    }).from(products).where(where)
      .orderBy(desc(products.createdAt))
      .limit(pageSize).offset(offset);

    const [totalRow] = await this.db.select({ value: count() }).from(products).where(where);
    return { items: rows, total: Number(totalRow?.value ?? 0), page, pageSize };
  }

  async findById(id: string) {
    const [row] = await this.db.select().from(products).where(eq(products.id, id)).limit(1);
    if (!row) throw AppError.notFound('产品不存在');
    return row;
  }

  async findBySlug(slug: string) {
    const [row] = await this.db.select().from(products).where(eq(products.slug, slug)).limit(1);
    return row ?? null;
  }

  async detail(id: string) {
    const product = await this.findById(id);
    const [productPlans, features, releases] = await Promise.all([
      this.db.select().from(plans).where(eq(plans.productId, id)).orderBy(asc(plans.priceCents)),
      this.db.select().from(productFeatures).where(eq(productFeatures.productId, id)).orderBy(asc(productFeatures.key)),
      this.db.select().from(productReleases).where(eq(productReleases.productId, id)).orderBy(desc(productReleases.publishedAt)),
    ]);
    return { ...product, plans: productPlans, features, releases };
  }

  async create(dto: CreateProductDto, actorId?: string) {
    const existing = await this.findBySlug(dto.slug);
    if (existing) throw AppError.conflict('slug 已被占用：' + dto.slug);
    const [row] = await this.db.insert(products).values({
      slug: dto.slug,
      name: dto.name,
      description: dto.description ?? '',
      logoUrl: dto.logoUrl ?? null,
      websiteUrl: dto.websiteUrl ?? null,
      status: dto.status ?? 'draft',
      keyPrefix: dto.keyPrefix ?? dto.slug.slice(0, 4).toUpperCase(),
      metadata: actorId ? { createdBy: actorId } : {},
    }).returning();
    return row;
  }

  async update(id: string, dto: UpdateProductDto) {
    await this.findById(id);
    const [row] = await this.db.update(products)
      .set({ ...dto, updatedAt: new Date() })
      .where(eq(products.id, id))
      .returning();
    return row;
  }

  /**
   * 删除产品：只有「没有任何授权」时才真正删除（连带策略/功能点/版本）。
   * 一旦产生过授权，就只允许归档 —— 授权记录依赖外键，物理删除会造成悬空数据。
   */
  async remove(id: string): Promise<{ ok: true; deleted: true } | { ok: true; archived: true; reason: string }> {
    await this.findById(id);
    const [licenseCount] = await this.db.select({ value: count() }).from(licenses).where(eq(licenses.productId, id));
    if (Number(licenseCount?.value ?? 0) > 0) {
      throw AppError.conflict(
        '该产品下还有 ' + licenseCount?.value + ' 条授权，无法删除。请先处理这些授权，或改为「归档」。',
        { licenseCount: Number(licenseCount?.value ?? 0) },
      );
    }
    try {
      await this.db.delete(plans).where(eq(plans.productId, id));
      await this.db.delete(products).where(eq(products.id, id));
      return { ok: true, deleted: true };
    } catch {
      // 还有卡密批次 / 域名授权等引用：退回归档
      await this.db.update(products).set({ status: 'archived', updatedAt: new Date() }).where(eq(products.id, id));
      return { ok: true, archived: true, reason: '该产品仍被卡密批次或域名授权引用，已改为归档' };
    }
  }

  /** 删除策略：没有授权使用时真删，否则归档。 */
  async removePlan(planId: string): Promise<{ ok: true; deleted: boolean; reason?: string }> {
    await this.findPlan(planId);
    const [used] = await this.db.select({ value: count() }).from(licenses).where(eq(licenses.planId, planId));
    if (Number(used?.value ?? 0) > 0) {
      await this.db.update(plans).set({ status: 'archived', updatedAt: new Date() }).where(eq(plans.id, planId));
      return { ok: true, deleted: false, reason: '已有 ' + used?.value + ' 条授权使用该策略，已改为归档' };
    }
    try {
      await this.db.delete(plans).where(eq(plans.id, planId));
      return { ok: true, deleted: true };
    } catch {
      await this.db.update(plans).set({ status: 'archived', updatedAt: new Date() }).where(eq(plans.id, planId));
      return { ok: true, deleted: false, reason: '该策略仍被卡密批次或域名授权引用，已改为归档' };
    }
  }

  /** 归档而不是物理删除：授权记录依赖外键，误删会造成悬空数据。 */
  async archive(id: string) {
    await this.findById(id);
    const [row] = await this.db.update(products)
      .set({ status: 'archived', updatedAt: new Date() })
      .where(eq(products.id, id))
      .returning();
    return row;
  }

  /* ------------------------------------------------ 策略 */

  async listPlans(productId: string) {
    await this.findById(productId);
    return this.db.select().from(plans).where(eq(plans.productId, productId)).orderBy(asc(plans.priceCents));
  }

  async findPlan(planId: string) {
    const [row] = await this.db.select().from(plans).where(eq(plans.id, planId)).limit(1);
    if (!row) throw AppError.notFound('授权策略不存在');
    return row;
  }

  async findPlanByCode(productId: string, code: string) {
    const [row] = await this.db.select().from(plans)
      .where(and(eq(plans.productId, productId), eq(plans.code, code))).limit(1);
    return row ?? null;
  }

  async createPlan(productId: string, dto: CreatePlanDto) {
    await this.findById(productId);
    if (dto.licenseType === 'subscription' && !dto.durationDays) {
      throw AppError.badRequest(ErrorCodes.VALIDATION_FAILED, '订阅型策略必须设置有效期天数');
    }
    if (dto.licenseType === 'consumable' && !dto.maxUsages) {
      throw AppError.badRequest(ErrorCodes.VALIDATION_FAILED, '次数卡必须设置总次数');
    }
    const existing = await this.findPlanByCode(productId, dto.code);
    if (existing) throw AppError.conflict('该产品下已存在同名策略：' + dto.code);

    const [row] = await this.db.insert(plans).values({
      productId,
      code: dto.code,
      name: dto.name,
      description: dto.description ?? '',
      licenseType: dto.licenseType,
      durationDays: dto.durationDays ?? null,
      maxDevices: dto.maxDevices ?? 1,
      offlineGraceDays: dto.offlineGraceDays ?? 7,
      heartbeatIntervalHours: dto.heartbeatIntervalHours ?? 24,
      overLimitPolicy: dto.overLimitPolicy ?? 'reject',
      requireDeviceApproval: dto.requireDeviceApproval ?? false,
      featureKeys: dto.featureKeys ?? [],
      maxUsages: dto.maxUsages ?? null,
      maxDomains: dto.maxDomains ?? 0,
      allowSubdomains: dto.allowSubdomains ?? true,
      priceCents: dto.priceCents ?? 0,
      currency: dto.currency ?? 'CNY',
    }).returning();
    return row;
  }

  async updatePlan(planId: string, dto: UpdatePlanDto) {
    await this.findPlan(planId);
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of [
      'name', 'description', 'licenseType', 'durationDays', 'maxDevices', 'offlineGraceDays',
      'heartbeatIntervalHours', 'overLimitPolicy', 'requireDeviceApproval', 'featureKeys',
      'maxUsages', 'maxDomains', 'allowSubdomains', 'priceCents', 'currency', 'status',
    ] as const) {
      if (dto[key] !== undefined) patch[key] = dto[key];
    }
    const [row] = await this.db.update(plans).set(patch).where(eq(plans.id, planId)).returning();
    return row;
  }

  async archivePlan(planId: string) {
    await this.findPlan(planId);
    const [row] = await this.db.update(plans)
      .set({ status: 'archived', updatedAt: new Date() })
      .where(eq(plans.id, planId))
      .returning();
    return row;
  }

  /* ------------------------------------------------ 功能点 */

  async addFeature(productId: string, dto: CreateFeatureDto) {
    await this.findById(productId);
    const [existing] = await this.db.select().from(productFeatures)
      .where(and(eq(productFeatures.productId, productId), eq(productFeatures.key, dto.key))).limit(1);
    if (existing) throw AppError.conflict('功能点已存在：' + dto.key);
    const [row] = await this.db.insert(productFeatures).values({
      productId, key: dto.key, name: dto.name, description: dto.description ?? '',
    }).returning();
    return row;
  }

  async removeFeature(featureId: string) {
    const rows = await this.db.delete(productFeatures).where(eq(productFeatures.id, featureId)).returning();
    if (rows.length === 0) throw AppError.notFound('功能点不存在');
    return { ok: true };
  }

  /* ------------------------------------------------ 版本发布 */

  async addRelease(productId: string, dto: CreateReleaseDto) {
    await this.findById(productId);
    const [row] = await this.db.insert(productReleases).values({
      productId,
      version: dto.version,
      channel: dto.channel ?? 'stable',
      notes: dto.notes ?? '',
      downloadUrl: dto.downloadUrl ?? null,
      publishedAt: dto.publishedAt ? new Date(dto.publishedAt) : new Date(),
    }).returning();
    return row;
  }

  async latestRelease(productSlug: string, channel?: string) {
    const product = await this.findBySlug(productSlug);
    if (!product) return null;
    const conditions = [eq(productReleases.productId, product.id)];
    if (channel) conditions.push(eq(productReleases.channel, channel as 'stable'));
    const [row] = await this.db.select().from(productReleases)
      .where(and(...conditions))
      .orderBy(desc(productReleases.publishedAt))
      .limit(1);
    return row ?? null;
  }
}