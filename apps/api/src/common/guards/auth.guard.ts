import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { FastifyRequest } from 'fastify';
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
