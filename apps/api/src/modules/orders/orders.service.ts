import { createHmac } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, count, desc, eq, gte, ilike, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { CONFIG_TOKEN, type AppConfig } from '../../config/configuration';
import { CryptoService } from '../../crypto/crypto.service';
import { DB } from '../../db/db.module';
import type { DatabaseHandle } from '../../db/db.provider';
import {
  coupons, customers, licenses, orderItems, orders, paymentEvents, plans, products,
} from '../../db/schema';
import { AppError, ErrorCodes } from '../../common/errors';
import { normalizePaging } from '../../common/pagination';
import { LicensesService } from '../licenses/licenses.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ProductsService } from '../products/products.service';
import { SettingsService } from '../settings/settings.service';
import type { CreateOrderDto, ListOrdersDto, MarkPaidDto, RefundOrderDto } from './dto';

export interface CallbackResult {
  ok: boolean;
  duplicate?: boolean;
  orderNo?: string;
  licenses?: string[];
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger('Orders');

  constructor(
    @Inject(DB) private readonly handle: DatabaseHandle,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
    private readonly crypto: CryptoService,
    private readonly products: ProductsService,
    private readonly licenses: LicensesService,
    private readonly mail: NotificationsService,
    private readonly settings: SettingsService,
  ) {}

  private get db() {
    return this.handle.db;
  }

  private generateOrderNo(): string {
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    return 'LH' + stamp + this.crypto.generateCode(4);
  }

  /* ------------------------------------------------ 优惠券 */

