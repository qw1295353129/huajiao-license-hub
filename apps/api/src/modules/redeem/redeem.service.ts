import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { formatLicenseKey, maskLicenseKey, normalizeLicenseKey } from '@license-hub/shared';
import { CONFIG_TOKEN, type AppConfig } from '../../config/configuration';
import { CryptoService } from '../../crypto/crypto.service';
import { DB } from '../../db/db.module';
import type { DatabaseHandle } from '../../db/db.provider';
import { plans, products, redeemBatches, redeemCodes } from '../../db/schema';
import { AppError, ErrorCodes } from '../../common/errors';
import { normalizePaging } from '../../common/pagination';
import { LicensesService } from '../licenses/licenses.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ProductsService } from '../products/products.service';
import { toCsv } from '../licenses/csv';
import type { CreateRedeemBatchDto, ListRedeemBatchesDto, ListRedeemCodesDto } from './dto';

/** 卡密字母表：与授权码一致，去掉了易混字符。 */
const CODE_LENGTH = 16;

@Injectable()
export class RedeemService {
  constructor(
    @Inject(DB) private readonly handle: DatabaseHandle,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
    private readonly crypto: CryptoService,
    private readonly products: ProductsService,
    private readonly licenses: LicensesService,
    private readonly mail: NotificationsService,
  ) {}

  private get db() {
    return this.handle.db;
  }

  /* ------------------------------------------------ 批次与卡密（管理端） */

  async createBatch(dto: CreateRedeemBatchDto, actor: { id?: string; email?: string }) {
    const product = await this.products.findById(dto.productId);
    const plan = dto.planId
      ? await this.products.findPlan(dto.planId)
      : dto.planCode
        ? await this.products.findPlanByCode(dto.productId, dto.planCode)
        : null;
    if (!plan) throw AppError.badRequest(ErrorCodes.VALIDATION_FAILED, '必须提供 planId 或 planCode');

    const [batch] = await this.db.insert(redeemBatches).values({
      name: dto.name,
      productId: product.id,
      planId: plan.id,
      quantity: dto.quantity,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      channel: dto.channel ?? null,
      notes: dto.notes ?? null,
      createdBy: actor.id ?? null,
    }).returning();

    // 生成卡密：明文只在本次返回
    const codes: string[] = [];
    const seen = new Set<string>();
    while (codes.length < dto.quantity) {
      const candidate = this.crypto.generateCode(CODE_LENGTH);
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      codes.push(candidate);
    }

    const rows = codes.map((code) => ({
      batchId: batch.id,
      codeLookup: this.crypto.blindIndex(code, 'redeem'),
      codeEnc: this.crypto.encrypt(code),
      codeMasked: maskLicenseKey(code),
      expiresAt: batch.expiresAt,
    }));

    const chunkSize = 500;
    for (let i = 0; i < rows.length; i += chunkSize) {
      await this.db.insert(redeemCodes).values(rows.slice(i, i + chunkSize));
    }

    return {
      batch: { ...batch, quantity: dto.quantity },
      codes: codes.map((code) => formatLicenseKey(code)),
    };
  }

  async listBatches(query: ListRedeemBatchesDto) {
    const { page, pageSize, offset } = normalizePaging(query.page, query.pageSize);
    const conditions: SQL[] = [];
    if (query.productId) conditions.push(eq(redeemBatches.productId, query.productId));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const items = await this.db.select({
      id: redeemBatches.id,
      name: redeemBatches.name,
      productId: redeemBatches.productId,
      productName: products.name,
      planId: redeemBatches.planId,
      planCode: plans.code,
      quantity: redeemBatches.quantity,
      usedCount: redeemBatches.usedCount,
      channel: redeemBatches.channel,
      notes: redeemBatches.notes,
      expiresAt: redeemBatches.expiresAt,
      createdAt: redeemBatches.createdAt,
    }).from(redeemBatches)
      .innerJoin(products, eq(products.id, redeemBatches.productId))
      .innerJoin(plans, eq(plans.id, redeemBatches.planId))
      .where(where)
      .orderBy(desc(redeemBatches.createdAt))
      .limit(pageSize).offset(offset);

    const [totalRow] = await this.db.select({ value: count() }).from(redeemBatches).where(where);
    return { items, total: Number(totalRow?.value ?? 0), page, pageSize };
  }

  async listCodes(query: ListRedeemCodesDto) {
    const { page, pageSize, offset } = normalizePaging(query.page, query.pageSize);
    const conditions: SQL[] = [];
    if (query.batchId) conditions.push(eq(redeemCodes.batchId, query.batchId));
    if (query.status) conditions.push(eq(redeemCodes.status, query.status));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const items = await this.db.select({
      id: redeemCodes.id,
      batchId: redeemCodes.batchId,
      codeMasked: redeemCodes.codeMasked,
      status: redeemCodes.status,
      usedAt: redeemCodes.usedAt,
      usedByCustomerId: redeemCodes.usedByCustomerId,
      licenseId: redeemCodes.licenseId,
      expiresAt: redeemCodes.expiresAt,
      createdAt: redeemCodes.createdAt,
    }).from(redeemCodes).where(where)
      .orderBy(desc(redeemCodes.createdAt))
      .limit(pageSize).offset(offset);

    const [totalRow] = await this.db.select({ value: count() }).from(redeemCodes).where(where);
    return { items, total: Number(totalRow?.value ?? 0), page, pageSize };
  }

