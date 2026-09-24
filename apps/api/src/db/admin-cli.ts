/* eslint-disable no-console */
/**
 * 运维 CLI：后台账号进不去时的最后一条路（在服务器容器里直接执行）。
 *
 *   node dist/db/admin-cli.js list                                  # 列出管理员与锁定状态
 *   node dist/db/admin-cli.js unlock  --email a@b.c                  # 清零失败次数、解除锁定
 *   node dist/db/admin-cli.js reset   --email a@b.c [--password 'X'] # 重置密码（省略则随机生成并打印），并吊销其全部会话
 *   node dist/db/admin-cli.js disable-2fa --email a@b.c              # 关闭双因素（丢失认证器时用）
 *
 * 容器内用法：docker compose exec api node dist/db/admin-cli.js list
 */
import { eq } from 'drizzle-orm';
import { loadEnvFiles } from '../config/load-env';
import { loadConfig } from '../config/configuration';
import { CryptoService } from '../crypto/crypto.service';
import { createDatabase } from './db.provider';
import { admins, sessions } from './schema';

function parseArgs(argv: string[]): { command: string; flags: Record<string, string | boolean> } {
  const [command = 'help', ...rest] = argv;
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = rest[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[key] = next;
      i += 1;
    } else {
      flags[key] = true;
    }
  }
  return { command, flags };
}

function str(value: string | boolean | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function usage(): void {
  console.log([
    '用法：',
    '  node dist/db/admin-cli.js list',
    '  node dist/db/admin-cli.js unlock      --email <邮箱>',
    '  node dist/db/admin-cli.js reset       --email <邮箱> [--password <新密码>]',
    '  node dist/db/admin-cli.js disable-2fa --email <邮箱>',
  ].join('\n'));
}

async function main(): Promise<void> {
  loadEnvFiles();
  // 本 CLI 只做「数据库里已有的账号」的维护，不创建初始管理员；但生产配置校验要求
  // BOOTSTRAP_ADMIN_PASSWORD 存在且不等于示例口令 Admin@12345，否则 loadConfig 会直接抛错。
  // 为了让人在任何环境都能跑运维命令，这里补一个占位值（仅用于通过校验，不会被写入库）。
  const bootstrapPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!bootstrapPassword || bootstrapPassword === 'Admin@12345') {
    process.env.BOOTSTRAP_ADMIN_PASSWORD = 'cli-unused-placeholder';
  }
  const config = loadConfig();
  const crypto = new CryptoService(config);
  const { command, flags } = parseArgs(process.argv.slice(2));
  const email = str(flags.email)?.trim().toLowerCase();

  if (command !== 'list' && !email) {
    usage();
    throw new Error('缺少 --email');
  }

  const handle = await createDatabase(config);
  const db = handle.db;
  try {
    if (command === 'list') {
      const rows = await db.select({
        email: admins.email,
        name: admins.name,
        role: admins.role,
        status: admins.status,
        totpEnabled: admins.totpEnabled,
        failedAttempts: admins.failedAttempts,
        lockedUntil: admins.lockedUntil,
        lastLoginAt: admins.lastLoginAt,
      }).from(admins).orderBy(admins.createdAt);
      if (rows.length === 0) {
        console.log('⚠️  数据库里没有任何管理员：说明首次启动的初始化管理员没有创建成功。');
        console.log('    请检查 api 容器启动日志里是否有「初始化管理员失败」，并确认 BOOTSTRAP_ADMIN_* 已传入容器。');
        return;
      }
      console.table(rows.map((row) => ({
        ...row,
        lockedUntil: row.lockedUntil ? row.lockedUntil.toISOString() : '-',
        lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : '-',
      })));
      return;
    }

    const [target] = await db.select().from(admins).where(eq(admins.email, email!)).limit(1);
    if (!target) throw new Error('找不到管理员：' + email);

    if (command === 'unlock') {
      await db.update(admins)
        .set({ failedAttempts: 0, lockedUntil: null })
        .where(eq(admins.id, target.id));
      console.log('✅ 已解除锁定并清零失败计数：' + target.email);
      return;
    }

    if (command === 'disable-2fa') {
      await db.update(admins)
        .set({ totpEnabled: false, totpSecretEnc: null, totpLastCounter: null, failedAttempts: 0, lockedUntil: null })
        .where(eq(admins.id, target.id));
      console.log('✅ 已关闭双因素并解除锁定：' + target.email);
      return;
    }

    if (command === 'reset') {
      const provided = str(flags.password);
      if (provided !== undefined && provided.length < 8) throw new Error('新密码至少 8 位');
      const password = provided ?? 'Lh-' + crypto.randomToken(9);
      await db.update(admins)
        .set({
          passwordHash: crypto.hashPassword(password),
          failedAttempts: 0,
          lockedUntil: null,
          updatedAt: new Date(),
        })
        .where(eq(admins.id, target.id));
      // 吊销该管理员全部会话：改了密码，旧令牌必须立即失效
      const revoked = await db.delete(sessions).where(eq(sessions.subjectId, target.id)).returning({ id: sessions.id });
      console.log('✅ 已重置密码：' + target.email + '（吊销会话 ' + revoked.length + ' 个）');
      if (provided === undefined) console.log('   新密码（仅本次显示）：' + password);
      return;
    }

    usage();
    throw new Error('未知命令：' + command);
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  console.error('[admin-cli] 失败：', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
