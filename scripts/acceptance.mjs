/**
 * 端到端验收：在**全新数据库**上从零跑通 PRD 的全部成功标准。
 *
 * 覆盖：首次启动自动建表 + 引导管理员 → 上架产品/策略 → 发卡密 → 客户注册兑换 →
 *       客户端激活/验签/心跳 → 设备超限 → 自助解绑 → 到期提醒 → 续费延期 →
 *       订单支付自动发码 → 退款吊销 → Webhook 投递验签 → 审计留痕。
 *
 * 用法：node scripts/acceptance.mjs
 */
import { spawn } from 'node:child_process';
import { createHmac, createPublicKey, verify as cryptoVerify, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.ACC_PORT ?? 3110);
const BASE = 'http://127.0.0.1:' + PORT;
const ADMIN = { email: 'owner@acceptance.local', password: 'Acceptance12345' };
const dataDir = mkdtempSync(join(tmpdir(), 'licensehub-accept-'));

const results = [];
let failures = 0;

function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition), detail });
  if (!condition) failures += 1;
  console.log((condition ? '  ✅ ' : '  ❌ ') + name + (detail ? '  — ' + detail : ''));
}

async function call(path, { method = 'POST', body, token, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      // 只有真正带 body 时才声明 Content-Type：Fastify 会拒绝「声明了 JSON 但 body 为空」的请求
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json };
}

async function waitForHealth(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE + '/api/health');
      if (res.ok) return await res.json();
    } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('服务在 ' + timeoutMs + 'ms 内没有就绪');
}

const server = spawn('node', ['dist/main.js'], {
  cwd: new URL('../apps/api', import.meta.url).pathname,
  env: {
    ...process.env,
    NODE_ENV: 'production',
    APP_PORT: String(PORT),
    APP_ORIGIN: 'http://127.0.0.1:' + PORT,
    DATABASE_DRIVER: 'pglite',
    PGLITE_DIR: dataDir,
    AUTO_MIGRATE: 'true',
    SWAGGER_ENABLED: 'false',
    JWT_SECRET: 'acceptance-jwt-secret-0123456789abcdefghijklmn',
    LICENSE_PEPPER: 'acceptance-license-pepper-0123456789abcdef',
    DATA_KEY: Buffer.alloc(32, 9).toString('base64'),
    BOOTSTRAP_ADMIN_EMAIL: ADMIN.email,
    BOOTSTRAP_ADMIN_PASSWORD: ADMIN.password,
    SMTP_HOST: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const serverLogs = [];
server.stdout.on('data', (chunk) => serverLogs.push(String(chunk)));
server.stderr.on('data', (chunk) => serverLogs.push(String(chunk)));

// Webhook 接收端（脚本内起一个，验证真实投递与验签）
const received = [];
const receiver = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => { received.push({ headers: req.headers, raw }); res.writeHead(200); res.end('{"ok":true}'); });
});
await new Promise((r) => receiver.listen(0, '127.0.0.1', r));
const receiverPort = receiver.address().port;

let adminToken = '';
let portalToken = '';
let productId = '';
let planId = '';
let apiKey = '';
let licenseId = '';
let licenseKey = '';
let publicKey = '';
let webhookSecret = '';
const deviceA = { fingerprint: 'acceptance-device-A-0001', name: '验收机 A', os: 'macOS 15', appVersion: '1.0.0' };
const deviceB = { fingerprint: 'acceptance-device-B-0002', name: '验收机 B', os: 'Windows 11', appVersion: '1.0.0' };

