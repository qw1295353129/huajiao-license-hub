import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLE_RANK, type AdminRole } from '@license-hub/shared';
import { AppError, ErrorCodes } from '../errors';
import { ROLES_KEY } from '../decorators';
import type { AuthedRequest } from './auth.guard';

/** 角色守卫：按 ROLE_RANK 做「至少具备某级别」判断，同时保留精确匹配。 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<AdminRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const user = request.user;
    if (!user) {
      throw AppError.unauthorized(ErrorCodes.UNAUTHENTICATED, '请先登录');
    }
    if (user.audience !== 'admin' || !user.role) {
      throw AppError.forbidden('该接口仅限管理员访问');
    }
    if (required.includes(user.role)) return true;

    const minRank = Math.min(...required.map((role) => ROLE_RANK[role]));
    if (ROLE_RANK[user.role] >= minRank) return true;

    throw AppError.forbidden('需要角色：' + required.join(' / ') + '，当前角色：' + user.role);
  }
}
