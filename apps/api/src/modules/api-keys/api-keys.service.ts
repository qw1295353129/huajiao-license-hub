import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, type SQL } from 'drizzle-orm';
import type { ApiKeyScope } from '@license-hub/shared';
import { CryptoService } from '../../crypto/crypto.service';
import { DB } from '../../db/db.module';
import type { DatabaseHandle } from '../../db/db.provider';
import { apiKeys } from '../../db/schema';
import { AppError } from '../../common/errors';
import { normalizePaging } from '../../common/pagination';
import type { CreateApiKeyDto, ListApiKeysDto, UpdateApiKeyDto } from './dto';

@Injectable()
export class ApiKeysService {
  constructor(
    @Inject(DB) private readonly handle: DatabaseHandle,
    private readonly crypto: CryptoService,
  ) {}

  private get db() {
    return this.handle.db;
  }

  private toPublic(row: typeof apiKeys.$inferSelect) {
    return {
      id: row.id,
      name: row.name,
      keyMasked: row.keyMasked,
      scopes: row.scopes,
      productId: row.productId,
      status: row.status,
      lastUsedAt: row.lastUsedAt,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    };
  }

  async list(query: ListApiKeysDto) {
    const { page, pageSize, offset } = normalizePaging(query.page, query.pageSize);
    const conditions: SQL[] = [];
    if (query.productId) conditions.push(eq(apiKeys.productId, query.productId));
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const rows = await this.db.select().from(apiKeys).where(where)
      .orderBy(desc(apiKeys.createdAt)).limit(pageSize).offset(offset);
    const [totalRow] = await this.db.select({ value: count() }).from(apiKeys).where(where);
    return { items: rows.map((row) => this.toPublic(row)), total: Number(totalRow?.value ?? 0), page, pageSize };
  }

  /** 创建 API Key：明文只在返回值里出现一次。 */
  async create(dto: CreateApiKeyDto, actor: { id?: string }) {
    const raw = 'lh_live_' + this.crypto.randomToken(24);
    const [row] = await this.db.insert(apiKeys).values({
      name: dto.name,
      keyLookup: this.crypto.blindIndex(raw, 'apikey'),
      keyEnc: this.crypto.encrypt(raw),
      keyMasked: raw.slice(0, 12) + '****' + raw.slice(-4),
      scopes: dto.scopes as ApiKeyScope[],
      productId: dto.productId ?? null,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      createdBy: actor.id ?? null,
    }).returning();
    return { apiKey: this.toPublic(row), key: raw };
  }

  async reveal(id: string) {
    const [row] = await this.db.select().from(apiKeys).where(eq(apiKeys.id, id)).limit(1);
    if (!row) throw AppError.notFound('API Key 不存在');
    return { key: this.crypto.decrypt(row.keyEnc) };
  }

  async update(id: string, dto: UpdateApiKeyDto) {
    const [existing] = await this.db.select().from(apiKeys).where(eq(apiKeys.id, id)).limit(1);
    if (!existing) throw AppError.notFound('API Key 不存在');
    const [row] = await this.db.update(apiKeys).set({
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.scopes !== undefined ? { scopes: dto.scopes } : {}),
      ...(dto.revoked !== undefined ? { status: dto.revoked ? 'revoked' as const : 'active' as const } : {}),
    }).where(eq(apiKeys.id, id)).returning();
    return this.toPublic(row);
  }

  async revoke(id: string) {
    return this.update(id, { revoked: true });
  }

  async remove(id: string) {
    const rows = await this.db.delete(apiKeys).where(eq(apiKeys.id, id)).returning({ id: apiKeys.id });
    if (rows.length === 0) throw AppError.notFound('API Key 不存在');
    return { ok: true };
  }
}