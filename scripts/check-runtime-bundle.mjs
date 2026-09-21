/**
 * 运行阶段「镜像内容充分性」验证。
 *
 * 本机没有 Docker 守护进程，无法真的 build；于是按 apps/api/Dockerfile 的 RUNNER 阶段
 * 逐条复制相同的文件集到临时目录，模拟容器里的文件系统布局，然后：
 *   1) 跑迁移作业（compose 里 migrate 服务的命令）
 *   2) 启动 API 并验证健康检查 + 登录 + 一次授权发放
 * 这能证明「镜像里带的文件是够用的」——这是 build 失败之外最常见的部署事故。
 */
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const PORT = Number(process.env.BUNDLE_PORT ?? 3120);
const bundle = mkdtempSync(join(tmpdir(), 'licensehub-image-'));

// 与 Dockerfile RUNNER 阶段的 COPY 列表保持一致
const RUNNER_FILES = [
  'package.json',
  'pnpm-workspace.yaml',
  'packages/shared/package.json',
  'packages/shared/dist',
  'apps/api/package.json',
  'apps/api/dist',
  'apps/api/drizzle',
  // pnpm 的 workspace 依赖是符号链接布局，必须带上 apps/api/node_modules
  'apps/api/node_modules',
];

let failed = 0;
function check(name, ok, detail = '') {
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? '  — ' + detail : ''));
  if (!ok) failed += 1;
}

try {
  console.log('\n=== 1. 复现镜像运行阶段文件布局 ===');
  console.log('  目标目录：' + bundle);
  for (const entry of RUNNER_FILES) {
    const source = join(root, entry);
    if (!existsSync(source)) { check('复制 ' + entry, false, '源文件不存在'); continue; }
    const target = join(bundle, entry);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(source, target, { recursive: true, dereference: false });
  }
  // node_modules：pnpm 是符号链接农场，必须整棵复制（含 .pnpm）
  cpSync(join(root, 'node_modules'), join(bundle, 'node_modules'), { recursive: true, dereference: false });
  const layoutReady = existsSync(join(bundle, 'apps/api/dist/main.js')) && existsSync(join(bundle, 'node_modules'));
  check('运行阶段文件集复制完成', layoutReady, RUNNER_FILES.length + ' 项 + node_modules');
  check('迁移目录随镜像带上（否则首启无法建表）', existsSync(join(bundle, 'apps/api/drizzle/meta/_journal.json')));

  const env = {
    ...process.env,
    NODE_ENV: 'production',
    APP_PORT: String(PORT),
    APP_ORIGIN: 'http://127.0.0.1:' + PORT,
    DATABASE_DRIVER: 'pglite',
    PGLITE_DIR: join(bundle, 'data'),
    AUTO_MIGRATE: 'false', // 先手动跑迁移，模拟 compose 的 migrate 服务
    SWAGGER_ENABLED: 'false',
    JWT_SECRET: 'image-bundle-jwt-secret-0123456789abcdefghij',
    LICENSE_PEPPER: 'image-bundle-license-pepper-0123456789ab',
    DATA_KEY: Buffer.alloc(32, 5).toString('base64'),
    BOOTSTRAP_ADMIN_EMAIL: 'image@bundle.local',
    BOOTSTRAP_ADMIN_PASSWORD: 'ImageBundle12345',
    SMTP_HOST: '',
  };

  console.log('\n=== 2. 迁移作业（等价于 compose 的 migrate 服务）===');
  const migrate = spawn('node', ['dist/db/migrate-cli.js'], { cwd: join(bundle, 'apps/api'), env });
  let migrateLog = '';
  migrate.stdout.on('data', (c) => { migrateLog += String(c); });
  migrate.stderr.on('data', (c) => { migrateLog += String(c); });
  const migrateCode = await new Promise((resolve) => migrate.on('exit', resolve));
  check('node dist/db/migrate-cli.js 在镜像布局下执行成功',
    migrateCode === 0 && (migrateLog.includes('迁移已应用') || migrateLog.includes('迁移完成')),
    migrateLog.trim().split('\n').slice(-1)[0] ?? '');

  console.log('\n=== 3. 启动 API（等价于 compose 的 api 服务）===');
  const server = spawn('node', ['dist/main.js'], { cwd: join(bundle, 'apps/api'), env: { ...env, AUTO_MIGRATE: 'true' } });
  const logs = [];
  server.stdout.on('data', (c) => logs.push(String(c)));
  server.stderr.on('data', (c) => logs.push(String(c)));

  const base = 'http://127.0.0.1:' + PORT;
  let health = null;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(base + '/api/health');
      if (res.ok) { health = await res.json(); break; }
    } catch { /* 尚未就绪 */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  check('健康检查在镜像布局下返回 ok', health?.status === 'ok', health ? 'driver=' + health.driver : '超时');

  const login = await fetch(base + '/api/admin/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: env.BOOTSTRAP_ADMIN_EMAIL, password: env.BOOTSTRAP_ADMIN_PASSWORD }),
  });
  const loginBody = await login.json();
  check('引导管理员在镜像布局下可登录', login.status === 201 && loginBody.user?.role === 'owner');

  const token = loginBody.tokens?.accessToken;
  const product = await fetch(base + '/api/admin/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ slug: 'bundle-app', name: '镜像验证产品', status: 'active' }),
  });
  check('业务接口可用（创建产品）', product.status === 201);

  server.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 700));
  if (server.exitCode === null) server.kill('SIGKILL');

  if (failed > 0) {
    console.log('\n服务端日志尾部：');
    console.log(logs.join('').split('\n').slice(-20).join('\n'));
  }
} catch (error) {
  failed += 1;
  console.error('❌ 校验中断：' + (error instanceof Error ? error.message : String(error)));
} finally {
  rmSync(bundle, { recursive: true, force: true });
}

console.log('\n' + (failed === 0
  ? '🎉 镜像运行阶段文件集充分：迁移与启动都能在相同布局下跑通（本机无 Docker，未执行真实 build）'
  : '❌ 存在 ' + failed + ' 项问题'));
process.exit(failed === 0 ? 0 : 1);