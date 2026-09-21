import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, ilike, lte, or, sql, type SQL } from 'drizzle-orm';
import type { ActorType } from '@license-hub/shared';
import { DB } from '../../db/db.module';
import type { DatabaseHandle } from '../../db/db.provider';
import { auditLogs } from '../../db/schema';

const SENSITIVE_KEYS = [
  'password', 'passwordHash', 'newPassword', 'currentPassword', 'token', 'accessToken',
  'refreshToken', 'licenseKey', 'key', 'apiKey', 'secret', 'totpSecret', 'code',
  'dataKey', 'licensePepper', 'jwtSecret', 'privateKey',
];

/** 递归脱敏：审计与日志里绝不能出现明文密钥。 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[deep]';
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
     out[key] = SENSITIVE_KEYS.some((s) => key.toLowerCase().includes(s.toLowerCase()))
        ? '***'
        : redact(val, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 500) return value.slice(0, 500) + '…';
  return value;
}

export interface AuditInput {
  actorType?: ActorType;
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  diff?: { before?: unknown; after?: unknown } | null;
}

export interface AuditQuery {
  page?: number;
  pageSize?: number;
  action?: string;
  actorEmail?: string;
  targetType?: string;
  targetId?: string;
  from?: Date;
  to?: Date;
}

@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly handle: DatabaseHandle) {}

  private get db() {
    return this.handle.db;
  }

  /** 写审计日志：失败不抛错，避免影响主流程。 */
  async record(input: AuditInput): Promise<void> {
    try {
      await this.db.insert(auditLogs).values({
        actorType: input.actorType ?? 'system',
        actorId: input.actorId ?? null,
        actorEmail: input.actorEmail ?? null,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        requestId: input.requestId ?? null,
        diff: input.diff ? (redact(input.diff) as { before?: unknown; after?: unknown }) : null,
      });
    } catch {
      /* 审计失败不应阻断业务 */
    }
  }

  async list(query: AuditQuery) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 20));
    const conditions: SQL[] = [];
    if (query.action) conditions.push(ilike(auditLogs.action, '%' + query.action + '%'));
    if (query.actorEmail) conditions.push(ilike(auditLogs.actorEmail, '%' + query.actorEmail + '%'));
    if (query.targetType) conditions.push(eq(auditLogs.targetType, query.targetType));
    if (query.targetId) conditions.push(eq(auditLogs.targetId, query.targetId));
    if (query.from) conditions.push(gte(auditLogs.createdAt, query.from));
    if (query.to) conditions.push(lte(auditLogs.createdAt, query.to));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [items, totalRow] = await Promise.all([
      this.db.select().from(auditLogs).where(where)
        .orderBy(desc(auditLogs.createdAt))
        .limit(pageSize).offset((page - 1) * pageSize),
      this.db.select({ count: sql<number>`count(*)::int` }).from(auditLogs).where(where),
    ]);
    return { items, total: totalRow[0]?.count ?? 0, page, pageSize };
  }

  async searchActors(keyword: string) {
    return this.db.select({ email: auditLogs.actorEmail })
      .from(auditLogs)
      .where(or(ilike(auditLogs.actorEmail, '%' + keyword + '%')))
      .groupBy(auditLogs.actorEmail)
      .limit(20);
  }
}