  private async resolveCoupon(code: string | undefined, subtotalCents: number, planIds: string[]) {
    if (!code) return { discountCents: 0, couponId: null as string | null };
    const [coupon] = await this.db.select().from(coupons)
      .where(eq(coupons.code, code.trim().toUpperCase())).limit(1);
    if (!coupon) throw new AppError(ErrorCodes.COUPON_INVALID, '优惠券不存在', 400);
    if (coupon.status !== 'active') throw new AppError(ErrorCodes.COUPON_INVALID, '优惠券已停用', 400);
    const now = Date.now();
    if (coupon.validFrom && coupon.validFrom.getTime() > now) throw new AppError(ErrorCodes.COUPON_INVALID, '优惠券尚未生效', 400);
    if (coupon.validUntil && coupon.validUntil.getTime() < now) throw new AppError(ErrorCodes.COUPON_INVALID, '优惠券已过期', 400);
    if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) {
      throw new AppError(ErrorCodes.COUPON_INVALID, '优惠券使用次数已用完', 400);
    }
    const allowed = coupon.appliesTo?.planIds;
    if (allowed && allowed.length > 0 && !planIds.some((id) => allowed.includes(id))) {
      throw new AppError(ErrorCodes.COUPON_INVALID, '优惠券不适用于所选产品', 400);
    }
    const discountCents = coupon.type === 'percent'
      ? Math.floor((subtotalCents * coupon.value) / 100)
      : Math.min(subtotalCents, coupon.value);
    return { discountCents, couponId: coupon.id };
  }

  /* ------------------------------------------------ 订单 */

  async create(dto: CreateOrderDto, actor: { id?: string; email?: string }) {
    const email = dto.email.trim().toLowerCase();
    const resolvedItems: {
      productId: string; planId: string; quantity: number; unitPriceCents: number;
    }[] = [];

    for (const item of dto.items) {
      const plan = item.planId
        ? await this.products.findPlan(item.planId)
        : item.planCode
          ? await this.products.findPlanByCode(item.productId, item.planCode)
          : null;
      if (!plan) throw AppError.badRequest(ErrorCodes.VALIDATION_FAILED, '订单项缺少有效的 planId 或 planCode');
      if (plan.productId !== item.productId) {
        throw AppError.badRequest(ErrorCodes.VALIDATION_FAILED, '策略不属于所选产品');
      }
      resolvedItems.push({
        productId: item.productId,
        planId: plan.id,
        quantity: item.quantity ?? 1,
        unitPriceCents: item.unitPriceCents ?? plan.priceCents,
      });
    }

    const subtotalCents = resolvedItems.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
    const { discountCents, couponId } = await this.resolveCoupon(
      dto.couponCode,
      subtotalCents,
      resolvedItems.map((item) => item.planId),
    );

    const customerId = dto.customerId ?? await this.findOrCreateCustomerId(email);

    const [order] = await this.db.insert(orders).values({
      orderNo: this.generateOrderNo(),
      customerId,
      email,
      currency: (await this.settings.get()).defaultCurrency,
      subtotalCents,
      discountCents,
      totalCents: Math.max(0, subtotalCents - discountCents),
      couponId,
      provider: dto.provider ?? 'manual',
      providerRef: dto.providerRef ?? null,
      notes: dto.notes ?? null,
      metadata: actor.id ? { createdBy: actor.id } : {},
    }).returning();

    await this.db.insert(orderItems).values(resolvedItems.map((item) => ({
      orderId: order.id,
      productId: item.productId,
      planId: item.planId,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
    })));

    if (dto.markPaid) {
      const result = await this.markPaid(order.id, { provider: dto.provider ?? 'manual' });
      return { ...result.order, licenses: result.licenses };
    }
    return this.detail(order.id);
  }

  private async findOrCreateCustomerId(email: string): Promise<string | null> {
    const [existing] = await this.db.select({ id: customers.id }).from(customers).where(eq(customers.email, email)).limit(1);
    if (existing) return existing.id;
    return null;
  }

  async list(query: ListOrdersDto) {
    const { page, pageSize, offset } = normalizePaging(query.page, query.pageSize);
    const conditions: SQL[] = [];
    if (query.status) conditions.push(eq(orders.status, query.status));
    if (query.email) conditions.push(eq(orders.email, query.email.toLowerCase()));
    if (query.from) conditions.push(gte(orders.createdAt, new Date(query.from)));
    if (query.to) conditions.push(lte(orders.createdAt, new Date(query.to)));
    if (query.q) {
      const like = '%' + query.q + '%';
      const search = or(sql`${orders.orderNo} ilike ${like}`, sql`${orders.email} ilike ${like}`);
      if (search) conditions.push(search);
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const items = await this.db.select({
      id: orders.id,
      orderNo: orders.orderNo,
      email: orders.email,
      status: orders.status,
      currency: orders.currency,
      subtotalCents: orders.subtotalCents,
      discountCents: orders.discountCents,
      totalCents: orders.totalCents,
      provider: orders.provider,
      providerRef: orders.providerRef,
      paidAt: orders.paidAt,
      refundedAt: orders.refundedAt,
      createdAt: orders.createdAt,
      itemCount: sql<number>`(select coalesce(sum(order_items.quantity), 0)::int from order_items where order_items.order_id = orders.id)`,
      licenseCount: sql<number>`(select count(*)::int from order_items where order_items.order_id = orders.id and order_items.license_id is not null)`,
    }).from(orders).where(where)
      .orderBy(desc(orders.createdAt))
      .limit(pageSize).offset(offset);

    const [totalRow] = await this.db.select({ value: count() }).from(orders).where(where);
    return { items, total: Number(totalRow?.value ?? 0), page, pageSize };
  }

  async findById(id: string) {
    const [row] = await this.db.select().from(orders).where(eq(orders.id, id)).limit(1);
    if (!row) throw AppError.notFound('订单不存在');
    return row;
  }

  async findByOrderNo(orderNo: string) {
    const [row] = await this.db.select().from(orders).where(eq(orders.orderNo, orderNo)).limit(1);
    return row ?? null;
  }

  async detail(id: string) {
    const order = await this.findById(id);
    const items = await this.db.select({
      id: orderItems.id,
      productId: orderItems.productId,
      productName: products.name,
      planId: orderItems.planId,
      planCode: plans.code,
      planName: plans.name,
      quantity: orderItems.quantity,
      unitPriceCents: orderItems.unitPriceCents,
      licenseId: orderItems.licenseId,
      licenseMasked: licenses.keyMasked,
    }).from(orderItems)
      .innerJoin(products, eq(products.id, orderItems.productId))
      .innerJoin(plans, eq(plans.id, orderItems.planId))
      .leftJoin(licenses, eq(licenses.id, orderItems.licenseId))
      .where(eq(orderItems.orderId, id));
    return { ...order, items };
  }

  /* ------------------------------------------------ 状态流转 */

  /**
   * 标记已支付并自动发码。
   * 幂等保证：状态更新用条件更新（status='pending'），并发/重复回调只有一个能改成功。
   */
  async markPaid(orderId: string, dto: MarkPaidDto): Promise<{ order: Awaited<ReturnType<OrdersService['detail']>>; licenses: string[]; alreadyPaid: boolean }> {
    const order = await this.findById(orderId);
    if (order.status === 'refunded') throw new AppError(ErrorCodes.ORDER_STATE_INVALID, '已退款订单不能再次支付', 409);

    const updated = await this.db.update(orders)
      .set({
        status: 'paid',
        paidAt: order.paidAt ?? new Date(),
        provider: dto.provider ?? order.provider,
        providerRef: dto.providerRef ?? order.providerRef,
        updatedAt: new Date(),
      })
      .where(and(eq(orders.id, orderId), eq(orders.status, 'pending')))
      .returning({ id: orders.id });

    const alreadyPaid = updated.length === 0;
    if (!alreadyPaid && order.couponId) {
      await this.db.update(coupons)
        .set({ usedCount: sql`${coupons.usedCount} + 1` })
        .where(eq(coupons.id, order.couponId));
    }

    const issued = await this.issueMissingLicenses(orderId);
    return { order: await this.detail(orderId), licenses: issued, alreadyPaid };
  }

  /** 为订单中尚无授权的条目发码（支持重复调用补齐）。 */
  async issueMissingLicenses(orderId: string): Promise<string[]> {
    const order = await this.findById(orderId);
    const items = await this.db.select().from(orderItems)
      .where(and(eq(orderItems.orderId, orderId), isNull(orderItems.licenseId)));
    if (items.length === 0) return [];

    const issuedKeys: string[] = [];
    const issuedLicenseIds: string[] = [];

    for (const item of items) {
      for (let i = 0; i < item.quantity; i += 1) {
        const created = await this.licenses.create({
          productId: item.productId,
          planId: item.planId,
          customerEmail: order.email,
          source: 'order',
          notes: '订单 ' + order.orderNo,
        }, { email: 'system' });
        issuedKeys.push(created.keyFormatted);
        issuedLicenseIds.push(created.license.id);
      }
      await this.db.update(orderItems)
        .set({ licenseId: issuedLicenseIds[issuedLicenseIds.length - 1] })
        .where(eq(orderItems.id, item.id));
    }

    // 订单发码后把授权归到客户名下
    const [customer] = await this.db.select({ id: customers.id }).from(customers)
      .where(eq(customers.email, order.email)).limit(1);
    if (customer && issuedLicenseIds.length > 0) {
      await this.db.update(licenses)
        .set({ customerId: customer.id })
        .where(inArray(licenses.id, issuedLicenseIds));
    }

    if (issuedKeys.length > 0) {
      await this.mail.send({
        to: order.email,
        template: 'order_paid',
        vars: {
          name: order.email,
          orderNo: order.orderNo,
          total: (order.totalCents / 100).toFixed(2) + ' ' + order.currency,
          licenseCount: issuedKeys.length,
          licenseKeys: issuedKeys.join('\n'),
        },
        relatedType: 'order',
        relatedId: orderId,
      });
      this.logger.log('订单 ' + order.orderNo + ' 已发码 ' + issuedKeys.length + ' 条');
    }
    return issuedKeys;
  }

  async refund(orderId: string, dto: RefundOrderDto, actor: { id?: string; email?: string }) {
    const order = await this.findById(orderId);
    if (order.status !== 'paid') throw new AppError(ErrorCodes.ORDER_STATE_INVALID, '只有已支付订单可以退款', 409);

    await this.db.update(orders)
      .set({ status: 'refunded', refundedAt: new Date(), notes: dto.reason ?? order.notes, updatedAt: new Date() })
      .where(eq(orders.id, orderId));

    let revoked = 0;
    if (dto.revokeLicenses !== false) {
      const items = await this.db.select({ licenseId: orderItems.licenseId }).from(orderItems).where(eq(orderItems.orderId, orderId));
      const ids = items.map((item) => item.licenseId).filter((id): id is string => Boolean(id));
      for (const id of ids) {
        // 走统一的流转逻辑：写 license_events + 保留吊销原因，便于后续追溯
        await this.licenses.transition(id, 'revoke', dto.reason ?? ('订单退款 ' + order.orderNo), actor).then(
          () => { revoked += 1; },
          () => undefined, // 已吊销的跳过
        );
      }
    }
    return { ...(await this.detail(orderId)), revokedLicenses: revoked };
  }

  async cancel(orderId: string) {
    const order = await this.findById(orderId);
    if (order.status !== 'pending') throw new AppError(ErrorCodes.ORDER_STATE_INVALID, '只有待支付订单可以取消', 409);
    await this.db.update(orders)
      .set({ status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() })
      .where(eq(orders.id, orderId));
    return this.detail(orderId);
  }

  /* ------------------------------------------------ 支付回调 */

  /**
   * 第三方支付回调：HMAC 验签 + 事件去重 + 幂等处理。
   * 签名规则：X-LH-Signature: sha256=<hex(hmac_sha256(secret, rawBody))>
   */
  async handleCallback(
    provider: string,
    payload: { eventId: string; orderNo?: string; providerRef?: string; status: 'paid' | 'refunded' | 'cancelled'; amountCents?: number },
    rawBody: string,
    signature: string | undefined,
  ): Promise<CallbackResult> {
    const secret = await this.settings.getSecret('payments.' + provider + '.secret');
    if (!secret) {
      throw new AppError(ErrorCodes.SETTINGS_INVALID, '未配置 ' + provider + ' 的回调签名密钥', 400);
    }
    const computed = createHmac('sha256', secret).update(rawBody).digest('hex');
    if (!signature || computed !== signature.replace(/^sha256=/, '')) {
      throw AppError.unauthorized(ErrorCodes.UNAUTHENTICATED, '回调签名校验失败');
    }

    // 去重：同一 provider + eventId 只处理一次
    try {
      await this.db.insert(paymentEvents).values({
        provider,
        eventId: payload.eventId,
        payload: payload as unknown as Record<string, unknown>,
      });
    } catch {
      return { ok: true, duplicate: true, orderNo: payload.orderNo };
    }

    const order = payload.orderNo ? await this.findByOrderNo(payload.orderNo) : null;
    if (!order) {
      return { ok: false, duplicate: false };
    }

    if (payload.status === 'paid') {
      const result = await this.markPaid(order.id, { provider: provider as 'manual', providerRef: payload.providerRef });
      return { ok: true, orderNo: order.orderNo, licenses: result.licenses };
    }
    if (payload.status === 'refunded') {
      await this.refund(order.id, { reason: '支付渠道退款通知', revokeLicenses: true }, { email: 'system' });
      return { ok: true, orderNo: order.orderNo };
    }
    await this.cancel(order.id).catch(() => undefined);
    return { ok: true, orderNo: order.orderNo };
  }

  async stats() {
    const [row] = await this.db.select({
      total: count(),
      pending: sql<number>`count(*) filter (where ${orders.status} = 'pending')::int`,
      paid: sql<number>`count(*) filter (where ${orders.status} = 'paid')::int`,
      refunded: sql<number>`count(*) filter (where ${orders.status} = 'refunded')::int`,
      revenue: sql<number>`coalesce(sum(${orders.totalCents}) filter (where ${orders.status} = 'paid'), 0)::int`,
      revenue30d: sql<number>`coalesce(sum(${orders.totalCents}) filter (where ${orders.status} = 'paid' and ${orders.paidAt} >= now() - interval '30 days'), 0)::int`,
    }).from(orders);
    return {
      total: Number(row?.total ?? 0),
      pending: row?.pending ?? 0,
      paid: row?.paid ?? 0,
      refunded: row?.refunded ?? 0,
      revenueCents: row?.revenue ?? 0,
      revenue30DaysCents: row?.revenue30d ?? 0,
    };
  }
}
