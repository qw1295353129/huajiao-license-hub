import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { DB } from '../../db/db.module';
import type { DatabaseHandle } from '../../db/db.provider';
import {
  customers, devices, licenseActivations, licenses, orderItems, orders, plans,
  productReleases, products,
} from '../../db/schema';
import { AppError, ErrorCodes } from '../../common/errors';
import { normalizePaging } from '../../common/pagination';
import { NotificationsService } from '../notifications/notifications.service';
import { RedeemService } from '../redeem/redeem.service';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class PortalService {
  constructor(
    @Inject(DB) private readonly handle: DatabaseHandle,
    private readonly settings: SettingsService,
    private readonly redeemService: RedeemService,
    private readonly mail: NotificationsService,
  ) {}

  private get db() {
    return this.handle.db;
  }

  private async requireCustomer(customerId: string) {
    const [row] = await this.db.select().from(customers).where(eq(customers.id, customerId)).limit(1);
    if (!row) throw AppError.notFound('账号不存在');
    if (row.status !== 'active') throw AppError.forbidden('账号已被封禁');
    return row;
  }

  async me(customerId: string) {
    const customer = await this.requireCustomer(customerId);
    const [licenseCount] = await this.db.select({ value: count() }).from(licenses)
      .where(eq(licenses.customerId, customerId));
    const [orderCount] = await this.db.select({ value: count() }).from(orders)
      .where(eq(orders.customerId, customerId));
    return {
      id: customer.id,
      email: customer.email,
      name: customer.name,
      status: customer.status,
      createdAt: customer.createdAt,
      lastLoginAt: customer.lastLoginAt,
      licenseCount: Number(licenseCount?.value ?? 0),
      orderCount: Number(orderCount?.value ?? 0),
    };
  }

  async updateProfile(customerId: string, dto: { name?: string }) {
    await this.requireCustomer(customerId);
    if (dto.name !== undefined) {
      await this.db.update(customers).set({ name: dto.name, updatedAt: new Date() }).where(eq(customers.id, customerId));
    }
    return this.me(customerId);
  }

  /* ------------------------------------------------ 我的授权 */

  async licenses(customerId: string, query: { page?: number; pageSize?: number }) {
    const customer = await this.requireCustomer(customerId);
    const { page, pageSize, offset } = normalizePaging(query.page, query.pageSize);
    const items = await this.db.select({
      id: licenses.id,
      keyMasked: licenses.keyMasked,
      status: licenses.status,
      productName: products.name,
      productSlug: products.slug,
      planName: plans.name,
      licenseType: plans.licenseType,
      maxDevices: licenses.maxDevices,
      activationCount: licenses.activationCount,
      expiresAt: licenses.expiresAt,
      validFrom: licenses.validFrom,
      featureKeys: licenses.featureKeys,
      remainingUsages: licenses.remainingUsages,
      createdAt: licenses.createdAt,
    }).from(licenses)
      .innerJoin(products, eq(products.id, licenses.productId))
      .innerJoin(plans, eq(plans.id, licenses.planId))
      .where(ownershipCondition(customerId, customer.email))
      .orderBy(desc(licenses.createdAt))
      .limit(pageSize).offset(offset);

    const [totalRow] = await this.db.select({ value: count() }).from(licenses)
      .where(ownershipCondition(customerId, customer.email));
    return { items, total: Number(totalRow?.value ?? 0), page, pageSize };
  }

  /** 门户只允许操作自己的授权：越权访问统一返回 404，不泄露资源是否存在。 */
  private async requireOwnLicense(customerId: string, licenseId: string) {
    const customer = await this.requireCustomer(customerId);
    const [row] = await this.db.select().from(licenses)
      .where(and(eq(licenses.id, licenseId), ownershipCondition(customerId, customer.email)))
      .limit(1);
    if (!row) throw AppError.notFound('授权不存在或不属于当前账号');
    return row;
  }

  async licenseDetail(customerId: string, licenseId: string) {
    const license = await this.requireOwnLicense(customerId, licenseId);
    const [product] = await this.db.select().from(products).where(eq(products.id, license.productId)).limit(1);
    const [plan] = await this.db.select().from(plans).where(eq(plans.id, license.planId)).limit(1);
    const deviceRows = await this.db.select({
      id: licenseActivations.id,
      status: licenseActivations.status,
      activatedAt: licenseActivations.activatedAt,
      lastSeenAt: licenseActivations.lastSeenAt,
      os: licenseActivations.os,
      appVersion: licenseActivations.appVersion,
      ip: licenseActivations.ip,
      deviceName: devices.name,
    }).from(licenseActivations)
      .leftJoin(devices, eq(devices.id, licenseActivations.deviceId))
      .where(eq(licenseActivations.licenseId, licenseId))
      .orderBy(desc(licenseActivations.lastSeenAt));

    return {
      id: license.id,
      keyMasked: license.keyMasked,
      status: license.status,
      productName: product?.name ?? '',
      productSlug: product?.slug ?? '',
      planName: plan?.name ?? '',
      licenseType: plan?.licenseType ?? 'subscription',
      maxDevices: license.maxDevices,
      expiresAt: license.expiresAt,
      validFrom: license.validFrom,
      featureKeys: license.featureKeys,
      activationCount: license.activationCount,
      devices: deviceRows,
    };
  }

  /**
   * 自助解绑：每 30 天限 N 次（默认 3）。
   * 计数窗口用「首次解绑时间 + 30 天」实现，超窗口自动重置。
   */
  async unbindDevice(customerId: string, licenseId: string, activationId: string) {
    const license = await this.requireOwnLicense(customerId, licenseId);
    const customer = await this.requireCustomer(customerId);
    const settings = await this.settings.get();
    const limit = settings.selfUnbindPer30d;

    const windowStart = customer.unbindWindowStart;
    const inWindow = windowStart && Date.now() - windowStart.getTime() < 30 * 86_400_000;
    const used = inWindow ? customer.unbindCount30d : 0;
    if (limit > 0 && used >= limit) {
      throw new AppError(
        ErrorCodes.FORBIDDEN,
        '自助解绑次数已用完（' + limit + ' 次/30 天），请联系客服处理',
        403,
        { limit, used, windowStart: windowStart?.toISOString() ?? null },
      );
    }

    const [activation] = await this.db.select().from(licenseActivations)
      .where(and(
        eq(licenseActivations.id, activationId),
        eq(licenseActivations.licenseId, licenseId),
        eq(licenseActivations.status, 'active'),
      ))
      .limit(1);
    if (!activation) throw AppError.notFound('该设备未处于绑定状态');

    await this.db.update(licenseActivations)
      .set({ status: 'deactivated', deactivatedAt: new Date(), unbindReason: 'customer_self_service' })
      .where(eq(licenseActivations.id, activationId));

    const [activeRow] = await this.db.select({ value: count() }).from(licenseActivations)
      .where(and(eq(licenseActivations.licenseId, licenseId), eq(licenseActivations.status, 'active')));
    const activeDevices = Number(activeRow?.value ?? 0);
    await this.db.update(licenses)
      .set({ activationCount: activeDevices, updatedAt: new Date() })
      .where(eq(licenses.id, licenseId));

    await this.db.update(customers)
      .set({
        unbindCount30d: inWindow ? used + 1 : 1,
        unbindWindowStart: inWindow ? windowStart : new Date(),
      })
      .where(eq(customers.id, customerId));

    await this.mail.send({
      to: customer.email,
      template: 'device_unbound',
      vars: {
        name: customer.name || customer.email,
        licenseKey: license.keyMasked,
        deviceName: activation.os ?? '未知设备',
        activeDevices,
        maxDevices: license.maxDevices || '不限',
      },
      relatedType: 'license',
      relatedId: licenseId,
    }).catch(() => undefined);

    return {
      ok: true,
      activeDevices,
      maxDevices: license.maxDevices,
      remainingUnbinds: limit > 0 ? Math.max(0, limit - (inWindow ? used + 1 : 1)) : null,
    };
  }

  /* ------------------------------------------------ 我的订单 */

  async orders(customerId: string, query: { page?: number; pageSize?: number }) {
    const customer = await this.requireCustomer(customerId);
    const { page, pageSize, offset } = normalizePaging(query.page, query.pageSize);
    // 兼容历史数据：早期订单可能只记录了邮箱
    const condition = customer.email
      ? sql`(${orders.customerId} = ${customerId} or lower(${orders.email}) = ${customer.email.toLowerCase()})`
      : eq(orders.customerId, customerId);

    const items = await this.db.select({
      id: orders.id,
      orderNo: orders.orderNo,
      status: orders.status,
      currency: orders.currency,
      totalCents: orders.totalCents,
      discountCents: orders.discountCents,
      paidAt: orders.paidAt,
      createdAt: orders.createdAt,
      itemCount: sql<number>`(select coalesce(sum(order_items.quantity), 0)::int from order_items where order_items.order_id = orders.id)`,
    }).from(orders).where(condition)
      .orderBy(desc(orders.createdAt))
      .limit(pageSize).offset(offset);

    const [totalRow] = await this.db.select({ value: count() }).from(orders).where(condition);
    return { items, total: Number(totalRow?.value ?? 0), page, pageSize };
  }

  async orderDetail(customerId: string, orderId: string) {
    const customer = await this.requireCustomer(customerId);
    const [order] = await this.db.select().from(orders)
      .where(and(
        eq(orders.id, orderId),
        customer.email
          ? sql`(${orders.customerId} = ${customerId} or lower(${orders.email}) = ${customer.email.toLowerCase()})`
          : eq(orders.customerId, customerId),
      ))
      .limit(1);
    if (!order) throw AppError.notFound('订单不存在或不属于当前账号');

    const items = await this.db.select({
      id: orderItems.id,
      productName: products.name,
      planName: plans.name,
      quantity: orderItems.quantity,
      unitPriceCents: orderItems.unitPriceCents,
      licenseMasked: licenses.keyMasked,
    }).from(orderItems)
      .innerJoin(products, eq(products.id, orderItems.productId))
      .innerJoin(plans, eq(plans.id, orderItems.planId))
      .leftJoin(licenses, eq(licenses.id, orderItems.licenseId))
      .where(eq(orderItems.orderId, orderId));
    return { ...order, items };
  }

  /* ------------------------------------------------ 卡密兑换与下载 */

  async redeem(customerId: string, code: string) {
    const customer = await this.requireCustomer(customerId);
    const result = await this.redeemService.redeem(code, { id: customer.id, email: customer.email });
    return result;
  }

  async downloads(customerId: string) {
    await this.requireCustomer(customerId);
    const owned = await this.db.selectDistinct({ productId: licenses.productId }).from(licenses)
      .where(and(eq(licenses.customerId, customerId), inArray(licenses.status, ['issued', 'active', 'expired'])));
    const ids = owned.map((row) => row.productId);
    if (ids.length === 0) return { items: [] };

    const rows = await this.db.select({
      id: productReleases.id,
      productName: products.name,
      version: productReleases.version,
      channel: productReleases.channel,
      notes: productReleases.notes,
      downloadUrl: productReleases.downloadUrl,
      publishedAt: productReleases.publishedAt,
    }).from(productReleases)
      .innerJoin(products, eq(products.id, productReleases.productId))
      .where(inArray(productReleases.productId, ids))
      .orderBy(desc(productReleases.publishedAt));
    return { items: rows };
  }
}

/**
 * 授权归属判定：优先看 customer_id，同时兼容「只有邮箱」的历史/导入数据。
 * 邮箱比对统一小写，避免大小写差异导致用户看不到自己的授权。
 */
function ownershipCondition(customerId: string, email: string) {
  return sql`(${licenses.customerId} = ${customerId} or lower(${licenses.customerEmail}) = ${email.toLowerCase()})`;
}