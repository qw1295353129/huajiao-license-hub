import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import { CONFIG_TOKEN, type AppConfig } from '../../config/configuration';
import { CryptoService } from '../../crypto/crypto.service';
import { DB } from '../../db/db.module';
import type { DatabaseHandle } from '../../db/db.provider';
import { customers, licenses, orders } from '../../db/schema';
import { AppError } from '../../common/errors';
import { normalizePaging } from '../../common/pagination';
import { NotificationsService } from '../notifications/notifications.service';
import type { CreateCustomerDto, ListCustomersDto, ResetCustomerPasswordDto, UpdateCustomerDto } from './dto';

@Injectable()
export class CustomersService {
  constructor(
    @Inject(DB) private readonly handle: DatabaseHandle,
    private readonly crypto: CryptoService,
    private readonly mail: NotificationsService,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
  ) {}

  private get db() {
    return this.handle.db;
  }

  private toPublic(row: typeof customers.$inferSelect) {
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      status: row.status,
      emailVerifiedAt: row.emailVerifiedAt,
      lastLoginAt: row.lastLoginAt,
      notes: row.notes,
      createdAt: row.createdAt,
      hasPassword: Boolean(row.passwordHash),
    };
  }

  async list(query: ListCustomersDto) {
    const { page, pageSize, offset } = normalizePaging(query.page, query.pageSize);
    const conditions: SQL[] = [];
    if (query.status) conditions.push(eq(customers.status, query.status));
    if (query.q) {
      const like = '%' + query.q + '%';
      const search = or(ilike(customers.email, like), ilike(customers.name, like));
      if (search) conditions.push(search);
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await this.db.select({
      id: customers.id,
      email: customers.email,
      name: customers.name,
      status: customers.status,
      emailVerifiedAt: customers.emailVerifiedAt,
      lastLoginAt: customers.lastLoginAt,
      notes: customers.notes,
      createdAt: customers.createdAt,
      licenseCount: sql<number>`(select count(*)::int from licenses where licenses.customer_id = customers.id)`,
      orderCount: sql<number>`(select count(*)::int from orders where orders.customer_id = customers.id)`,
      paidCents: sql<number>`(select coalesce(sum(orders.total_cents), 0)::int from orders where orders.customer_id = customers.id and orders.status = 'paid')`,
    }).from(customers).where(where)
      .orderBy(desc(customers.createdAt))
      .limit(pageSize).offset(offset);

    const [totalRow] = await this.db.select({ value: count() }).from(customers).where(where);
    return { items: rows, total: Number(totalRow?.value ?? 0), page, pageSize };
  }

  async findById(id: string) {
    const [row] = await this.db.select().from(customers).where(eq(customers.id, id)).limit(1);
    if (!row) throw AppError.notFound('客户不存在');
    return row;
  }

  async detail(id: string) {
    const customer = await this.findById(id);
    const [customerLicenses, customerOrders] = await Promise.all([
      this.db.select({
        id: licenses.id,
        keyMasked: licenses.keyMasked,
        status: licenses.status,
        expiresAt: licenses.expiresAt,
        activationCount: licenses.activationCount,
        maxDevices: licenses.maxDevices,
        createdAt: licenses.createdAt,
      }).from(licenses).where(eq(licenses.customerId, id)).orderBy(desc(licenses.createdAt)),
      this.db.select({
        id: orders.id,
        orderNo: orders.orderNo,
        status: orders.status,
        totalCents: orders.totalCents,
        currency: orders.currency,
        createdAt: orders.createdAt,
        paidAt: orders.paidAt,
      }).from(orders).where(eq(orders.customerId, id)).orderBy(desc(orders.createdAt)),
    ]);
    return { ...this.toPublic(customer), licenses: customerLicenses, orders: customerOrders };
  }

  async create(dto: CreateCustomerDto) {
    const email = dto.email.trim().toLowerCase();
    const [existing] = await this.db.select({ id: customers.id }).from(customers).where(eq(customers.email, email)).limit(1);
    if (existing) throw AppError.conflict('该邮箱已存在客户：' + email);
    const [row] = await this.db.insert(customers).values({
      email,
      name: dto.name?.trim() || email.split('@')[0],
      passwordHash: dto.password ? this.crypto.hashPassword(dto.password) : null,
      notes: dto.notes ?? null,
    }).returning();
    return this.toPublic(row);
  }

  async update(id: string, dto: UpdateCustomerDto) {
    await this.findById(id);
    const [row] = await this.db.update(customers)
      .set({ ...dto, updatedAt: new Date() })
      .where(eq(customers.id, id))
      .returning();
    return this.toPublic(row);
  }

  /** 管理员重置密码：可指定新密码，或由系统生成随机密码并通过邮件发送。 */
  async resetPassword(id: string, dto: ResetCustomerPasswordDto) {
    const customer = await this.findById(id);
    const newPassword = dto.newPassword ?? ('Lh-' + this.crypto.randomToken(9));
    await this.db.update(customers)
      .set({ passwordHash: this.crypto.hashPassword(newPassword), updatedAt: new Date() })
      .where(eq(customers.id, id));

    let emailed = false;
    if (dto.sendEmail) {
      const result = await this.mail.send({
        to: customer.email,
        template: 'password_reset',
        vars: {
          name: customer.name || customer.email,
          resetUrl: this.config.appOrigin + '/portal/login',
          expiresIn: '30 分钟',
        },
        relatedType: 'customer',
        relatedId: id,
      });
      emailed = result.ok;
    }
    // 管理员未指定新密码时，把系统生成的随机密码回显一次，便于线下转达
    return { ok: true, password: dto.newPassword ? undefined : newPassword, emailed };
  }

  async block(id: string, blocked: boolean) {
    await this.findById(id);
    const [row] = await this.db.update(customers)
      .set({ status: blocked ? 'blocked' : 'active', updatedAt: new Date() })
      .where(eq(customers.id, id))
      .returning();
    return this.toPublic(row);
  }

  /** 供门户使用：把同邮箱的未归属授权认领到该客户名下。 */
  async claimLicenses(customerId: string, email: string): Promise<number> {
    const rows = await this.db.update(licenses)
      .set({ customerId, updatedAt: new Date() })
      .where(and(
        eq(licenses.customerEmail, email.toLowerCase()),
        isNull(licenses.customerId),
      ))
      .returning({ id: licenses.id });
    return rows.length;
  }

}