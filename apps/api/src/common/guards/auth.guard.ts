import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { DB } from '../../db/db.module';
import type { DatabaseHandle } from '../../db/db.provider';
import { sessions } from '../../db/schema';
import { AppError, ErrorCodes } from '../errors';
import { AUDIENCE_KEY, IS_PUBLIC_KEY } from '../decorators';
import type { AccessTokenPayload, RequestUser } from '../auth-context';

export interface AuthedRequest extends FastifyRequest {
  user?: RequestUser;
}

/** 全局登录守卫：@Public() 放行，其余要求 Bearer access token。 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    @Inject(DB) private readonly handle: DatabaseHandle,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const header = request.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw AppError.unauthorized(ErrorCodes.UNAUTHENTICATED, '缺少访问令牌，请先登录');
    }
    const token = header.slice('Bearer '.length).trim();

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw AppError.unauthorized(ErrorCodes.UNAUTHENTICATED, '访问令牌无效或已过期');
    }

    if (!payload.sub || !payload.aud) {
      throw AppError.unauthorized(ErrorCodes.UNAUTHENTICATED, '访问令牌缺少必要字段');
    }

    // ⚠️ 会话校验：access token 是无状态 JWT，若不查会话，
    // 「重置密码 / 停用账号 / 踢下线」后旧令牌仍能在有效期内继续用（最多 15 分钟）。
    // 管理端与门户都必须立即生效，因此这里做一次会话存在性 + 撤销校验。
    if (payload.sid) {
      const [session] = await this.handle.db.select({
        id: sessions.id,
        revokedAt: sessions.revokedAt,
        expiresAt: sessions.expiresAt,
      }).from(sessions).where(eq(sessions.id, payload.sid)).limit(1);

      if (!session || session.revokedAt) {
        throw AppError.unauthorized(ErrorCodes.UNAUTHENTICATED, '会话已失效，请重新登录');
      }
      if (session.expiresAt.getTime() < Date.now()) {
        throw AppError.unauthorized(ErrorCodes.UNAUTHENTICATED, '会话已过期，请重新登录');
      }
    }

    const requiredAudience = this.reflector.getAllAndOverride<'admin' | 'customer'>(AUDIENCE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (requiredAudience && payload.aud !== requiredAudience) {
      throw AppError.forbidden('令牌受众与接口不匹配（' + payload.aud + ' ≠ ' + requiredAudience + '）');
    }

    request.user = {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      audience: payload.aud,
      role: payload.role,
      sessionId: payload.sid,
    };
    return true;
  }
}
