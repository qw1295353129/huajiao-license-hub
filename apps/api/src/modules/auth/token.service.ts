import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { CONFIG_TOKEN, type AppConfig } from '../../config/configuration';
import { CryptoService } from '../../crypto/crypto.service';
import { DB } from '../../db/db.module';
import type { DatabaseHandle } from '../../db/db.provider';
import { sessions } from '../../db/schema';
import { AppError, ErrorCodes } from '../../common/errors';
import type { RequestUser } from '../../common/auth-context';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  sessionId: string;
}

export interface SessionView {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  current: boolean;
}

/**
 * 令牌与会话：access token 无状态（15 分钟），refresh token 有状态（可撤销、可轮换）。
 * refresh 只存 HMAC 哈希，库被拖走也无法冒用。
 */
@Injectable()
export class TokenService {
  constructor(
    @Inject(DB) private readonly handle: DatabaseHandle,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
    private readonly jwt: JwtService,
    private readonly crypto: CryptoService,
  ) {}

  private get db() {
    return this.handle.db;
  }

  async issueForUser(
    user: Omit<RequestUser, 'sessionId'>,
    meta: { ip?: string; userAgent?: string; rotatedFrom?: string },
  ): Promise<IssuedTokens> {
    const session = await this.createSession(user.audience, user.id, meta);
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, email: user.email, name: user.name, aud: user.audience, role: user.role, sid: session.id },
      { expiresIn: Math.floor(this.config.security.accessTokenTtlMs / 1000) },
    );
    return {
      accessToken,
      refreshToken: session.refreshToken,
      expiresIn: Math.floor(this.config.security.accessTokenTtlMs / 1000),
      sessionId: session.id,
    };
  }

  private async createSession(
    subjectType: 'admin' | 'customer',
    subjectId: string,
    meta: { ip?: string; userAgent?: string; rotatedFrom?: string },
  ): Promise<{ id: string; refreshToken: string }> {
    const refreshToken = this.crypto.randomToken(32);
    const [row] = await this.db.insert(sessions).values({
      subjectType,
      subjectId,
      refreshTokenHash: this.crypto.sha256(refreshToken),
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
      expiresAt: new Date(Date.now() + this.config.security.refreshTokenTtlMs),
      rotatedFrom: meta.rotatedFrom ?? null,
    }).returning({ id: sessions.id });
    return { id: row.id, refreshToken };
  }

  /**
   * 刷新即轮换：旧会话立即失效，并保留轮换链以便溯源。
   * expectedSubject：在任何写操作前校验会话归属，防止跨端消费刷新令牌（N3）。
   */
  async rotate(
    refreshToken: string,
    meta: { ip?: string; userAgent?: string },
    expectedSubject?: 'admin' | 'customer',
  ): Promise<{ session: { subjectType: 'admin' | 'customer'; subjectId: string }; tokens: IssuedTokens }> {
    const hash = this.crypto.sha256(refreshToken);
    const [session] = await this.db.select().from(sessions).where(eq(sessions.refreshTokenHash, hash)).limit(1);
    if (!session) throw AppError.unauthorized(ErrorCodes.UNAUTHENTICATED, '刷新令牌无效');
    if (expectedSubject && session.subjectType !== expectedSubject) {
      throw AppError.forbidden('该刷新令牌不属于当前端');
    }
    if (session.revokedAt) throw AppError.unauthorized(ErrorCodes.UNAUTHENTICATED, '会话已被撤销，请重新登录');
    if (session.expiresAt.getTime() < Date.now()) {
      throw AppError.unauthorized(ErrorCodes.UNAUTHENTICATED, '会话已过期，请重新登录');
    }

    await this.db.update(sessions)
      .set({ revokedAt: new Date(), lastUsedAt: new Date() })
      .where(eq(sessions.id, session.id));

    const newToken = this.crypto.randomToken(32);
    const [created] = await this.db.insert(sessions).values({
      subjectType: session.subjectType,
      subjectId: session.subjectId,
      refreshTokenHash: this.crypto.sha256(newToken),
      ip: meta.ip ?? session.ip,
      userAgent: meta.userAgent ?? session.userAgent,
      expiresAt: new Date(Date.now() + this.config.security.refreshTokenTtlMs),
      rotatedFrom: session.id,
    }).returning({ id: sessions.id });

    return {
      session: { subjectType: session.subjectType, subjectId: session.subjectId },
      tokens: {
        accessToken: '',
        refreshToken: newToken,
        expiresIn: Math.floor(this.config.security.accessTokenTtlMs / 1000),
        sessionId: created.id,
      },
    };
  }

  async signAccessFor(
    payload: Omit<RequestUser, 'sessionId'>,
    sessionId: string,
  ): Promise<string> {
    return this.jwt.signAsync(
      { sub: payload.id, email: payload.email, name: payload.name, aud: payload.audience, role: payload.role, sid: sessionId },
      { expiresIn: Math.floor(this.config.security.accessTokenTtlMs / 1000) },
    );
  }

  async revokeByRefreshToken(refreshToken: string): Promise<void> {
    const hash = this.crypto.sha256(refreshToken);
    await this.db.update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.refreshTokenHash, hash), isNull(sessions.revokedAt)));
  }

  async revokeSession(subjectType: 'admin' | 'customer', subjectId: string, sessionId: string): Promise<boolean> {
    const result = await this.db.update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(
        eq(sessions.id, sessionId),
        eq(sessions.subjectType, subjectType),
        eq(sessions.subjectId, subjectId),
      ))
      .returning({ id: sessions.id });
    return result.length > 0;
  }

  async revokeAll(subjectType: 'admin' | 'customer', subjectId: string, exceptSessionId?: string): Promise<number> {
    const conditions = [
      eq(sessions.subjectType, subjectType),
      eq(sessions.subjectId, subjectId),
      isNull(sessions.revokedAt),
    ];
    if (exceptSessionId) conditions.push(sql`${sessions.id} <> ${exceptSessionId}`);
    const rows = await this.db.update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(...conditions))
      .returning({ id: sessions.id });
    return rows.length;
  }

  async listSessions(
    subjectType: 'admin' | 'customer',
    subjectId: string,
    currentSessionId?: string,
  ): Promise<SessionView[]> {
    const rows = await this.db.select().from(sessions)
      .where(and(
        eq(sessions.subjectType, subjectType),
        eq(sessions.subjectId, subjectId),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ))
      .orderBy(desc(sessions.lastUsedAt))
      .limit(50);
    return rows.map((row) => ({
      id: row.id,
      ip: row.ip,
      userAgent: row.userAgent,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
      expiresAt: row.expiresAt,
      current: row.id === currentSessionId,
    }));
  }

  async cleanupExpired(): Promise<number> {
    const rows = await this.db.delete(sessions)
      .where(sql`${sessions.expiresAt} < now() - interval '7 days'`)
      .returning({ id: sessions.id });
    return rows.length;
  }
}
