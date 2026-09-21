import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import type { ApiKeyScope } from '@license-hub/shared';
import { CryptoService } from '../../crypto/crypto.service';
import { DB } from '../../db/db.module';
import type { DatabaseHandle } from '../../db/db.provider';
import { apiKeys } from '../../db/schema';
import { AppError, ErrorCodes } from '../errors';
import { SCOPES_KEY } from '../decorators';
import type { FastifyRequest } from 'fastify';

export interface ApiKeyContext {
  id: string;
  name: string;
  scopes: ApiKeyScope[];
  productId: string | null;
}

export interface ApiKeyRequest extends FastifyRequest {
  apiKey?: ApiKeyContext;
}

/** 客户端接入鉴权：X-Api-Key + 作用域校验。 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DB) private readonly handle: DatabaseHandle,
    private readonly crypto: CryptoService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // ⚠️ 这里刻意**不**检查 @Public()：
    // @Public() 的语义是「跳过全局 Bearer 守卫」，客户端接口仍然必须校验 X-Api-Key。
    // （曾经的实现同时尊重 @Public，导致 /api/v1/* 完全裸奔——已由 e2e 用例锁死。）
    const request = context.switchToHttp().getRequest<ApiKeyRequest>();
    const raw = request.headers['x-api-key'];
    const key = Array.isArray(raw) ? raw[0] : raw;
    if (!key || key.trim().length < 12) {
      throw AppError.unauthorized(ErrorCodes.API_KEY_INVALID, '缺少 X-Api-Key 请求头');
    }

    const lookup = this.crypto.blindIndex(key.trim(), 'apikey');
    const [row] = await this.handle.db.select().from(apiKeys).where(eq(apiKeys.keyLookup, lookup)).limit(1);
    if (!row) throw AppError.unauthorized(ErrorCodes.API_KEY_INVALID, 'API Key 无效');
    if (row.status !== 'active') throw AppError.forbidden('API Key 已被吊销');
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
      throw AppError.unauthorized(ErrorCodes.API_KEY_INVALID, 'API Key 已过期');
    }

    const required = this.reflector.getAllAndOverride<ApiKeyScope[]>(SCOPES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required && required.length > 0) {
      const granted = new Set(row.scopes);
      const missing = required.filter((scope) => !granted.has(scope));
      if (missing.length > 0) {
        throw new AppError(
          ErrorCodes.SCOPE_MISSING,
          'API Key 缺少作用域：' + missing.join(', '),
          403,
          { missing, granted: row.scopes },
        );
      }
    }

    request.apiKey = { id: row.id, name: row.name, scopes: row.scopes, productId: row.productId };

    // 记录最近使用时间（失败不影响主流程）
    void this.handle.db.update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, row.id))
      .catch(() => undefined as never);

    return true;
  }
}