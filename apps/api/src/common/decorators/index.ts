import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AdminRole } from '@license-hub/shared';
import type { RequestUser } from '../auth-context';

export const IS_PUBLIC_KEY = 'lh:isPublic';
export const ROLES_KEY = 'lh:roles';
export const AUDIENCE_KEY = 'lh:audience';
export const AUDIT_KEY = 'lh:audit';

/** 公开路由：跳过登录校验。 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** 允许的角色（需先通过登录校验）。readonly 等低权角色会被拒绝并说明所需角色。 */
export const Roles = (...roles: AdminRole[]) => SetMetadata(ROLES_KEY, roles);

/** 限定令牌受众，防止客户令牌访问管理端接口。 */
export const Audience = (audience: 'admin' | 'customer') => SetMetadata(AUDIENCE_KEY, audience);

export interface AuditMeta {
  action: string;
  targetType?: string;
  /** 从路由参数取值作为 targetId，默认 'id' */
  targetParam?: string;
  /** 是否记录请求体（默认 true，会自动脱敏） */
  recordBody?: boolean;
}

/** 标记需要写审计日志的写操作。 */
export const Audit = (meta: AuditMeta) => SetMetadata(AUDIT_KEY, meta);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): RequestUser => {
  const request = ctx.switchToHttp().getRequest<{ user?: RequestUser }>();
  if (!request.user) throw new Error('CurrentUser 只能在已认证的路由中使用');
  return request.user;
});

export const ClientIp = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<{ ip?: string; headers: Record<string, string | string[] | undefined> }>();
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) return forwarded.split(',')[0].trim();
  return request.ip ?? 'unknown';
});

export const UserAgent = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined> }>();
  const ua = request.headers['user-agent'];
  return typeof ua === 'string' ? ua : '';
});
