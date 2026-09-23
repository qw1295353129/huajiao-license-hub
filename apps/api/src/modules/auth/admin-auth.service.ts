import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { AdminRole, SessionUser } from '@license-hub/shared';
import { CONFIG_TOKEN, type AppConfig } from '../../config/configuration';
import { CryptoService } from '../../crypto/crypto.service';
import { generateTotpSecret, matchTotp, otpauthUri } from '../../crypto/totp';
import { DB } from '../../db/db.module';
import type { DatabaseHandle } from '../../db/db.provider';
import { admins } from '../../db/schema';
import { AppError, ErrorCodes } from '../../common/errors';
import { AuditService } from '../audit/audit.service';
import { TokenService, type IssuedTokens, type SessionView } from './token.service';
import type { ChangePasswordDto } from './dto';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

type AdminRow = typeof admins.$inferSelect;

export interface LoginResult {
  requires2fa?: false;
  user: SessionUser;
  tokens: IssuedTokens;
}

@Injectable()
export class AdminAuthService implements OnApplicationBootstrap {
  private readonly logger = new Logger('AdminAuth');

  constructor(
    @Inject(DB) private readonly handle: DatabaseHandle,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
    private readonly crypto: CryptoService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.handle.db;
  }

  /** 首次启动：无任何管理员时，用环境变量创建 owner，避免系统装好却进不去。 */
  async onApplicationBootstrap(): Promise<void> {
    try {
      const rows = await this.db.select({ id: admins.id }).from(admins).limit(1);
      if (rows.length > 0) return;
      const { email, password } = this.config.bootstrap;
      await this.createAdmin({ email, password, name: '系统管理员', role: 'owner', actorLabel: 'bootstrap' });
      this.logger.warn('已创建初始管理员：' + email + '（请立即登录并修改密码、开启双因素）');
    } catch (error) {
      this.logger.error('初始化管理员失败：' + (error instanceof Error ? error.message : String(error)));
    }
  }

  async createAdmin(input: {
    email: string; password: string; name?: string; role: AdminRole; actorLabel?: string; actorId?: string;
  }): Promise<AdminRow> {
    const email = input.email.trim().toLowerCase();
    const existing = await this.db.select({ id: admins.id }).from(admins).where(eq(admins.email, email)).limit(1);
    if (existing.length > 0) {
      throw AppError.conflict('该邮箱已存在管理员账号：' + email);
    }
    const [row] = await this.db.insert(admins).values({
      email,
      name: input.name?.trim() || email.split('@')[0],
      passwordHash: this.crypto.hashPassword(input.password),
      role: input.role,
    }).returning();
    await this.audit.record({
      actorType: input.actorId ? 'admin' : 'system',
      actorId: input.actorId ?? null,
      actorEmail: input.actorLabel ?? 'system',
      action: 'admin.create',
      targetType: 'admin',
      targetId: row.id,
      diff: { after: { email: row.email, role: row.role } },
    });
    return row;
  }

  /* ------------------------------------------------ 团队与角色（仅 owner） */

  async listAdmins() {
    const rows = await this.db.select({
      id: admins.id,
      email: admins.email,
      name: admins.name,
      role: admins.role,
      status: admins.status,
      totpEnabled: admins.totpEnabled,
      lastLoginAt: admins.lastLoginAt,
      lastLoginIp: admins.lastLoginIp,
      createdAt: admins.createdAt,
    }).from(admins).orderBy(admins.createdAt);
    return rows;
  }

