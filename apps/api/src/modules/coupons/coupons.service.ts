import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, type SQL } from 'drizzle-orm';
import { DB } from '../../db/db.module';
import type { DatabaseHandle } from '../../db/db.provider';
import { coupons } from '../../db/schema';
import { AppError } from '../../common/errors';
import { normalizePaging } from '../../common/pagination';
import type { CreateCouponDto, ListCouponsDto, UpdateCouponDto } from './dto';

@Injectable()
export class CouponsService {
  constructor(@Inject(DB) private readonly handle: DatabaseHandle) {}

  private get db() {
    return this.handle.db;
  }

  async list(query: ListCouponsDto) {
    const { page, pageSize, offset } = normalizePaging(query.page, query.pageSize);
    const conditions: SQL[] = [];
    if (query.status) conditions.push(eq(coupons.status, query.status));
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const items = await this.db.select().from(coupons).where(where)
      .orderBy(desc(coupons.createdAt)).limit(pageSize).offset(offset);
    const [totalRow] = await this.db.select({ value: count() }).from(coupons).where(where);
    return { items, total: Number(totalRow?.value ?? 0), page, pageSize };
  }

  async create(dto: CreateCouponDto) {
    const code = dto.code.trim().toUpperCase();
    const [existing] = await this.db.select({ id: coupons.id }).from(coupons).where(eq(coupons.code, code)).limit(1);
    if (existing) throw AppError.conflict('优惠券代码已存在：' + code);
    const [row] = await this.db.insert(coupons).values({
      code,
      type: dto.type,
      value: dto.value,
      maxUses: dto.maxUses ?? null,
      validFrom: dto.validFrom ? new Date(dto.validFrom) : null,
      validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
      appliesTo: dto.planIds && dto.planIds.length > 0 ? { planIds: dto.planIds } : {},
      notes: dto.notes ?? null,
    }).returning();
    return row;
  }

  async update(id: string, dto: UpdateCouponDto) {
    const [existing] = await this.db.select().from(coupons).where(eq(coupons.id, id)).limit(1);
    if (!existing) throw AppError.notFound('优惠券不存在');
    const [row] = await this.db.update(coupons).set({
      ...(dto.value !== undefined ? { value: dto.value } : {}),
      ...(dto.maxUses !== undefined ? { maxUses: dto.maxUses } : {}),
      ...(dto.validUntil !== undefined ? { validUntil: new Date(dto.validUntil) } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      updatedAt: new Date(),
    }).where(eq(coupons.id, id)).returning();
    return row;
  }

  async remove(id: string) {
    const rows = await this.db.delete(coupons).where(eq(coupons.id, id)).returning({ id: coupons.id });
    if (rows.length === 0) throw AppError.notFound('优惠券不存在');
    return { ok: true };
  }
}