  /** 导出卡密：默认含明文（运营要拿去买），写审计。 */
  async exportCodes(batchId: string, reveal: boolean) {
    const rows = await this.db.select().from(redeemCodes)
      .where(eq(redeemCodes.batchId, batchId))
      .orderBy(redeemCodes.createdAt);
    if (rows.length === 0) throw AppError.notFound('批次不存在或没有卡密');

    const data = rows.map((row) => ({
      code: reveal ? formatLicenseKey(this.crypto.decrypt(row.codeEnc)) : row.codeMasked,
      status: row.status,
      used_at: row.usedAt ? row.usedAt.toISOString() : '',
      expires_at: row.expiresAt ? row.expiresAt.toISOString() : '',
    }));
    return toCsv(data, ['code', 'status', 'used_at', 'expires_at']);
  }

  async voidCode(id: string, actor: { id?: string }) {
    const [row] = await this.db.select().from(redeemCodes).where(eq(redeemCodes.id, id)).limit(1);
    if (!row) throw AppError.notFound('卡密不存在');
    if (row.status === 'used') throw AppError.conflict('已使用的卡密不能作废');
    await this.db.update(redeemCodes).set({ status: 'void' }).where(eq(redeemCodes.id, id));
    void actor;
    return { ok: true };
  }

  async voidBatch(batchId: string) {
    const rows = await this.db.update(redeemCodes)
      .set({ status: 'void' })
      .where(and(eq(redeemCodes.batchId, batchId), eq(redeemCodes.status, 'unused')))
      .returning({ id: redeemCodes.id });
    return { ok: true, voided: rows.length };
  }

  /* ------------------------------------------------ 兑换（用户侧） */

  /**
   * 兑换卡密 → 生成正式授权并绑定客户。
   * 并发安全：用条件更新（status='unused'）抢占卡密，抢不到即视为已被使用。
   */
  async redeem(rawCode: string, customer: { id?: string; email: string } | null) {
    const normalized = normalizeLicenseKey(rawCode);
    const lookup = this.crypto.blindIndex(normalized, 'redeem');
    const [code] = await this.db.select().from(redeemCodes).where(eq(redeemCodes.codeLookup, lookup)).limit(1);
    if (!code) throw new AppError(ErrorCodes.REDEEM_CODE_INVALID, '卡密不存在，请检查是否输入正确', 404);
    if (code.status === 'used') {
      throw new AppError(ErrorCodes.REDEEM_CODE_USED, '该卡密已被使用', 409, {
        usedAt: code.usedAt?.toISOString() ?? null,
      });
    }
    if (code.status === 'void') throw new AppError(ErrorCodes.REDEEM_CODE_INVALID, '该卡密已作废', 410);
    if (code.expiresAt && code.expiresAt.getTime() < Date.now()) {
      throw new AppError(ErrorCodes.REDEEM_CODE_EXPIRED, '该卡密已过期', 410, {
        expiresAt: code.expiresAt.toISOString(),
      });
    }

    const [batch] = await this.db.select().from(redeemBatches).where(eq(redeemBatches.id, code.batchId)).limit(1);
    if (!batch) throw AppError.conflict('卡密批次已不存在');

    // 抢占：只有把 unused 改成 used 成功的那次请求才继续发码
    const claimed = await this.db.update(redeemCodes)
      .set({ status: 'used', usedAt: new Date(), usedByCustomerId: customer?.id ?? null })
      .where(and(eq(redeemCodes.id, code.id), eq(redeemCodes.status, 'unused')))
      .returning({ id: redeemCodes.id });
    if (claimed.length === 0) {
      throw new AppError(ErrorCodes.REDEEM_CODE_USED, '该卡密已被使用', 409);
    }

    try {
      const created = await this.licenses.create({
        productId: batch.productId,
        planId: batch.planId,
        customerEmail: customer?.email,
        source: 'redeem',
        notes: '卡密兑换 · 批次 ' + batch.name,
      }, { email: customer?.email ?? 'system' });

      await this.db.update(redeemCodes)
        .set({ licenseId: created.license.id })
        .where(eq(redeemCodes.id, code.id));
      await this.db.update(redeemBatches)
        .set({ usedCount: sql`${redeemBatches.usedCount} + 1` })
        .where(eq(redeemBatches.id, batch.id));

      const [product] = await this.db.select().from(products).where(eq(products.id, batch.productId)).limit(1);
      if (customer?.email) {
        await this.mail.send({
          to: customer.email,
          template: 'redeem_success',
          vars: {
            name: customer.email,
            code: formatLicenseKey(normalized),
            product: product?.name ?? batch.productId,
            plan: batch.planId,
            licenseKey: created.keyFormatted,
            expiresAt: created.license.expiresAt ? created.license.expiresAt.toISOString().slice(0, 10) : '永久',
          },
          relatedType: 'license',
          relatedId: created.license.id,
        });
      }

      return { license: created.license, licenseKey: created.keyFormatted, batchName: batch.name };
    } catch (error) {
      // 发码失败必须把卡密退回可用，避免用户钱货两空
      await this.db.update(redeemCodes)
        .set({ status: 'unused', usedAt: null, usedByCustomerId: null })
        .where(eq(redeemCodes.id, code.id));
      throw error;
    }
  }

  /** 定时任务/手动：清理已过期未使用的卡密状态（仅打标，不删除）。 */
  async expireOverdueCodes(): Promise<number> {
    const rows = await this.db.update(redeemCodes)
      .set({ status: 'void' })
      .where(and(
        eq(redeemCodes.status, 'unused'),
        isNull(redeemCodes.usedAt),
        sql`${redeemCodes.expiresAt} is not null and ${redeemCodes.expiresAt} < now()`,
      ))
      .returning({ id: redeemCodes.id });
    return rows.length;
  }

  /** 供统计使用：未使用卡密数量。 */
  async unusedCount(): Promise<number> {
    const [row] = await this.db.select({ value: count() }).from(redeemCodes)
      .where(eq(redeemCodes.status, 'unused'));
    return Number(row?.value ?? 0);
  }
}