  async updateAdmin(id: string, patch: { name?: string; role?: AdminRole; status?: 'active' | 'disabled' }, actorId: string) {
    const [target] = await this.db.select().from(admins).where(eq(admins.id, id)).limit(1);
    if (!target) throw AppError.notFound('管理员不存在');

    // 不允许把自己降级或停用，避免把唯一 owner 锁在门外
    if (id === actorId && (patch.role !== undefined && patch.role !== target.role || patch.status === 'disabled')) {
      throw AppError.badRequest(ErrorCodes.VALIDATION_FAILED, '不能修改自己的角色或停用自己的账号');
    }
    if (target.role === 'owner' && patch.role && patch.role !== 'owner') {
      const owners = await this.db.select({ id: admins.id }).from(admins)
        .where(and(eq(admins.role, 'owner'), eq(admins.status, 'active')));
      if (owners.length <= 1) throw AppError.conflict('系统必须保留至少一个 owner');
    }

    const [row] = await this.db.update(admins).set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.role !== undefined ? { role: patch.role } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      updatedAt: new Date(),
    }).where(eq(admins.id, id)).returning();

    // 停用账号或角色变更时立即吊销其全部会话（降权/升权后旧令牌不得继续生效）
    if (patch.status === 'disabled' || (patch.role !== undefined && patch.role !== target.role)) {
      await this.tokens.revokeAll('admin', id);
    }
    await this.audit.record({
      actorType: 'admin',
      actorId,
      action: 'admin.update',
      targetType: 'admin',
      targetId: id,
      diff: { before: { role: target.role, status: target.status, name: target.name }, after: patch },
    });
    return { id: row.id, email: row.email, name: row.name, role: row.role, status: row.status };
  }

  /** 管理员重置他人密码：生成随机密码并强制其重新登录。 */
  async resetAdminPassword(id: string, actorId: string) {
    const [target] = await this.db.select().from(admins).where(eq(admins.id, id)).limit(1);
    if (!target) throw AppError.notFound('管理员不存在');
    const password = 'Lh-' + this.crypto.randomToken(9);
    await this.db.update(admins)
      .set({ passwordHash: this.crypto.hashPassword(password), updatedAt: new Date() })
      .where(eq(admins.id, id));
    await this.tokens.revokeAll('admin', id);
    await this.audit.record({
      actorType: 'admin',
      actorId,
      action: 'admin.reset_password',
      targetType: 'admin',
      targetId: id,
    });
    return { ok: true, password };
  }

  async login(input: { email: string; password: string; totp?: string; ip?: string; userAgent?: string }): Promise<LoginResult> {
    const email = input.email.trim().toLowerCase();
    const [admin] = await this.db.select().from(admins).where(eq(admins.email, email)).limit(1);
    if (!admin) {
      // 统一提示，避免账号枚举
      throw AppError.unauthorized(ErrorCodes.INVALID_CREDENTIALS, '邮箱或密码不正确');
    }

    // 先验密码，再暴露锁定/禁用状态：错误密码不得泄露账号是否被锁或停用（N5）
    if (!this.crypto.verifyPassword(input.password, admin.passwordHash)) {
      await this.registerFailure(admin);
      throw AppError.unauthorized(ErrorCodes.INVALID_CREDENTIALS, '邮箱或密码不正确');
    }

    if (admin.status !== 'active') {
      throw AppError.forbidden('账号已被禁用，请联系站点所有者');
    }
    if (admin.lockedUntil && admin.lockedUntil.getTime() > Date.now()) {
      const minutes = Math.ceil((admin.lockedUntil.getTime() - Date.now()) / 60000);
      throw new AppError(
        ErrorCodes.ACCOUNT_LOCKED,
        '账号已锁定，请 ' + minutes + ' 分钟后再试',
        423,
        { lockedUntil: admin.lockedUntil.toISOString() },
      );
    }

    if (admin.totpEnabled) {
      if (!input.totp) {
        throw new AppError(ErrorCodes.TWO_FACTOR_REQUIRED, '需要输入动态验证码', 401, { requires2fa: true });
      }
      const secret = admin.totpSecretEnc ? this.crypto.decrypt(admin.totpSecretEnc) : null;
      const totpCounter = secret ? matchTotp(secret, input.totp) : null;
      // 防重放：同一 counter 在窗口内不得重复使用（suggestion）
      if (totpCounter === null || (admin.totpLastCounter !== null && totpCounter <= admin.totpLastCounter)) {
        await this.registerFailure(admin);
        throw new AppError(
          ErrorCodes.TWO_FACTOR_INVALID,
          totpCounter === null ? '动态验证码不正确' : '动态验证码已使用，请等待下一时间步',
          401,
          { requires2fa: true },
        );
      }
      await this.db.update(admins)
        .set({ totpLastCounter: totpCounter })
        .where(eq(admins.id, admin.id));
    }

    await this.db.update(admins)
      .set({ failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date(), lastLoginIp: input.ip ?? null })
      .where(eq(admins.id, admin.id));

    const tokens = await this.tokens.issueForUser(
      { id: admin.id, email: admin.email, name: admin.name, audience: 'admin', role: admin.role },
      { ip: input.ip, userAgent: input.userAgent },
    );

    await this.audit.record({
      actorType: 'admin',
      actorId: admin.id,
      actorEmail: admin.email,
      action: 'admin.login',
      targetType: 'admin',
      targetId: admin.id,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    });

    return { user: this.toSessionUser(admin), tokens };
  }

  private async registerFailure(admin: AdminRow): Promise<void> {
    const attempts = admin.failedAttempts + 1;
    const shouldLock = attempts >= MAX_FAILED_ATTEMPTS;
    await this.db.update(admins)
      .set({
        // 锁定后不清零：保留计数使退避持续生效（N5）
        failedAttempts: attempts,
        lockedUntil: shouldLock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : admin.lockedUntil,
      })
      .where(eq(admins.id, admin.id));
    await this.audit.record({
      actorType: 'admin',
      actorId: admin.id,
      actorEmail: admin.email,
      action: shouldLock ? 'admin.lock' : 'admin.login_failed',
      targetType: 'admin',
      targetId: admin.id,
      diff: { after: { attempts, locked: shouldLock } },
    });
  }

  async refresh(refreshToken: string, meta: { ip?: string; userAgent?: string }): Promise<LoginResult> {
    // 轮换前校验 subjectType，避免门户 refresh token 被拿到管理端消费（N3）
    const { session, tokens } = await this.tokens.rotate(refreshToken, meta, 'admin');
    const [admin] = await this.db.select().from(admins).where(eq(admins.id, session.subjectId)).limit(1);
    if (!admin || admin.status !== 'active') {
      throw AppError.unauthorized(ErrorCodes.ACCOUNT_DISABLED, '账号不存在或已被禁用');
    }
    const accessToken = await this.tokens.signAccessFor(
      { id: admin.id, email: admin.email, name: admin.name, audience: 'admin', role: admin.role },
      tokens.sessionId,
    );
    return { user: this.toSessionUser(admin), tokens: { ...tokens, accessToken } };
  }

  async logout(refreshToken: string): Promise<{ ok: true }> {
    await this.tokens.revokeByRefreshToken(refreshToken);
    return { ok: true };
  }

  async me(adminId: string): Promise<SessionUser & { createdAt: string; lastLoginAt: string | null }> {
    const [admin] = await this.db.select().from(admins).where(eq(admins.id, adminId)).limit(1);
    if (!admin) throw AppError.notFound('管理员不存在');
    return {
      ...this.toSessionUser(admin),
      createdAt: admin.createdAt.toISOString(),
      lastLoginAt: admin.lastLoginAt ? admin.lastLoginAt.toISOString() : null,
    };
  }

  async setupTotp(adminId: string): Promise<{ secret: string; otpauthUri: string }> {
    const [admin] = await this.db.select().from(admins).where(eq(admins.id, adminId)).limit(1);
    if (!admin) throw AppError.notFound('管理员不存在');
    if (admin.totpEnabled) throw AppError.conflict('双因素已启用；如需更换请先关闭');
    const secret = generateTotpSecret();
    await this.db.update(admins)
      .set({ totpSecretEnc: this.crypto.encrypt(secret), updatedAt: new Date() })
      .where(eq(admins.id, adminId));
    return { secret, otpauthUri: otpauthUri(secret, admin.email, 'LicenseHub') };
  }

  async enableTotp(adminId: string, code: string): Promise<{ ok: true; recoveryHint: string }> {
    const [admin] = await this.db.select().from(admins).where(eq(admins.id, adminId)).limit(1);
    if (!admin?.totpSecretEnc) throw AppError.badRequest(ErrorCodes.VALIDATION_FAILED, '请先调用 setup 获取密钥');
    const secret = this.crypto.decrypt(admin.totpSecretEnc);
    const counter = matchTotp(secret, code);
    if (counter === null) throw new AppError(ErrorCodes.TWO_FACTOR_INVALID, '动态码不正确，请确认手机时间准确', 400);
    // 只校验通过即可启用；不写入 totpLastCounter，避免紧接着登录被当成重放
    await this.db.update(admins)
      .set({ totpEnabled: true, updatedAt: new Date() })
      .where(eq(admins.id, adminId));
    await this.audit.record({
      actorType: 'admin', actorId: adminId, actorEmail: admin.email,
      action: 'admin.2fa_enabled', targetType: 'admin', targetId: adminId,
    });
    return { ok: true, recoveryHint: '请妥善保存密钥；丢失后需在服务器上手动重置数据库字段' };
  }

  async disableTotp(adminId: string, password: string, code: string): Promise<{ ok: true }> {
    const [admin] = await this.db.select().from(admins).where(eq(admins.id, adminId)).limit(1);
    if (!admin) throw AppError.notFound('管理员不存在');
    if (!this.crypto.verifyPassword(password, admin.passwordHash)) {
      throw AppError.unauthorized(ErrorCodes.INVALID_CREDENTIALS, '密码不正确');
    }
    const secret = admin.totpSecretEnc ? this.crypto.decrypt(admin.totpSecretEnc) : null;
    if (!secret || matchTotp(secret, code) === null) {
      throw new AppError(ErrorCodes.TWO_FACTOR_INVALID, '动态码不正确', 400);
    }
    await this.db.update(admins)
      .set({ totpEnabled: false, totpSecretEnc: null, totpLastCounter: null, updatedAt: new Date() })
      .where(eq(admins.id, adminId));
    await this.audit.record({
      actorType: 'admin', actorId: adminId, actorEmail: admin.email,
      action: 'admin.2fa_disabled', targetType: 'admin', targetId: adminId,
    });
    return { ok: true };
  }

  async changePassword(
    adminId: string,
    dto: ChangePasswordDto,
    keepSessionId?: string,
  ): Promise<{ ok: true; revokedSessions: number }> {
    const [admin] = await this.db.select().from(admins).where(eq(admins.id, adminId)).limit(1);
    if (!admin) throw AppError.notFound('管理员不存在');
    if (!this.crypto.verifyPassword(dto.currentPassword, admin.passwordHash)) {
      throw AppError.unauthorized(ErrorCodes.INVALID_CREDENTIALS, '当前密码不正确');
    }
    if (this.crypto.verifyPassword(dto.newPassword, admin.passwordHash)) {
      throw AppError.badRequest(ErrorCodes.VALIDATION_FAILED, '新密码不能与当前密码相同');
    }
    await this.db.update(admins)
      .set({ passwordHash: this.crypto.hashPassword(dto.newPassword), updatedAt: new Date() })
      .where(eq(admins.id, adminId));
    // 改密后强制其它设备重新登录，但保留当前会话可用（N1）
    const revoked = await this.tokens.revokeAll('admin', adminId, keepSessionId);
    await this.audit.record({
      actorType: 'admin', actorId: adminId, actorEmail: admin.email,
      action: 'admin.password_changed', targetType: 'admin', targetId: adminId,
    });
    return { ok: true, revokedSessions: revoked };
  }

  async listSessions(adminId: string, currentSessionId?: string): Promise<SessionView[]> {
    return this.tokens.listSessions('admin', adminId, currentSessionId);
  }

  async revokeSession(adminId: string, sessionId: string): Promise<{ ok: true }> {
    const ok = await this.tokens.revokeSession('admin', adminId, sessionId);
    if (!ok) throw AppError.notFound('会话不存在或已失效');
    return { ok: true };
  }

  private toSessionUser(admin: AdminRow): SessionUser {
    return {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
      totpEnabled: admin.totpEnabled,
    };
  }
}