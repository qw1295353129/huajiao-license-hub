import { CallHandler, ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import type { FastifyRequest } from 'fastify';
import { AUDIT_KEY, type AuditMeta } from '../decorators';
import type { AuthedRequest } from '../guards/auth.guard';
import { AuditService, redact } from '../../modules/audit/audit.service';

/** 写操作审计：仅在处理器成功返回后落库，避免记录失败请求造成的噪音。 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.getAllAndOverride<AuditMeta>(AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!meta) return next.handle();

    const request = context.switchToHttp().getRequest<AuthedRequest & FastifyRequest>();
    const user = request.user;

    return next.handle().pipe(
      tap((result: unknown) => {
        const params = (request.params ?? {}) as Record<string, string>;
        const targetId = params[meta.targetParam ?? 'id'] ?? null;
        const body = meta.recordBody === false ? undefined : (request.body as unknown);
        void this.audit.record({
          actorType: user?.audience === 'customer' ? 'customer' : user ? 'admin' : 'system',
          actorId: user?.id ?? null,
          actorEmail: user?.email ?? null,
          action: meta.action,
          targetType: meta.targetType ?? null,
          targetId,
          ip: request.ip ?? null,
          userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
          requestId: String((request as { id?: string }).id ?? '') || null,
          diff: {
            ...(body !== undefined ? { request: redact(body) } : {}),
            ...(result !== undefined && meta.recordBody !== false
              ? { after: redact(summarize(result)) }
              : {}),
          },
        });
      }),
    );
  }
}

/** 只保留审计需要的字段，避免把大对象整段写进日志。 */
function summarize(result: unknown): unknown {
  if (result === null || result === undefined) return result;
  if (Array.isArray(result)) return { count: result.length };
  if (typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    if ('items' in obj && Array.isArray(obj.items)) {
      return { count: obj.items.length, total: obj.total ?? null };
    }
  }
  return result;
}
