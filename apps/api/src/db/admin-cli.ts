/* eslint-disable no-console */
/**
 * 运维 CLI：后台账号进不去 / api 容器反复重启时的最后一条路（在服务器容器里执行）。
 *
 *   node dist/db/admin-cli.js doctor                                   # 体检：解释 api 为什么起不来
 *   node dist/db/admin-cli.js list                                     # 列出管理员与锁定状态
 *   node dist/db/admin-cli.js unlock  --email a@b.c                    # 清零失败次数、解除锁定
 *   node dist/db/admin-cli.js reset   --email a@b.c [--password 'X']   # 重置密码（省略则随机生成并打印），并吊销其全部会话
 *   node dist/db/admin-cli.js disable-2fa --email a@b.c                # 关闭双因素（丢失认证器时用）
 *
 * 容器内用法（api 起不来时用 run 而不是 exec）：
 *   docker compose run --rm --no-deps api node dist/db/admin-cli.js doctor
 */
import { eq } from 'drizzle-orm';
import { loadEnvFiles } from '../config/load-env';
import { loadConfig, type AppConfig } from '../config/configuration';
import { CryptoService } from '../crypto/crypto.service';
import { createDatabase } from './db.provider';
import { runMigrations } from './migrate';
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
    '  node dist/db/admin-cli.js doctor',
    '  node dist/db/admin-cli.js list',
    '  node dist/db/admin-cli.js unlock      --email <邮箱>',
    '  node dist/db/admin-cli.js reset       --email <邮箱> [--password <新密码>]',
    '  node dist/db/admin-cli.js disable-2fa --email <邮箱>',
  ].join('\n'));
}

/** 打印错误链：drizzle 的 DrizzleQueryError 把真正原因放在 cause 里，只打印 message 看不出根因。 */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const lines: string[] = [error.message];
  const seen = new Set<unknown>([error]);
  let cause: unknown = (error as { cause?: unknown }).cause;
  while (cause instanceof Error && !seen.has(cause)) {
    seen.add(cause);
    lines.push('↳ ' + cause.message);
    cause = (cause as { cause?: unknown }).cause;
  }
  const text = lines.join('\n');
  if (/does not exist|不存在/.test(text)) {
    lines.push('提示：数据库表可能还没建。执行：docker compose run --rm --no-deps api node dist/db/migrate-cli.js');
  }
  return lines.join('\n');
}

/** 打码后的连接串：只保留结构，口令不落日志。 */
function maskedUrl(url: string | null): string {
  if (!url) return '（未配置）';
  try {
    const parsed = new URL(url);
    if (parsed.username) parsed.username = parsed.username;
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return '（无法解析）';
  }
}

/** 体检：逐项解释「api 容器为什么反复重启」——不打印任何密钥明文。 */
async function doctor(): Promise<void> {
  console.log('[doctor] LicenseHub 部署体检（输出不含密钥明文）');
  console.log('');

  console.log('─ 1. 启动配置校验（api 容器用的是同一套规则）');
  let config: AppConfig | null = null;
  try {
    // 不做任何占位替换：api 崩溃的原因在这里会原样出现
    config = loadConfig(process.env);
    console.log('   ✅ 通过：NODE_ENV=' + config.env + '，驱动=' + config.database.driver + '，自动迁移=' + config.database.autoMigrate);
  } catch (error) {
    console.log('   ✖ 配置校验失败 —— 这就是 api 容器反复重启的原因：');
    console.log(describeError(error).split('\n').map((line) => '     ' + line).join('\n'));
  }
  console.log('');

  if (!config) {
    console.log('先把上面这条修掉（改 deploy/.env 后 docker compose up -d），再跑一次 doctor。');
    process.exitCode = 2;
    return;
  }

  console.log('─ 2. 连接串与关键开关');
  console.log('   DATABASE_URL: ' + maskedUrl(config.database.url));
  console.log('   REDIS_URL   : ' + maskedUrl(config.redis.url) + (config.redis.queueEnabled ? '（队列：启用）' : '（队列：进程内降级）'));
  const bootstrapPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  console.log('   BOOTSTRAP_ADMIN_EMAIL   : ' + config.bootstrap.email);
  console.log('   BOOTSTRAP_ADMIN_PASSWORD: ' + (bootstrapPassword ? '已设置（长度 ' + bootstrapPassword.length + '）' : '未设置'));
  console.log('');

  console.log('─ 3. 数据库连通性与表结构');
  const handle = await createDatabase(config);
  try {
    try {
      const rows = await handle.db.select({ id: admins.id }).from(admins);
      console.log('   ✅ 连接成功，admins 表存在，共 ' + rows.length + ' 个管理员');
      if (rows.length === 0) {
        console.log('   ⚠️  没有任何管理员：api 容器首次成功启动时会用 BOOTSTRAP_ADMIN_* 自动创建');
        console.log('      （若日志里出现「初始化管理员失败」，说明创建时出错，把日志发出来）');
      }
    } catch (error) {
      console.log('   ✖ 查询 admins 表失败：');
      console.log(describeError(error).split('\n').map((line) => '     ' + line).join('\n'));
      console.log('   表没建好时，api 自己启动也会跑迁移（AUTO_MIGRATE=true）；既然表还没建，');
      console.log('   通常说明 api 在「配置校验」阶段就挂了（见第 1 项），或者迁移作业失败（docker compose logs migrate）。');
    }
  } finally {
    await handle.close();
  }
  console.log('');

  console.log('─ 4. 下一步');
  if (config.bootstrap.password === 'Admin@12345') {
    console.log('   ✖ BOOTSTRAP_ADMIN_PASSWORD 仍是示例口令，生产会拒绝启动 —— 改成自己的强口令。');
  } else {
    console.log('   · 账号密码不确定：node dist/db/admin-cli.js reset --email ' + config.bootstrap.email);
    console.log('   · 账号被锁：     node dist/db/admin-cli.js unlock --email ' + config.bootstrap.email);
  }
}

async function main(): Promise<void> {
  loadEnvFiles();
  const { command, flags } = parseArgs(process.argv.slice(2));
  const email = str(flags.email)?.trim().toLowerCase();

  if (command === 'doctor') {
    await doctor();
    return;
  }

  // 其余命令只维护「数据库里已有的账号」，不创建初始管理员；但生产配置校验要求
  // BOOTSTRAP_ADMIN_PASSWORD 存在且不等于示例口令 Admin@12345，否则 loadConfig 会直接抛错。
  // 这里补一个占位值（仅用于通过校验，不会被写入库），让运维命令在任何环境都能跑。
  const bootstrapPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!bootstrapPassword || bootstrapPassword === 'Admin@12345') {
    process.env.BOOTSTRAP_ADMIN_PASSWORD = 'cli-unused-placeholder';
  }
  const config = loadConfig();
  const crypto = new CryptoService(config);

  if (command !== 'list' && !email) {
    usage();
    throw new Error('缺少 --email');
  }

  // 与 seed 一致：先补迁移，保证「全新数据库 / 迁移作业没跑成」时也能用
  await runMigrations(config, (msg) => console.log('[admin-cli] ' + msg));

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
        console.log('    先跑 node dist/db/admin-cli.js doctor 看配置校验有没有报错；');
        console.log('    或检查 api 容器日志里是否有「初始化管理员失败」，确认 BOOTSTRAP_ADMIN_* 已传入容器。');
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
  console.error('[admin-cli] 失败：', describeError(error));
  process.exitCode = 1;
});
