import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { migrate as migrateNodePg } from 'drizzle-orm/node-postgres/migrator';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import type { AppConfig } from '../config/configuration';
import { createDatabase, type DatabaseHandle } from './db.provider';

/**
 * 迁移目录定位：编译产物（dist / dist-test）、tsx 直跑、docker 运行时的相对层级都不同，
 * 因此按候选顺序探测，取第一个真实存在的目录。
 */
function resolveMigrationsFolder(): string {
  const candidates = [
    resolve(process.cwd(), 'drizzle'),
    resolve(process.cwd(), 'apps/api/drizzle'),
    resolve(__dirname, '../../drizzle'),
    resolve(__dirname, '../../../drizzle'),
  ];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'meta', '_journal.json'))) return candidate;
  }
  return candidates[0];
}

export const MIGRATIONS_FOLDER = resolveMigrationsFolder();

/** 对已有连接执行迁移；两种驱动读取同一批 SQL 文件，可重复执行（drizzle 自带迁移记录表）。 */
export async function applyMigrations(handle: DatabaseHandle, log: (msg: string) => void = () => {}): Promise<void> {
  if (handle.driver === 'pglite') {
    await migratePglite(handle.db as never, { migrationsFolder: MIGRATIONS_FOLDER });
  } else {
    await migrateNodePg(handle.db as never, { migrationsFolder: MIGRATIONS_FOLDER });
  }
  log('数据库迁移已应用（' + handle.driver + ' @ ' + handle.location + '）');
}

/** CLI 入口使用：自建连接并迁移后关闭。 */
export async function runMigrations(config: AppConfig, log: (msg: string) => void = () => {}): Promise<void> {
  const handle = await createDatabase(config);
  try {
    log('数据库驱动：' + handle.driver + '  位置：' + handle.location);
    log('迁移目录：' + MIGRATIONS_FOLDER);
    await applyMigrations(handle, log);
  } finally {
    await handle.close();
  }
}