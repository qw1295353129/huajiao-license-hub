import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { SessionUser } from '@license-hub/shared';
import { CONFIG_TOKEN, type AppConfig } from '../../config/configuration';
import { CryptoService } from '../../crypto/crypto.service';
import { DB } from '../../db/db.module';
import type { DatabaseHandle } from '../../db/db.provider';
import { authTokens, customers } from '../../db/schema';
import { AppError, ErrorCodes } from '../../common/errors';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { CustomersService } from '../customers/customers.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { TokenService } from '../auth/token.service';
import type { PortalLoginDto, PortalRegisterDto } from './dto';

interface PortalSession {
  user: SessionUser;
  tokens: { accessToken: string; refreshToken: string; expiresIn: number };
}

@Injectable()
export class PortalAuthService {
  private readonly logger = new Logger('PortalAuth');

  constructor(
    @Inject(DB) private readonly handle: DatabaseHandle,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
    private readonly crypto: CryptoService,
    private readonly tokens: TokenService,
    private readonly customers: CustomersService,
    private readonly settings: SettingsService,
    private readonly mail: NotificationsService,
    private readonly audit: AuditService,
    private readonly webhooks: WebhooksService,
  ) {}

  private get db() {
    return this.handle.db;
  }

  private toSessionUser(row: typeof customers.$inferSelect): SessionUser {
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      role: 'readonly',
      totpEnabled: false,
    };
  }

  async register(dto: PortalRegisterDto, meta: { ip?: string; userAgent?: string }): Promise<PortalSession> {
    const settings = await this.settings.get();
    if (!settings.allowRegistration) {
      throw AppError.forbidden('本站已关闭自助注册，请联系管理员开通账号');
    }
    const email = dto.email.trim().toLowerCase();
    const [existing] = await this.db.select().from(customers).where(eq(customers.email, email)).limit(1);
    if (existing) throw AppError.conflict('该邮箱已注册，请直接登录');

    const [row] = await this.db.insert(customers).values({
      email,
      name: dto.name?.trim() || email.split('@')[0],
      passwordHash: this.crypto.hashPassword(dto.password),
    }).returning();

    // 把历史订单/授权按邮箱认领到新账号
    const claimed = await this.customers.claimLicenses(row.id, email);

    await this.mail.send({
      to: email,
      template: 'welcome',
      vars: { name: row.name || email, email },
      relatedType: 'customer',
      relatedId: row.id,
    }).catch(() => undefined);

    await this.audit.record({
      actorType: 'customer',
      actorId: row.id,
      actorEmail: email,
      action: 'customer.register',
      targetType: 'customer',
      targetId: row.id,
      ip: meta.ip ?? null,
      diff: { after: { email, claimedLicenses: claimed } },
    });

    await this.webhooks.emit('customer.created', {
      customerId: row.id,
      email: row.email,
      name: row.name,
      claimedLicenses: claimed,
    }).catch(() => undefined);

    const tokens = await this.tokens.issueForUser(
      { id: row.id, email: row.email, name: row.name, audience: 'customer' },
      meta,
    );
    return { user: this.toSessionUser(row), tokens };
  }

  async login(dto: PortalLoginDto, meta: { ip?: string; userAgent?: string }): Promise<PortalSession> {
    const email = dto.email.trim().toLowerCase();
    const [row] = await this.db.select().from(customers).where(eq(customers.email, email)).limit(1);
    if (!row || !row.passwordHash || !this.crypto.verifyPassword(dto.password, row.passwordHash)) {
      // 统一提示，避免账号枚举
      throw AppError.unauthorized(ErrorCodes.INVALID_CREDENTIALS, '邮箱或密码不正确');
    }
    if (row.status !== 'active') {
      throw AppError.forbidden('账号已被封禁，请联系客服');
    }
    await this.db.update(customers)
      .set({ lastLoginAt: new Date() })
      .where(eq(customers.id, row.id));
    await this.customers.claimLicenses(row.id, email);

    const tokens = await this.tokens.issueForUser(
      { id: row.id, email: row.email, name: row.name, audience: 'customer' },
      meta,
    );
    return { user: this.toSessionUser(row), tokens };
  }

  async refresh(refreshToken: string, meta: { ip?: string; userAgent?: string }): Promise<PortalSession> {
    const { session, tokens } = await this.tokens.rotate(refreshToken, meta);
    if (session.subjectType !== 'customer') {
      throw AppError.forbidden('该刷新令牌不属于用户门户');
    }
    const [row] = await this.db.select().from(customers).where(eq(customers.id, session.subjectId)).limit(1);
    if (!row || row.status !== 'active') {
      throw AppError.unauthorized(ErrorCodes.ACCOUNT_DISABLED, '账号不存在或已被封禁');
    }
    const accessToken = await this.tokens.signAccessFor(
      { id: row.id, email: row.email, name: row.name, audience: 'customer' },
      tokens.sessionId,
    );
    return { user: this.toSessionUser(row), tokens: { ...tokens, accessToken } };
  }

  async logout(refreshToken: string): Promise<{ ok: true }> {
    await this.tokens.revokeByRefreshToken(refreshToken);
    return { ok: true };
  }

  /** 已登录状态下修改密码：校验旧密码，成功后注销其它会话。 */
  async changePassword(customerId: string, currentPassword: string, newPassword: string, keepSessionId?: string) {
    const [row] = await this.db.select().from(customers).where(eq(customers.id, customerId)).limit(1);
    if (!row) throw AppError.notFound('账号不存在');
    if (!row.passwordHash || !this.crypto.verifyPassword(currentPassword, row.passwordHash)) {
      throw AppError.unauthorized(ErrorCodes.INVALID_CREDENTIALS, '当前密码不正确');
    }
    if (this.crypto.verifyPassword(newPassword, row.passwordHash)) {
      throw AppError.badRequest(ErrorCodes.VALIDATION_FAILED, '新密码不能与当前密码相同');
    }
    await this.db.update(customers)
      .set({ passwordHash: this.crypto.hashPassword(newPassword), updatedAt: new Date() })
      .where(eq(customers.id, customerId));
    const revoked = await this.tokens.revokeAll('customer', customerId, keepSessionId);
    await this.audit.record({
      actorType: 'customer',
      actorId: customerId,
      actorEmail: row.email,
      action: 'customer.password_changed',
      targetType: 'customer',
      targetId: customerId,
    });
    return { ok: true, revokedSessions: revoked };
  }

  /** 注销该客户的全部会话（改密后或用户主动操作）。 */
  async logoutAll(customerId: string, exceptSessionId?: string): Promise<{ ok: true; revoked: number }> {
    const revoked = await this.tokens.revokeAll('customer', customerId, exceptSessionId);
    return { ok: true, revoked };
  }

  /** 发起找回密码：生成一次性令牌并邮件发送。 */
  async forgotPassword(email: string): Promise<{ ok: true; devToken?: string }> {
    const normalized = email.trim().toLowerCase();
    const [row] = await this.db.select().from(customers).where(eq(customers.email, normalized)).limit(1);
    // 无论账号是否存在都返回成功，避免账号枚举
    if (!row) return { ok: true };

    const rawToken = this.crypto.randomToken(32);
    const expiresAt = new Date(Date.now() + 30 * 60_000);
    await this.db.insert(authTokens).values({
      subjectType: 'customer',
      subjectId: row.id,
      purpose: 'password_reset',
      tokenHash: this.crypto.blindIndex(rawToken, 'auth-token'),
      expiresAt,
    });

    const resetUrl = this.config.appOrigin.replace(/\/$/, '') + '/portal/reset-password?token=' + rawToken;
    await this.mail.send({
      to: normalized,
      template: 'password_reset',
      vars: { name: row.name || normalized, resetUrl, expiresIn: '30 分钟' },
      relatedType: 'customer',
      relatedId: row.id,
    }).catch(() => undefined);
    this.logger.log('已为 ' + normalized + ' 生成重置链接');

    // 本地开发且未配置 SMTP 时，把令牌直接回显，避免"收不到邮件就卡死"
    const devToken = !this.config.isProd && !this.mail.enabled ? rawToken : undefined;
    return devToken ? { ok: true, devToken } : { ok: true };
  }

  async resetPassword(token: string, newPassword: string): Promise<{ ok: true; revokedSessions: number }> {
    const hash = this.crypto.blindIndex(token, 'auth-token');
    const [record] = await this.db.select().from(authTokens)
      .where(and(
        eq(authTokens.tokenHash, hash),
        eq(authTokens.purpose, 'password_reset'),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, new Date()),
      ))
      .limit(1);
    if (!record) throw AppError.badRequest(ErrorCodes.VALIDATION_FAILED, '重置链接无效或已过期，请重新发起');

    await this.db.update(customers)
      .set({ passwordHash: this.crypto.hashPassword(newPassword), updatedAt: new Date() })
      .where(eq(customers.id, record.subjectId));
    await this.db.update(authTokens).set({ usedAt: new Date() }).where(eq(authTokens.id, record.id));
    const revoked = await this.tokens.revokeAll('customer', record.subjectId);

    await this.audit.record({
      actorType: 'customer',
      actorId: record.subjectId,
      action: 'customer.password_reset',
      targetType: 'customer',
      targetId: record.subjectId,
    });
    return { ok: true, revokedSessions: revoked };
  }
}