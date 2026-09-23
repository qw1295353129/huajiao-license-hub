import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createPublicKey, verify as cryptoVerify } from 'node:crypto';
import type { LicenseFile } from '@license-hub/shared';
import { canonicalJsonLikeServer } from './utils/signature';
import { TEST_ADMIN } from './env';
import { closeTestApp, createTestApp, type TestContext } from './utils/test-app';

describe('授权发放与激活全链路（e2e）', () => {
  let ctx: TestContext;
  let server: never;
  let token = '';
  let apiKey = '';
  let productId = '';
  let proPlanId = '';
  let trialPlanId = '';
  let licenseId = '';
  let licenseKey = '';
  let publicKey = '';
  const deviceA = { fingerprint: 'device-aaaa-1111-bbbb-2222', name: '工作站 A', os: 'macOS 15', appVersion: '1.0.0' };
  const deviceB = { fingerprint: 'device-cccc-3333-dddd-4444', name: '笔记本 B', os: 'Windows 11', appVersion: '1.0.0' };

  before(async () => {
    ctx = await createTestApp();
    server = ctx.server as never;
    const login = await request(server).post('/api/admin/auth/login').send(TEST_ADMIN);
    token = login.body.tokens.accessToken;
  });

  after(async () => {
    await closeTestApp(ctx);
  });

  const auth = () => ({ Authorization: 'Bearer ' + token });
  const withKey = () => ({ 'X-Api-Key': apiKey });

  it('创建产品、功能点与两套策略', async () => {
    const product = await request(server).post('/api/admin/products').set(auth()).send({
      slug: 'demo-app', name: '示例软件', description: '端到端测试用产品', status: 'active', keyPrefix: 'DEMO',
    });
    assert.equal(product.status, 201);
    productId = product.body.id;

    for (const feature of [
      { key: 'pro-mode', name: '专业模式' },
      { key: 'export-pdf', name: 'PDF 导出' },
    ]) {
      const res = await request(server).post('/api/admin/products/' + productId + '/features').set(auth()).send(feature);
      assert.equal(res.status, 201);
    }

    const pro = await request(server).post('/api/admin/products/' + productId + '/plans').set(auth()).send({
      code: 'pro-yearly', name: '专业版年付', licenseType: 'subscription', durationDays: 365,
      maxDevices: 1, featureKeys: ['pro-mode', 'export-pdf'], priceCents: 19900,
    });
    assert.equal(pro.status, 201);
    proPlanId = pro.body.id;

    const trial = await request(server).post('/api/admin/products/' + productId + '/plans').set(auth()).send({
      code: 'trial-14', name: '14 天试用', licenseType: 'trial', durationDays: 14, maxDevices: 1, featureKeys: ['pro-mode'],
    });
    assert.equal(trial.status, 201);
    trialPlanId = trial.body.id;

    const dup = await request(server).post('/api/admin/products').set(auth()).send({ slug: 'demo-app', name: '重复产品' });
    assert.equal(dup.status, 409);
  });

  it('订阅型策略缺少有效期会被拒绝', async () => {
    const res = await request(server).post('/api/admin/products/' + productId + '/plans').set(auth()).send({
      code: 'bad-plan', name: '缺有效期', licenseType: 'subscription',
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'VALIDATION_FAILED');
  });

  it('创建接入 API Key（明文只返回一次）', async () => {
    const res = await request(server).post('/api/admin/api-keys').set(auth()).send({
      name: '测试客户端',
      scopes: ['license:read', 'license:activate', 'license:verify', 'license:deactivate', 'license:trial'],
    });
    assert.equal(res.status, 201);
    apiKey = res.body.key;
    assert.ok(apiKey.startsWith('lh_live_'));
    assert.ok(res.body.apiKey.keyMasked.includes('****'));

    const list = await request(server).get('/api/admin/api-keys').set(auth());
    assert.equal(list.status, 200);
    assert.ok(!JSON.stringify(list.body).includes(apiKey), '列表接口不得返回明文 Key');
  });

  it('缺少或错误的 API Key 会被拒绝，作用域不足返回 SCOPE_MISSING', async () => {
    const noKey = await request(server).post('/api/v1/activate').send({ licenseKey: 'X'.repeat(20), device: deviceA });
    assert.equal(noKey.status, 401);
    assert.equal(noKey.body.code, 'API_KEY_INVALID');

    const badKey = await request(server).post('/api/v1/activate').set({ 'X-Api-Key': 'lh_live_wrong_wrong_wrong' });
    assert.equal(badKey.status, 401);

    const limited = await request(server).post('/api/admin/api-keys').set(auth()).send({ name: '只读 Key', scopes: ['license:read'] });
    const scopeDenied = await request(server).post('/api/v1/activate')
      .set({ 'X-Api-Key': limited.body.key })
      .send({ licenseKey: 'X'.repeat(20), device: deviceA });
    assert.equal(scopeDenied.status, 403);
    assert.equal(scopeDenied.body.code, 'SCOPE_MISSING');
    assert.ok(Array.isArray(scopeDenied.body.details.missing));
  });

  it('发放单个授权：返回明文码，列表只显示掩码', async () => {
    const res = await request(server).post('/api/admin/licenses').set(auth()).send({
      productId, planId: proPlanId, customerEmail: 'Buyer@Example.com', notes: '首个付费客户',
    });
    assert.equal(res.status, 201);
    licenseId = res.body.license.id;
    licenseKey = res.body.keyFormatted;
    assert.match(licenseKey, /^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/);
    assert.equal(res.body.license.customerEmail, 'buyer@example.com');
    assert.equal(res.body.license.status, 'issued');
    assert.equal(res.body.license.maxDevices, 1);

    const list = await request(server).get('/api/admin/licenses').set(auth());
    assert.equal(list.status, 200);
    assert.equal(list.body.total, 1);
    assert.ok(!JSON.stringify(list.body).includes(licenseKey.replace(/-/g, '')), '列表不得返回明文授权码');
    assert.ok(list.body.items[0].keyMasked.includes('****'));
  });

  it('产品列表的统计子查询返回真实计数（回归：关联子查询曾静默返回 0）', async () => {
    const res = await request(server).get('/api/admin/products').set(auth());
    assert.equal(res.status, 200);
    const row = (res.body.items as { planCount: number; licenseCount: number }[])[0];
    assert.equal(row.planCount, 2, '应有 2 个策略');
    assert.equal(row.licenseCount, 1, '应有 1 条授权');
  });

  it('公钥分发：可获取当前 Ed25519 公钥', async () => {
    const res = await request(server).get('/api/v1/public-key').set(withKey());
    assert.equal(res.status, 200);
    assert.equal(res.body.algo, 'ed25519');
    assert.ok(res.body.current.kid.startsWith('lk-'));
    publicKey = res.body.current.publicKey;
  });

  it('激活：绑定设备并返回可离线验签的授权文件', async () => {
    const res = await request(server).post('/api/v1/activate').set(withKey())
      .send({ licenseKey, product: 'demo-app', device: deviceA });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.valid, true);
    assert.ok(res.body.accessToken);
    assert.equal(res.body.entitlements.features.length, 2);
    assert.equal(res.body.entitlements.activeDevices, 1);

    const file = res.body.licenseFile as LicenseFile;
    assert.equal(file.kid, 'lk-' + new Date().toISOString().slice(0, 7) + '-01');
    assert.equal(file.product, 'demo-app');
    assert.equal(file.perpetual, false);
    assert.equal(file.deviceFingerprint, deviceA.fingerprint);

    // 客户端视角独立验签：用服务端公钥验证签名
    const { sig, ...payload } = file;
    const key = createPublicKey({ key: Buffer.from(publicKey, 'base64url'), format: 'der', type: 'spki' });
    const ok = cryptoVerify(
      null,
      Buffer.from(canonicalJsonLikeServer(payload), 'utf8'),
      key,
      Buffer.from(sig, 'base64url'),
    );
    assert.equal(ok, true, '客户端应能用公钥独立验签通过');

    const tampered = { ...payload, maxDevices: 999 };
    const bad = cryptoVerify(
      null,
      Buffer.from(canonicalJsonLikeServer(tampered), 'utf8'),
      key,
      Buffer.from(sig, 'base64url'),
    );
    assert.equal(bad, false, '篡改后的授权文件必须验签失败');
  });

  it('心跳校验：令牌快路径与授权码慢路径都能拿到权益', async () => {
    const activation = await request(server).post('/api/v1/activate').set(withKey())
      .send({ licenseKey, device: deviceA });
    const accessToken = activation.body.accessToken as string;

    const fast = await request(server).post('/api/v1/verify').set(withKey())
      .send({ accessToken, device: deviceA });
    assert.equal(fast.status, 201);
    assert.equal(fast.body.valid, true);
    assert.equal(fast.body.activeDevices, 1);

    const slow = await request(server).post('/api/v1/verify').set(withKey())
      .send({ licenseKey, device: deviceA });
    assert.equal(slow.status, 201);
    assert.equal(slow.body.valid, true);
  });

  it('设备数超限：默认策略拒绝第二台设备', async () => {
    const res = await request(server).post('/api/v1/activate').set(withKey())
      .send({ licenseKey, device: deviceB });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'DEVICE_LIMIT_REACHED');
    assert.equal(res.body.details.maxDevices, 1);
  });

  it('解绑后可以换机激活，激活计数正确回落', async () => {
    const off = await request(server).post('/api/v1/deactivate').set(withKey())
      .send({ licenseKey, device: deviceA, reason: '换电脑' });
    assert.equal(off.status, 201);
    assert.equal(off.body.activeDevices, 0);

    const again = await request(server).post('/api/v1/deactivate').set(withKey())
      .send({ licenseKey, device: deviceA });
    assert.equal(again.status, 404);
    assert.equal(again.body.code, 'DEVICE_NOT_BOUND');

    const moved = await request(server).post('/api/v1/activate').set(withKey())
      .send({ licenseKey, device: deviceB });
    assert.equal(moved.status, 201);
    assert.equal(moved.body.entitlements.activeDevices, 1);
  });

  it('未激活设备的心跳返回 invalid_device 而不是报错', async () => {
    const res = await request(server).post('/api/v1/verify').set(withKey())
      .send({ licenseKey, device: deviceA });
    assert.equal(res.status, 201);
    assert.equal(res.body.valid, false);
    assert.equal(res.body.reason, 'invalid_device');
  });

  it('吊销后激活被拒、心跳返回失效原因，且写审计', async () => {
    const revoke = await request(server).post('/api/admin/licenses/' + licenseId + '/revoke')
      .set(auth()).send({ reason: '退款' });
    assert.equal(revoke.status, 201);
    assert.equal(revoke.body.status, 'revoked');

    const activate = await request(server).post('/api/v1/activate').set(withKey())
      .send({ licenseKey, device: deviceA });
    assert.equal(activate.status, 410);

    const verify = await request(server).post('/api/v1/verify').set(withKey())
      .send({ licenseKey, device: deviceB });
    assert.equal(verify.status, 201);
    assert.equal(verify.body.valid, false);
    assert.equal(verify.body.reason, 'invalid_revoked');

    const audit = await request(server).get('/api/admin/audit-logs?action=license.revoke').set(auth());
    assert.equal(audit.status, 200);
    assert.ok(audit.body.total >= 1);
  });

  it('吊销后不可恢复；暂停→恢复可用，延期会写入事件', async () => {
    const denied = await request(server).post('/api/admin/licenses/' + licenseId + '/resume').set(auth()).send({});
    assert.equal(denied.status, 409, '已吊销授权不得 resume');

    const suspended = await request(server).post('/api/admin/licenses/' + licenseId + '/suspend')
      .set(auth()).send({ reason: '临时冻结以便测试恢复' });
    assert.equal(suspended.status, 201);
    assert.equal(suspended.body.status, 'suspended');

    const resume = await request(server).post('/api/admin/licenses/' + licenseId + '/resume').set(auth()).send({});
    assert.equal(resume.status, 201);
    assert.equal(resume.body.status, 'active');

    const extend = await request(server).post('/api/admin/licenses/' + licenseId + '/extend')
      .set(auth()).send({ days: 30, reason: '补偿' });
    assert.equal(extend.status, 201);

    const detail = await request(server).get('/api/admin/licenses/' + licenseId).set(auth());
    const types = (detail.body.events as { type: string }[]).map((e) => e.type);
    assert.ok(types.includes('created'));
    assert.ok(types.includes('activated'));
    assert.ok(types.includes('revoked'));
    assert.ok(types.includes('resumed'));
    assert.ok(types.includes('extended'));
    assert.ok(types.includes('deactivated'));
  });

  it('查看明文授权码会记录审计（与掩码一致）', async () => {
    const res = await request(server).get('/api/admin/licenses/' + licenseId + '/reveal').set(auth());
    assert.equal(res.status, 200);
    assert.equal(res.body.keyFormatted, licenseKey);

    const audit = await request(server).get('/api/admin/audit-logs?action=license.reveal_key').set(auth());
    assert.ok(audit.body.total >= 1);
  });

  it('批量发码 200 条并统计', async () => {
    const res = await request(server).post('/api/admin/licenses/batch').set(auth()).send({
      productId, planId: proPlanId, count: 200, notes: '淘宝批次', batchLabel: 'taobao-2026-09',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.created, 200);
    assert.equal(new Set(res.body.keys).size, 200, '批量生成的授权码必须互不重复');

    const stats = await request(server).get('/api/admin/licenses/stats').set(auth());
    assert.equal(stats.status, 200);
    assert.equal(stats.body.total, 201);
  });

  it('CSV 导出（默认掩码）与导入（含校验）', async () => {
    const exported = await request(server).get('/api/admin/licenses/export?productId=' + productId).set(auth());
    assert.equal(exported.status, 200);
    const csv = exported.text as string;
    assert.ok(csv.startsWith('\uFEFFid,product,plan,key,'), 'CSV 应带 BOM 且有表头');
    assert.ok(!csv.includes(licenseKey.replace(/-/g, '')), '默认导出不得包含明文授权码');

    const revealed = await request(server).get('/api/admin/licenses/export?productId=' + productId + '&reveal=true').set(auth());
    assert.ok((revealed.text as string).includes(licenseKey), 'reveal=true 时应包含明文');

    // C6 回归：?reveal=false 不得被当成 true（查询串布尔必须显式解析）
    const notRevealed = await request(server).get('/api/admin/licenses/export?productId=' + productId + '&reveal=false').set(auth());
    assert.equal(notRevealed.status, 200);
    assert.ok(!(notRevealed.text as string).includes(licenseKey), '?reveal=false 必须按掩码导出');

    const importCsv = [
      'product_slug,plan_code,customer_email,notes',
      'demo-app,pro-yearly,csv1@example.com,CSV 导入 1',
      'demo-app,pro-yearly,csv2@example.com,CSV 导入 2',
      'not-exist,pro-yearly,bad@example.com,产品不存在',
    ].join('\n');

    const dry = await request(server).post('/api/admin/licenses/import').set(auth()).send({ csv: importCsv, dryRun: true });
    assert.equal(dry.status, 201);
    assert.equal(dry.body.created, 2);
    assert.equal(dry.body.errors.length, 1);

    const real = await request(server).post('/api/admin/licenses/import').set(auth()).send({ csv: importCsv });
    assert.equal(real.body.created, 2);
    assert.equal(real.body.errors.length, 1);
    assert.ok(real.body.errors[0].message.includes('产品不存在'));
  });

  it('试用：同设备同产品只能领一次，并生成 14 天试用授权', async () => {
    const first = await request(server).post('/api/v1/trial').set(withKey())
      .send({ product: 'demo-app', device: deviceA, email: 'trial@example.com' });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.trial.days, 14);
    assert.equal(first.body.valid, true);
    assert.equal(first.body.entitlements.plan, 'trial-14');

    const second = await request(server).post('/api/v1/trial').set(withKey())
      .send({ product: 'demo-app', device: deviceA });
    assert.equal(second.status, 409);
    assert.equal(second.body.code, 'TRIAL_ALREADY_USED');

    const other = await request(server).post('/api/v1/trial').set(withKey())
      .send({ product: 'demo-app', device: { fingerprint: 'brand-new-device-9999' } });
    assert.equal(other.status, 201);
  });

  it('离线激活：请求码 → 后台响应码 → 客户端验签', async () => {
    const issued = await request(server).post('/api/admin/licenses').set(auth()).send({
      productId, planId: proPlanId, customerEmail: 'offline@example.com',
    });
    const offlineKey = issued.body.keyFormatted as string;
    const offlineLicenseId = issued.body.license.id as string;

    const req = await request(server).post('/api/v1/offline/request').set(withKey())
      .send({ licenseKey: offlineKey, product: 'demo-app', device: { fingerprint: 'air-gapped-machine-01', os: 'Windows 7' } });
    assert.equal(req.status, 201);
    const requestCode = req.body.requestCode as string;
    assert.ok(requestCode.includes('.'));

    const tampered = requestCode.slice(0, -2) + 'xx';
    const badResponse = await request(server).post('/api/admin/licenses/' + offlineLicenseId + '/offline-response')
      .set(auth()).send({ requestCode: tampered });
    assert.equal(badResponse.status, 400);
    assert.equal(badResponse.body.code, 'OFFLINE_CODE_INVALID');

    const response = await request(server).post('/api/admin/licenses/' + offlineLicenseId + '/offline-response')
      .set(auth()).send({ requestCode, offlineGraceDays: 14 });
    assert.equal(response.status, 201);
    assert.ok(response.body.responseCode);
    assert.equal(response.body.licenseFile.deviceFingerprint, 'air-gapped-machine-01');
    // 覆盖必须在签名前写入：否则客户端验签会失败（C7）
    assert.equal(response.body.licenseFile.offlineGraceDays, 14);

    const replay = await request(server).post('/api/admin/licenses/' + offlineLicenseId + '/offline-response')
      .set(auth()).send({ requestCode });
    assert.equal(replay.status, 400, '同一请求码不得重复签发');

    const activated = await request(server).post('/api/v1/offline/activate').set(withKey())
      .send({ requestCode, responseCode: response.body.responseCode });
    assert.equal(activated.status, 201);
    assert.equal(activated.body.verified, true);

    const forged = Buffer.from(JSON.stringify({ ...response.body.licenseFile, maxDevices: 99 }), 'utf8').toString('base64url');
    const forgedResult = await request(server).post('/api/v1/offline/activate').set(withKey())
      .send({ requestCode, responseCode: forged });
    assert.equal(forgedResult.status, 400, '伪造的响应码必须被拒绝');
  });

  it('设备封禁后无法再激活，并解绑其已有设备', async () => {
    const activations = await request(server).get('/api/admin/activations?status=active').set(auth());
    assert.equal(activations.status, 200);
    const target = activations.body.items[0] as { id: string; deviceId: string };
    assert.ok(target, '应至少有一条激活记录');

    const blacklist = await request(server).post('/api/admin/devices/' + target.deviceId + '/blacklist')
      .set(auth()).send({ blacklisted: true, reason: '共享账号' });
    assert.equal(blacklist.status, 201);

    const blocked = await request(server).post('/api/v1/activate').set(withKey())
      .send({ licenseKey, device: deviceA });
    assert.ok([403, 409, 410].includes(blocked.status));
  });
});