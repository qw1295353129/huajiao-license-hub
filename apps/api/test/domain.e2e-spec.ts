import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { TEST_ADMIN } from './env';
import { closeTestApp, createTestApp, type TestContext } from './utils/test-app';

describe('域名授权（e2e）', () => {
  let ctx: TestContext;
  let server: never;
  let adminToken = '';
  let apiKey = '';
  let portalToken = '';
  let productId = '';
  let domainPlanId = '';
  let deviceOnlyPlanId = '';
  let licenseId = '';
  let licenseKey = '';

  const admin = () => ({ Authorization: 'Bearer ' + adminToken });
  const withKey = () => ({ 'X-Api-Key': apiKey });

  before(async () => {
    ctx = await createTestApp();
    server = ctx.server as never;
    const login = await request(server).post('/api/admin/auth/login').send(TEST_ADMIN);
    adminToken = login.body.tokens.accessToken;

    const product = await request(server).post('/api/admin/products').set(admin())
      .send({ slug: 'web-app', name: '网站应用', status: 'active' });
    productId = product.body.id;

    const domainPlan = await request(server).post('/api/admin/products/' + productId + '/plans').set(admin())
      .send({ code: 'site-yearly', name: '站点版 · 年付', licenseType: 'subscription', durationDays: 365, maxDomains: 2, allowSubdomains: true });
    domainPlanId = domainPlan.body.id;
    assert.equal(domainPlan.status, 201, JSON.stringify(domainPlan.body));
    assert.equal(domainPlan.body.maxDomains, 2);

    const devicePlan = await request(server).post('/api/admin/products/' + productId + '/plans').set(admin())
      .send({ code: 'device-only', name: '仅设备版', licenseType: 'subscription', durationDays: 365, maxDevices: 1 });
    deviceOnlyPlanId = devicePlan.body.id;
    assert.equal(devicePlan.body.maxDomains, 0, '未指定时域名授权应默认关闭');

    const key = await request(server).post('/api/admin/api-keys').set(admin())
      .send({ name: '域名测试 Key', scopes: ['license:read', 'license:activate', 'license:verify', 'license:deactivate'] });
    apiKey = key.body.key;
  });

  after(async () => {
    await closeTestApp(ctx);
  });

  it('发放支持域名的授权，域名额度随策略带出', async () => {
    const res = await request(server).post('/api/admin/licenses').set(admin())
      .send({ productId, planId: domainPlanId, customerEmail: 'webmaster@example.com' });
    assert.equal(res.status, 201);
    licenseId = res.body.license.id;
    licenseKey = res.body.keyFormatted;
    assert.equal(res.body.license.maxDomains, 2);
    assert.equal(res.body.license.domainCount, 0);
    assert.equal(res.body.license.allowSubdomains, true);
  });

  it('域名激活：自动归一化（协议/端口/路径/大小写/www）', async () => {
    const res = await request(server).post('/api/v1/activate-domain').set(withKey())
      .send({ licenseKey, product: 'web-app', domain: 'HTTPS://WWW.Shop.Example.com:8443/admin/login' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.valid, true);
    assert.equal(res.body.domain, 'shop.example.com');
    assert.equal(res.body.entitlements.domainCount, 1);
    assert.equal(res.body.entitlements.maxDomains, 2);
    assert.equal(res.body.licenseFile.domain, 'shop.example.com');
    assert.equal(res.body.licenseFile.maxDomains, 2);
    assert.ok(res.body.accessToken);
  });

  it('同一域名的不同写法重复激活是幂等的，不占额外额度', async () => {
    const res = await request(server).post('/api/v1/activate-domain').set(withKey())
      .send({ licenseKey, domain: 'shop.example.com' });
    assert.equal(res.status, 201);
    assert.equal(res.body.reactivated, true);
    assert.equal(res.body.entitlements.domainCount, 1, '重复激活不得占用第二个额度');
  });

  it('域名心跳：已绑定域名有效，子域按 allowSubdomains 覆盖', async () => {
    const exact = await request(server).post('/api/v1/verify-domain').set(withKey())
      .send({ licenseKey, domain: 'https://shop.example.com/' });
    assert.equal(exact.status, 201);
    assert.equal(exact.body.valid, true);
    assert.equal(exact.body.domainCount, 1);

    const sub = await request(server).post('/api/v1/verify-domain').set(withKey())
      .send({ licenseKey, domain: 'new.shop.example.com' });
    assert.equal(sub.body.valid, true, '子域应被覆盖');
    assert.equal(sub.body.domain, 'new.shop.example.com');

    const other = await request(server).post('/api/v1/verify-domain').set(withKey())
      .send({ licenseKey, domain: 'evil-example.com' });
    assert.equal(other.status, 201);
    assert.equal(other.body.valid, false);
    assert.equal(other.body.reason, 'invalid_device');
  });

  it('域名额度用满后拒绝新域名', async () => {
    const second = await request(server).post('/api/v1/activate-domain').set(withKey())
      .send({ licenseKey, domain: 'blog.example.com' });
    assert.equal(second.status, 201);
    assert.equal(second.body.entitlements.domainCount, 2);

    const third = await request(server).post('/api/v1/activate-domain').set(withKey())
      .send({ licenseKey, domain: 'third.example.com' });
    assert.equal(third.status, 409);
    assert.equal(third.body.code, 'DOMAIN_LIMIT_REACHED');
    assert.equal(third.body.details.maxDomains, 2);
  });

  it('未开启域名授权的策略会明确拒绝', async () => {
    const license = await request(server).post('/api/admin/licenses').set(admin())
      .send({ productId, planId: deviceOnlyPlanId });
    const res = await request(server).post('/api/v1/activate-domain').set(withKey())
      .send({ licenseKey: license.body.keyFormatted, domain: 'nope.example.com' });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'DOMAIN_NOT_ALLOWED');
  });

  it('非法域名与单标签域名被拒绝', async () => {
    const bad = ['not a domain', 'example', 'a..b.com', 'https://'];
    for (const domain of bad) {
      const res = await request(server).post('/api/v1/activate-domain').set(withKey())
        .send({ licenseKey, domain });
      assert.equal(res.status, 400, '域名 ' + domain + ' 应被拒绝，实际 ' + res.status);
    }
  });

  it('解绑后额度释放，可绑定新域名', async () => {
    const off = await request(server).post('/api/v1/deactivate-domain').set(withKey())
      .send({ licenseKey, domain: 'blog.example.com', reason: '换域名' });
    assert.equal(off.status, 201);
    assert.equal(off.body.domainCount, 1);

    const again = await request(server).post('/api/v1/deactivate-domain').set(withKey())
      .send({ licenseKey, domain: 'blog.example.com' });
    assert.equal(again.status, 404);
    assert.equal(again.body.code, 'DOMAIN_NOT_BOUND');

    const fresh = await request(server).post('/api/v1/activate-domain').set(withKey())
      .send({ licenseKey, domain: 'new-site.example.com' });
    assert.equal(fresh.status, 201, '释放额度后应能绑定新域名');
    assert.equal(fresh.body.entitlements.domainCount, 2);
  });

  it('管理端可查看域名列表、强制解绑与清空', async () => {
    const list = await request(server).get('/api/admin/licenses/' + licenseId + '/domains').set(admin());
    assert.equal(list.status, 200);
    const rows = list.body as Array<{ id: string; domain: string; status: string }>;
    const active = rows.filter((row) => row.status === 'active');
    assert.equal(active.length, 2, JSON.stringify(rows));
    assert.ok(active.some((row) => row.domain === 'shop.example.com'));

    const unbind = await request(server).delete('/api/admin/domains/' + active[0].id).set(admin()).send({ reason: '客服代操作' });
    assert.equal(unbind.status, 200);
    assert.equal(unbind.body.domainCount, 1);

    const reset = await request(server).post('/api/admin/licenses/' + licenseId + '/reset-domains').set(admin()).send({});
    assert.equal(reset.status, 201);
    assert.equal(reset.body.released, 1);

    const detail = await request(server).get('/api/admin/licenses/' + licenseId).set(admin());
    assert.equal(detail.body.domainCount, 0);
    const types = (detail.body.events as Array<{ type: string }>).map((event) => event.type);
    assert.ok(types.includes('domain_activated'));
    assert.ok(types.includes('domain_deactivated'));
    assert.ok(types.includes('domains_reset'));
  });

  it('客户门户：可见已绑定域名并自助解绑，越权返回 404', async () => {
    const register = await request(server).post('/api/portal/auth/register')
      .send({ email: 'webmaster@example.com', password: 'Webmaster123', name: '站长' });
    assert.equal(register.status, 201);
    portalToken = register.body.tokens.accessToken;

    await request(server).post('/api/v1/activate-domain').set(withKey())
      .send({ licenseKey, domain: 'portal.example.com' });

    const auth = { Authorization: 'Bearer ' + portalToken };
    const detail = await request(server).get('/api/portal/licenses/' + licenseId).set(auth);
    assert.equal(detail.status, 200, JSON.stringify(detail.body));
    assert.equal(detail.body.maxDomains, 2);
    const domains = detail.body.domains as Array<{ id: string; domain: string; status: string }>;
    const bound = domains.find((row) => row.status === 'active');
    assert.ok(bound, '门户应能看到已绑定域名');

    const off = await request(server).delete('/api/portal/licenses/' + licenseId + '/domains/' + bound.id).set(auth);
    assert.equal(off.status, 200);
    assert.equal(off.body.domainCount, 0);

    const otherLicense = await request(server).post('/api/admin/licenses').set(admin())
      .send({ productId, planId: domainPlanId, customerEmail: 'other@example.com' });
    const foreign = await request(server).delete('/api/portal/licenses/' + otherLicense.body.license.id + '/domains/' + bound.id).set(auth);
    assert.equal(foreign.status, 404);
  });

  it('域名事件会推送到 Webhook', async () => {
    const hook = await request(server).post('/api/admin/webhooks').set(admin())
      .send({ url: 'http://127.0.0.1:9/never', events: ['domain.bound', 'domain.unbound'] });
    assert.equal(hook.status, 201);

    const before = await request(server).get('/api/admin/webhooks/deliveries?pageSize=50').set(admin());
    await request(server).post('/api/v1/activate-domain').set(withKey())
      .send({ licenseKey, domain: 'hook.example.com' });
    const after = await request(server).get('/api/admin/webhooks/deliveries?pageSize=50').set(admin());
    assert.ok(after.body.total > before.body.total, '域名绑定应产生投递记录');
    const events = (after.body.items as Array<{ event: string }>).map((row) => row.event);
    assert.ok(events.includes('domain.bound'), events.join(','));
  });

  it('域名授权与设备授权可同时用于同一张授权', async () => {
    const both = await request(server).post('/api/admin/licenses').set(admin())
      .send({ productId, planId: domainPlanId, customerEmail: 'both@example.com', maxDevices: 1 });
    const key = both.body.keyFormatted as string;

    const device = await request(server).post('/api/v1/activate').set(withKey())
      .send({ licenseKey: key, device: { fingerprint: 'domain-and-device-0001', os: 'Linux' } });
    assert.equal(device.status, 201);

    const domain = await request(server).post('/api/v1/activate-domain').set(withKey())
      .send({ licenseKey: key, domain: 'hybrid.example.com' });
    assert.equal(domain.status, 201);
    assert.equal(domain.body.entitlements.domainCount, 1);
    assert.equal(domain.body.entitlements.activeDevices, 0, '域名激活不应占用设备额度');
  });
});

