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

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

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

  async register(
    dto: PortalRegisterDto,
    meta: { ip?: string; userAgent?: string },
  ): Promise<PortalSession & { devToken?: string }> {
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

    // 邮箱验证前不认领历史订单/授权：否则任意人可用受害者邮箱注册后抢占归属（C2）
    const claimed = 0;

    await this.mail.send({
      to: email,
      template: 'welcome',
      vars: { name: row.name || email, email },
      relatedType: 'customer',
      relatedId: row.id,
    }).catch(() => undefined);

    // 发送邮箱验证链接（验证成功后才会 claimLicenses）
    const rawVerifyToken = this.crypto.randomToken(32);
    await this.db.insert(authTokens).values({
      subjectType: 'customer',
      subjectId: row.id,
      purpose: 'email_verify',
      tokenHash: this.crypto.blindIndex(rawVerifyToken, 'auth-token'),
      expiresAt: new Date(Date.now() + 24 * 3_600_000),
    });
    const verifyUrl = this.config.appOrigin.replace(/\/$/, '') + '/portal/verify-email?token=' + rawVerifyToken;
    await this.mail.send({
      to: email,
      template: 'email_verify',
      vars: { name: row.name || email, verifyUrl, expiresIn: '24 小时' },
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
    // 本地开发且未配置 SMTP 时回显验证令牌，便于自测（与 forgot-password 一致）
    const devToken = !this.config.isProd && !this.mail.enabled ? rawVerifyToken : undefined;
    return { user: this.toSessionUser(row), tokens, ...(devToken ? { devToken } : {}) };
  }

  async login(dto: PortalLoginDto, meta: { ip?: string; userAgent?: string }): Promise<PortalSession> {
    const email = dto.email.trim().toLowerCase();
    const [row] = await this.db.select().from(customers).where(eq(customers.email, email)).limit(1);
    if (!row) {
      throw AppError.unauthorized(ErrorCodes.INVALID_CREDENTIALS, '邮箱或密码不正确');
    }
    if (row.lockedUntil && row.lockedUntil.getTime() > Date.now()) {
      const minutes = Math.ceil((row.lockedUntil.getTime() - Date.now()) / 60000);
      throw new AppError(
        ErrorCodes.ACCOUNT_LOCKED,
        '尝试次数过多，请 ' + minutes + ' 分钟后再试',
        423,
        { lockedUntil: row.lockedUntil.toISOString() },
      );
    }
    if (!row.passwordHash || !this.crypto.verifyPassword(dto.password, row.passwordHash)) {
      await this.registerFailure(row);
      throw AppError.unauthorized(ErrorCodes.INVALID_CREDENTIALS, '邮箱或密码不正确');
    }
    if (row.status !== 'active') {
      throw AppError.forbidden('账号已被封禁，请联系客服');
    }
    await this.db.update(customers)
      .set({ lastLoginAt: new Date(), failedAttempts: 0, lockedUntil: null })
      .where(eq(customers.id, row.id));
    // 仅已验证邮箱才认领：未验证时邮箱本身不可信（C2）
    if (row.emailVerifiedAt) {
      await this.customers.claimLicenses(row.id, email);
    }

    const tokens = await this.tokens.issueForUser(
      { id: row.id, email: row.email, name: row.name, audience: 'customer' },
      meta,
    );
    return { user: this.toSessionUser(row), tokens };
  }

  /** 门户登录失败锁定（N4）：连续失败 5 次锁 15 分钟，与管理端策略一致。 */
  private async registerFailure(row: typeof customers.$inferSelect): Promise<void> {
    const attempts = row.failedAttempts + 1;
    const shouldLock = attempts >= MAX_FAILED_ATTEMPTS;
    await this.db.update(customers)
      .set({
        failedAttempts: attempts,
        lockedUntil: shouldLock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : row.lockedUntil,
        updatedAt: new Date(),
      })
      .where(eq(customers.id, row.id));
  }

  /** 重发验证邮件：已验证则幂等成功；未验证则作废旧令牌并重发（C2 恢复路径）。 */
  async resendVerify(email: string): Promise<{ ok: true; devToken?: string }> {
    const normalized = email.trim().toLowerCase();
    const [row] = await this.db.select().from(customers).where(eq(customers.email, normalized)).limit(1);
    if (!row || row.emailVerifiedAt) return { ok: true };

    await this.db.update(authTokens)
      .set({ usedAt: new Date() })
      .where(and(
        eq(authTokens.subjectType, 'customer'),
        eq(authTokens.subjectId, row.id),
        eq(authTokens.purpose, 'email_verify'),
        isNull(authTokens.usedAt),
      ));

    const rawVerifyToken = this.crypto.randomToken(32);
    await this.db.insert(authTokens).values({
      subjectType: 'customer',
      subjectId: row.id,
      purpose: 'email_verify',
      tokenHash: this.crypto.blindIndex(rawVerifyToken, 'auth-token'),
      expiresAt: new Date(Date.now() + 24 * 3_600_000),
    });
    const verifyUrl = this.config.appOrigin.replace(/\/$/, '') + '/portal/verify-email?token=' + rawVerifyToken;
    await this.mail.send({
      to: normalized,
      template: 'email_verify',
      vars: { name: row.name || normalized, verifyUrl, expiresIn: '24 小时' },
      relatedType: 'customer',
      relatedId: row.id,
    }).catch(() => undefined);

    const devToken = !this.config.isProd && !this.mail.enabled ? rawVerifyToken : undefined;
    return devToken ? { ok: true, devToken } : { ok: true };
  }

  async refresh(refreshToken: string, meta: { ip?: string; userAgent?: string }): Promise<PortalSession> {
    // 轮换前校验 subjectType，避免管理端 refresh token 被拿到门户消费（N3）
    const { session, tokens } = await this.tokens.rotate(refreshToken, meta, 'customer');
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

  /** 邮箱验证：标记 emailVerifiedAt 后认领历史授权（C2）。 */
  async verifyEmail(token: string): Promise<{ ok: true; claimedLicenses: number }> {
    const hash = this.crypto.blindIndex(token, 'auth-token');
    const [record] = await this.db.select().from(authTokens)
      .where(and(
        eq(authTokens.tokenHash, hash),
        eq(authTokens.purpose, 'email_verify'),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, new Date()),
      ))
      .limit(1);
    if (!record) throw AppError.badRequest(ErrorCodes.VALIDATION_FAILED, '验证链接无效或已过期，请重新发起');

    const [customer] = await this.db.select().from(customers).where(eq(customers.id, record.subjectId)).limit(1);
    if (!customer) throw AppError.badRequest(ErrorCodes.VALIDATION_FAILED, '验证链接无效或已过期，请重新发起');

    await this.db.update(authTokens).set({ usedAt: new Date() }).where(eq(authTokens.id, record.id));
    if (!customer.emailVerifiedAt) {
      await this.db.update(customers)
        .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
        .where(eq(customers.id, customer.id));
    }
    const claimed = await this.customers.claimLicenses(customer.id, customer.email);

    await this.audit.record({
      actorType: 'customer',
      actorId: customer.id,
      actorEmail: customer.email,
      action: 'customer.email_verified',
      targetType: 'customer',
      targetId: customer.id,
      diff: { after: { claimedLicenses: claimed } },
    });
    return { ok: true, claimedLicenses: claimed };
  }

  /** 发起找回密码：生成一次性令牌并邮件发送。 */
  async forgotPassword(email: string): Promise<{ ok: true; devToken?: string }> {
    const normalized = email.trim().toLowerCase();
    const [row] = await this.db.select().from(customers).where(eq(customers.email, normalized)).limit(1);
    // 无论账号是否存在都返回成功，避免账号枚举
    if (!row) return { ok: true };

    // 作废该账号此前未使用的重置令牌，保证「以最新一次为准」（N7）
    await this.db.update(authTokens)
      .set({ usedAt: new Date() })
      .where(and(
        eq(authTokens.subjectType, 'customer'),
        eq(authTokens.subjectId, row.id),
        eq(authTokens.purpose, 'password_reset'),
        isNull(authTokens.usedAt),
      ));

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
    await this.db.update(authTokens)
      .set({ usedAt: new Date() })
      .where(and(
        eq(authTokens.subjectType, 'customer'),
        eq(authTokens.subjectId, record.subjectId),
        eq(authTokens.purpose, 'password_reset'),
        isNull(authTokens.usedAt),
      ));
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