try {
  console.log('\n=== 0. 首次启动（全新数据库目录，无任何人工建表）===');
  console.log('  数据目录：' + dataDir);
  const health = await waitForHealth();
  check('服务启动且健康检查通过', health.status === 'ok', 'driver=' + health.driver + ' 延迟 ' + health.database.latencyMs + 'ms');
  check('迁移已在启动阶段自动应用（AUTO_MIGRATE）', health.database.ok === true);

  console.log('\n=== 1. 引导管理员与登录 ===');
  const login = await call('/api/admin/auth/login', { body: ADMIN });
  check('环境变量创建的初始管理员可登录', login.status === 201 && login.body.user.role === 'owner',
    login.status === 201 ? login.body.user.email : JSON.stringify(login.body));
  adminToken = login.body?.tokens?.accessToken ?? '';

  console.log('\n=== 2. 上架产品、功能点与授权策略 ===');
  const product = await call('/api/admin/products', { token: adminToken, body: {
    slug: 'acceptance-app', name: '验收产品', description: '端到端验收用', status: 'active',
  } });
  productId = product.body?.id;
  check('创建产品', product.status === 201 && Boolean(productId));

  const feature = await call('/api/admin/products/' + productId + '/features', { token: adminToken,
    body: { key: 'pro-mode', name: '专业模式' } });
  check('新增功能点', feature.status === 201);

  const plan = await call('/api/admin/products/' + productId + '/plans', { token: adminToken, body: {
    code: 'pro-yearly', name: '专业版 · 年付', licenseType: 'subscription', durationDays: 365,
    maxDevices: 1, featureKeys: ['pro-mode'], priceCents: 19900,
  } });
  planId = plan.body?.id;
  check('创建订阅型策略（限 1 台设备）', plan.status === 201 && Boolean(planId));

  const apiKeyRes = await call('/api/admin/api-keys', { token: adminToken, body: {
    name: '验收客户端', scopes: ['license:read', 'license:activate', 'license:verify', 'license:deactivate', 'license:trial'],
  } });
  apiKey = apiKeyRes.body?.key;
  check('创建接入 API Key（明文仅返回一次）', apiKeyRes.status === 201 && apiKey.startsWith('lh_live_'));

  console.log('\n=== 3. 生成卡密并导出 ===');
  const batch = await call('/api/admin/redeem/batches', { token: adminToken, body: {
    name: '验收批次', productId, planId, quantity: 3, channel: 'taobao',
  } });
  const code = batch.body?.codes?.[0];
  check('生成 3 张卡密', batch.status === 201 && batch.body.codes.length === 3, '样例 ' + code);

  const exportRes = await fetch(BASE + '/api/admin/redeem/batches/' + batch.body.batch.id + '/export', {
    headers: { Authorization: 'Bearer ' + adminToken },
  });
  const csv = await exportRes.text();
  check('导出卡密 CSV（含明文，供渠道发货）', exportRes.ok && csv.includes('code,status'),
    csv.split('\n').length - 2 + ' 行');

  console.log('\n=== 4. 客户注册并兑换卡密 ===');
  const register = await call('/api/portal/auth/register', { body: {
    email: 'buyer@acceptance.local', password: 'Buyer12345', name: '验收买家',
  } });
  portalToken = register.body?.tokens?.accessToken ?? '';
  check('客户注册并自动登录', register.status === 201 && Boolean(portalToken));

  const redeem = await call('/api/portal/redeem', { token: portalToken, body: { code } });
  licenseId = redeem.body?.license?.id;
  licenseKey = redeem.body?.licenseKey;
  check('卡密兑换成功并生成正式授权', redeem.status === 201 && Boolean(licenseId), licenseKey);
  check('授权自动归属到该客户', redeem.body?.license?.customerEmail === 'buyer@acceptance.local');

  const reuse = await call('/api/portal/redeem', { token: portalToken, body: { code } });
  check('同一卡密不能重复兑换', reuse.status === 409 && reuse.body.code === 'REDEEM_CODE_USED');

  console.log('\n=== 5. 客户端激活与本地验签 ===');
  const pk = await call('/api/v1/public-key', { method: 'GET', headers: { 'X-Api-Key': apiKey } });
  publicKey = pk.body?.current?.publicKey;
  check('分发 Ed25519 验签公钥', pk.status === 200 && Boolean(publicKey), 'kid=' + pk.body?.current?.kid);

  const activated = await call('/api/v1/activate', { headers: { 'X-Api-Key': apiKey },
    body: { licenseKey, product: 'acceptance-app', device: deviceA } });
  check('客户端激活成功', activated.status === 201 && activated.body.valid === true,
    '功能点 ' + JSON.stringify(activated.body?.entitlements?.features));
  check('返回短期访问令牌与签名授权文件', Boolean(activated.body?.accessToken) && Boolean(activated.body?.licenseFile?.sig));

  const file = activated.body.licenseFile;
  const { sig, ...payload } = file;
  const sortDeep = (value) => {
    if (Array.isArray(value)) return value.map(sortDeep);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => [k, sortDeep(v)]));
    }
    return value;
  };
  const key = createPublicKey({ key: Buffer.from(publicKey, 'base64url'), format: 'der', type: 'spki' });
  const verified = cryptoVerify(null, Buffer.from(JSON.stringify(sortDeep(payload)), 'utf8'), key, Buffer.from(sig, 'base64url'));
  check('客户端可用公钥独立验签授权文件', verified === true);
  const tampered = cryptoVerify(null, Buffer.from(JSON.stringify(sortDeep({ ...payload, maxDevices: 999 })), 'utf8'), key, Buffer.from(sig, 'base64url'));
  check('篡改后的授权文件验签失败', tampered === false);

  const heartbeat = await call('/api/v1/verify', { headers: { 'X-Api-Key': apiKey },
    body: { accessToken: activated.body.accessToken, device: deviceA } });
  check('心跳续期（令牌快路径）返回有效权益', heartbeat.status === 201 && heartbeat.body.valid === true,
    '到期 ' + String(heartbeat.body.expiresAt).slice(0, 10));

  const secondDevice = await call('/api/v1/activate', { headers: { 'X-Api-Key': apiKey },
    body: { licenseKey, device: deviceB } });
  check('设备数超限被拒绝（策略限 1 台）', secondDevice.status === 409 && secondDevice.body.code === 'DEVICE_LIMIT_REACHED');

  console.log('\n=== 6. 门户自助解绑后换机 ===');
  const detail = await call('/api/portal/licenses/' + licenseId, { method: 'GET', token: portalToken });
  if (!Array.isArray(detail.body?.devices)) {
    throw new Error('门户授权详情异常：HTTP ' + detail.status + ' ' + JSON.stringify(detail.body).slice(0, 240));
  }
  const boundDevice = detail.body.devices.find((d) => d.status === 'active');
  if (!boundDevice) throw new Error('门户详情里没有已绑定设备：' + JSON.stringify(detail.body.devices));
  const unbind = await call('/api/portal/licenses/' + licenseId + '/devices/' + boundDevice.id, { method: 'DELETE', token: portalToken });
  check('用户在门户自助解绑设备', unbind.status === 200 && unbind.body.activeDevices === 0,
    unbind.status === 200
      ? '本周期剩余 ' + unbind.body.remainingUnbinds + ' 次'
      : 'HTTP ' + unbind.status + ' ' + JSON.stringify(unbind.body).slice(0, 200));

  const movedToB = await call('/api/v1/activate', { headers: { 'X-Api-Key': apiKey },
    body: { licenseKey, device: deviceB } });
  check('解绑后可换机激活', movedToB.status === 201 && movedToB.body.entitlements.activeDevices === 1);

  console.log('\n=== 7. 到期提醒（定时任务）===');
  const soon = new Date(Date.now() + 7 * 86_400_000 + 3_600_000).toISOString();
  await call('/api/admin/licenses/' + licenseId, { method: 'PATCH', token: adminToken, body: { expiresAt: soon } });
  const remind = await call('/api/admin/tasks/run', { token: adminToken, body: { task: 'expiry-reminders' } });
  check('定时任务发出 T-7 到期提醒', remind.status === 201 && remind.body.detail.sent >= 1, JSON.stringify(remind.body.detail));
  const remindAgain = await call('/api/admin/tasks/run', { token: adminToken, body: { task: 'expiry-reminders' } });
  check('重复执行不会重复提醒（幂等）', remindAgain.body.detail.skipped >= 1);
  const mails = await call('/api/admin/email-logs', { method: 'GET', token: adminToken });
  const reminderMail = (mails.body.items ?? []).find((m) => m.template === 'license_expiring');
  check('提醒邮件已进入发送日志', Boolean(reminderMail), reminderMail ? reminderMail.subject : '未找到');

  console.log('\n=== 8. 续费延期 ===');
  const extend = await call('/api/admin/licenses/' + licenseId + '/extend', { token: adminToken, body: { days: 365, reason: '客户续费' } });
  const days = Math.round((new Date(extend.body.expiresAt) - Date.now()) / 86_400_000);
  check('管理员延长有效期 365 天', extend.status === 201 && days > 360, '剩余 ' + days + ' 天');

  console.log('\n=== 9. 订单：支付自动发码与退款吊销 ===');
  const order = await call('/api/admin/orders', { token: adminToken, body: {
    email: 'order@acceptance.local', items: [{ productId, planId, quantity: 2 }], markPaid: true,
  } });
  check('建单并支付后自动发码 2 条', order.status === 201 && (order.body.licenses ?? []).length === 2, '订单 ' + order.body.orderNo);
  const orderLicenseId = order.body.items[0].licenseId;
  const refund = await call('/api/admin/orders/' + order.body.id + '/refund', { token: adminToken, body: { reason: '验收退款' } });
  check('退款自动吊销关联授权', refund.status === 201 && refund.body.revokedLicenses >= 1);
  const revoked = await call('/api/admin/licenses/' + orderLicenseId, { method: 'GET', token: adminToken });
  check('被退款订单的授权已吊销', revoked.body.status === 'revoked');
  const revokedVerify = await call('/api/v1/verify', { headers: { 'X-Api-Key': apiKey },
    body: { licenseKey: (await call('/api/admin/licenses/' + orderLicenseId + '/reveal', { method: 'GET', token: adminToken })).body.keyFormatted, device: deviceA } });
  check('已吊销授权的心跳返回失效原因', revokedVerify.body.valid === false && revokedVerify.body.reason === 'invalid_revoked');

  console.log('\n=== 10. Webhook 事件投递与验签 ===');
  const hook = await call('/api/admin/webhooks', { token: adminToken, body: {
    url: 'http://127.0.0.1:' + receiverPort + '/receiver',
    description: '验收接收端',
    events: ['license.created', 'license.activated', 'order.paid', 'license.expired'],
  } });
  webhookSecret = hook.body?.secret;
  check('创建 Webhook 端点并拿到签名密钥', hook.status === 201 && Boolean(webhookSecret));
  received.length = 0;
  await call('/api/admin/licenses', { token: adminToken, body: { productId, planId, customerEmail: 'hook@acceptance.local' } });
  const deliver = await call('/api/admin/tasks/run', { token: adminToken, body: { task: 'webhook-deliveries' } });
  const hit = received.find((h) => h.headers['x-lh-event'] === 'license.created');
  check('事件已投递到接收端', Boolean(hit) && deliver.body.detail.succeeded >= 1);
  if (hit) {
    const expected = 'sha256=' + createHmac('sha256', webhookSecret)
      .update(String(hit.headers['x-lh-timestamp']) + '.' + hit.raw).digest('hex');
    check('接收端可独立验签（HMAC-SHA256 + 时间戳）', hit.headers['x-lh-signature'] === expected);
  }

  console.log('\n=== 11. 到期自动失效 ===');
  const expiredLicense = await call('/api/admin/licenses', { token: adminToken, body: { productId, planId, customerEmail: 'exp@acceptance.local' } });
  await call('/api/admin/licenses/' + expiredLicense.body.license.id, { method: 'PATCH', token: adminToken,
    body: { expiresAt: new Date(Date.now() - 3600_000).toISOString() } });
  const expireTask = await call('/api/admin/tasks/run', { token: adminToken, body: { task: 'expire-licenses' } });
  const expiredDetail = await call('/api/admin/licenses/' + expiredLicense.body.license.id, { method: 'GET', token: adminToken });
  check('定时任务把过期授权置为 expired', expireTask.body.detail.expiredLicenses >= 1 && expiredDetail.body.status === 'expired');

  console.log('\n=== 12. 运维：看板、审计与待办 ===');
  const dashboard = await call('/api/admin/dashboard', { method: 'GET', token: adminToken });
  check('看板返回 KPI 与 30 天趋势', dashboard.status === 200 && dashboard.body.timeseries.length === 30,
    '授权 ' + dashboard.body.summary.totalLicenses + ' 条 / 收入 ' + (dashboard.body.summary.revenueTotalCents / 100).toFixed(2) + ' 元');
  const audit = await call('/api/admin/audit-logs?pageSize=100', { method: 'GET', token: adminToken });
  const actions = (audit.body.items ?? []).map((item) => item.action);
  // 管理端 HTTP 写操作走审计拦截器；服务内部的联动（如退款触发的吊销）落在授权事件流里
  check('审计日志覆盖管理端关键操作',
    ['license.create', 'order.refund', 'webhook.create', 'task.run'].every((a) => actions.includes(a)),
    actions.length + ' 条记录');
  const revokedEvents = (revoked.body.events ?? []).map((event) => event.type);
  check('退款吊销在授权事件流中可追溯', revokedEvents.includes('revoked'), revokedEvents.join(','));
  const backlog = await call('/api/admin/tasks/backlog', { method: 'GET', token: adminToken });
  check('任务待办统计可用', typeof backlog.body.pendingWebhookDeliveries === 'number');

  console.log('\n=== 13. 安全边界回归 ===');
  const noAuth = await call('/api/admin/licenses', { method: 'GET' });
  check('未登录访问管理接口返回 401', noAuth.status === 401);
  const badKey = await call('/api/v1/verify', { headers: { 'X-Api-Key': 'lh_live_invalid_key_value' }, body: { licenseKey, device: deviceA } });
  check('非法 API Key 被拒绝', badKey.status === 401 && badKey.body.code === 'API_KEY_INVALID');
  const customerOnAdmin = await call('/api/admin/licenses', { method: 'GET', token: portalToken });
  check('客户令牌不能访问管理接口', customerOnAdmin.status === 403);
  const foreign = await call('/api/portal/licenses/' + expiredLicense.body.license.id, { method: 'GET', token: portalToken });
  check('越权访问他人授权返回 404', foreign.status === 404);
} catch (error) {
  failures += 1;
  console.error('\n❌ 验收中断：' + (error instanceof Error ? error.message : String(error)));
} finally {
  receiver.close();
  server.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 800));
  if (server.exitCode === null) server.kill('SIGKILL');
  rmSync(dataDir, { recursive: true, force: true });
}

const passed = results.filter((r) => r.ok).length;
console.log('\n' + '='.repeat(64));
console.log('验收结果：' + passed + ' / ' + results.length + ' 项通过' + (failures === 0 ? '  🎉 全部通过' : '  ❌ ' + failures + ' 项失败'));
console.log('='.repeat(64));
if (failures > 0) {
  console.log('\n失败项：');
  results.filter((r) => !r.ok).forEach((r) => console.log('  - ' + r.name + (r.detail ? '  (' + r.detail + ')' : '')));
  console.log('\n服务端日志尾部：');
  console.log(serverLogs.join('').split('\n').slice(-25).join('\n'));
  process.exit(1);
}