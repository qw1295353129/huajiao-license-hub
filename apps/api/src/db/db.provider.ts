import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { drizzle as drizzleNodePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { Pool } from 'pg';
import type { AppConfig } from '../config/configuration';
import { schema } from './schema';

/**
 * 双驱动：生产用真实 PostgreSQL；本地/测试可用 PGlite（WASM Postgres，零外部依赖）。
 * 两者共用同一份 schema 与同一批 SQL 迁移文件，行为一致。
 */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DatabaseHandle {
  db: Database;
  driver: 'postgres' | 'pglite';
  close: () => Promise<void>;
  /** PGlite 专用：导出数据目录位置，便于日志提示 */
  location: string;
}

export type AnyDrizzleDb = NodePgDatabase<typeof schema> | PgliteDatabase<typeof schema>;

export async function createDatabase(config: AppConfig): Promise<DatabaseHandle> {
  if (config.database.driver === 'pglite') {
    const { PGlite } = await import('@electric-sql/pglite');
    const raw = config.database.pgliteDir;
    // 注意：PGlite 把 ':memory:' 当普通目录名，必须显式不传参数才是真正的内存实例
    const inMemory = raw === ':memory:' || raw === 'memory://' || raw === '';
    const dir = inMemory ? ':memory:' : resolve(raw);
    if (!inMemory) mkdirSync(dir, { recursive: true });
    const client = inMemory ? new PGlite() : new PGlite(dir);
    await client.waitReady;
    const db = drizzlePglite(client, { schema, casing: 'snake_case' });
    return {
      db: db as unknown as Database,
      driver: 'pglite',
      location: dir,
      close: async () => {
        await client.close();
      },
    };
  }

  const pool = new Pool({ connectionString: config.database.url, max: 10 });
  const db = drizzleNodePg(pool, { schema, casing: 'snake_case' });
  return {
    db: db as unknown as Database,
    driver: 'postgres',
    location: redactUrl(config.database.url),
    close: async () => {
      await pool.end();
    },
  };
}

/** 供迁移与 seed 使用：拿到原始 drizzle 实例（保留驱动特有方法）。 */
export async function createRawDatabase(config: AppConfig): Promise<{ db: AnyDrizzleDb; close: () => Promise<void> }> {
  const handle = await createDatabase(config);
  return { db: handle.db as unknown as AnyDrizzleDb, close: handle.close };
}

function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return url;
  }
}

/** 确保目录存在（PGlite 数据目录的父目录）。 */
export function ensureDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}