import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, verify as cryptoVerify } from 'node:crypto';
import request from 'supertest';
import type { DomainLicenseFile } from '@license-hub/shared';
import { canonicalJsonLikeServer } from './utils/signature';
import { TEST_ADMIN } from './env';
import { closeTestApp, createTestApp, type TestContext } from './utils/test-app';

describe('域名授权（独立体系，不依赖授权码）e2e', () => {
  let ctx: TestContext;
  let server: never;
  let adminToken = '';
  let apiKey = '';
  let portalToken = '';
  let productId = '';
  let planId = '';
  let domainLicenseId = '';
  let publicKey = '';
  let firstDomainId = '';

  const admin = () => ({ Authorization: 'Bearer ' + adminToken });
  const withKey = () => ({ 'X-Api-Key': apiKey });

  before(async () => {
    ctx = await createTestApp();
    server = ctx.server as never;
    const login = await request(server).post('/api/admin/auth/login').send(TEST_ADMIN);
    adminToken = login.body.tokens.accessToken;

    const product = await request(server).post('/api/admin/products').set(admin())
      .send({ slug: 'site-product', name: '网站系统', status: 'active' });
    productId = product.body.id;

    const plan = await request(server).post('/api/admin/products/' + productId + '/plans').set(admin())
      .send({
        code: 'site-yearly', name: '站点版 · 年付', licenseType: 'subscription', durationDays: 365,
        maxDevices: 0, maxDomains: 2, allowSubdomains: true, featureKeys: ['pro-mode'], priceCents: 29900,
      });
    assert.equal(plan.status, 201, JSON.stringify(plan.body));
    planId = plan.body.id;
    assert.equal(plan.body.maxDomains, 2, '套餐应带独立的域名额度');
    assert.equal(plan.body.maxDevices, 0);

    const key = await request(server).post('/api/admin/api-keys').set(admin())
      .send({ name: '网站接入 Key', scopes: ['license:read', 'license:activate', 'license:verify', 'license:deactivate'] });
    apiKey = key.body.key;
  });

  after(async () => {
    await closeTestApp(ctx);
  });

  it('直接给域名发授权（不需要授权码）', async () => {
    const res = await request(server).post('/api/admin/domain-licenses').set(admin()).send({
      productId, planId, customerEmail: 'webmaster@example.com',
      domains: ['HTTPS://WWW.Shop.Example.com:8443/admin', 'blog.example.com'],
      notes: '两站打包',
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    domainLicenseId = res.body.license.id;
    assert.equal(res.body.addedDomains.length, 2);
    assert.deepEqual(res.body.addedDomains.sort(), ['blog.example.com', 'shop.example.com']);
    assert.equal(res.body.license.maxDomains, 2);
    assert.equal(res.body.license.domainCount, 2);
    assert.equal(res.body.license.status, 'active');
    assert.ok(!JSON.stringify(res.body).includes('licenseKey'), '域名授权不应产生授权码');
  });

  it('网站只需提供域名即可激活，并拿到可验签的授权文件', async () => {
    const pk = await request(server).get('/api/v1/domain/public-key').set(withKey());
    assert.equal(pk.status, 200);
    publicKey = pk.body.current.publicKey;

    const res = await request(server).post('/api/v1/domain/activate').set(withKey())
      .send({ domain: 'shop.example.com', product: 'site-product' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.valid, true);
    assert.equal(res.body.domain, 'shop.example.com');
    assert.equal(res.body.entitlements.domainLicenseId, domainLicenseId);
    assert.equal(res.body.entitlements.maxDomains, 2);

    const file = res.body.licenseFile as DomainLicenseFile;
    assert.equal(file.type, 'domain');
    assert.equal(file.domain, 'shop.example.com');
    assert.equal(file.customer, 'webmaster@example.com');
    const { sig, ...payload } = file;
    const key = createPublicKey({ key: Buffer.from(publicKey, 'base64url'), format: 'der', type: 'spki' });
    assert.equal(cryptoVerify(null, Buffer.from(canonicalJsonLikeServer(payload), 'utf8'), key, Buffer.from(sig, 'base64url')), true);
    const tampered = { ...payload, allowSubdomains: false };
    assert.equal(cryptoVerify(null, Buffer.from(canonicalJsonLikeServer(tampered), 'utf8'), key, Buffer.from(sig, 'base64url')), false);
  });

  it('心跳校验：精确域名有效、子域被覆盖、未授权域名被拒绝', async () => {
    const exact = await request(server).post('/api/v1/domain/verify').set(withKey()).send({ domain: 'shop.example.com' });
    assert.equal(exact.status, 201);
    assert.equal(exact.body.valid, true);

    const sub = await request(server).post('/api/v1/domain/verify').set(withKey()).send({ domain: 'new.shop.example.com' });
    assert.equal(sub.body.valid, true, 'allowSubdomains 时应覆盖子域');

    const unknown = await request(server).post('/api/v1/domain/verify').set(withKey()).send({ domain: 'nobody.example.com' });
    assert.equal(unknown.body.valid, false);
    assert.equal(unknown.body.reason, 'invalid_not_found');
  });

  it('未授权域名激活返回 404 且提示明确', async () => {
    const res = await request(server).post('/api/v1/domain/activate').set(withKey())
      .send({ domain: 'never-authorized.com' });
    assert.equal(res.status, 404);
    assert.equal(res.body.code, 'DOMAIN_NOT_AUTHORIZED');
  });

  it('额度控制：用满后拒绝，解绑后释放', async () => {
    const first = await request(server).get('/api/admin/domain-licenses/' + domainLicenseId).set(admin());
    const active = (first.body.domains as Array<{ id: string; domain: string; status: string }>).filter((row) => row.status === 'active');
    assert.equal(active.length, 2);
    firstDomainId = active[0].id;

    const over = await request(server).post('/api/admin/domain-licenses/' + domainLicenseId + '/domains').set(admin())
      .send({ domain: 'third.example.com' });
    assert.equal(over.status, 409);
    assert.equal(over.body.code, 'DOMAIN_LIMIT_REACHED');

    const off = await request(server).delete('/api/admin/domain-licenses/domains/' + firstDomainId).set(admin()).send({});
    assert.equal(off.status, 200);
    assert.equal(off.body.domainCount, 1);

    const added = await request(server).post('/api/admin/domain-licenses/' + domainLicenseId + '/domains').set(admin())
      .send({ domain: 'third.example.com' });
    assert.equal(added.status, 201, '释放额度后应能绑定新域名');
    assert.equal(added.body.domainCount, 2);
  });

  it('同一域名不能被两张授权同时占用；非法域名被拒绝', async () => {
    const dup = await request(server).post('/api/admin/domain-licenses/' + domainLicenseId + '/domains').set(admin())
      .send({ domain: 'https://www.third.example.com/' });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.code, 'DOMAIN_ALREADY_AUTHORIZED');

    const other = await request(server).post('/api/admin/domain-licenses').set(admin())
      .send({ productId, planId, domains: ['other-site.example.com'] });
    const conflict = await request(server).post('/api/admin/domain-licenses/' + other.body.license.id + '/domains').set(admin())
      .send({ domain: 'third.example.com' });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.code, 'DOMAIN_ALREADY_AUTHORIZED');

    for (const bad of ['not a domain', 'example', 'https://']) {
      const res = await request(server).post('/api/admin/domain-licenses/' + other.body.license.id + '/domains').set(admin())
        .send({ domain: bad });
      assert.equal(res.status, 400, '域名 ' + bad + ' 应被拒绝');
    }
  });

  it('暂停 / 恢复 / 吊销会立即影响网站校验', async () => {
    // 前面的额度测试可能解绑过域名，这里取「当前实际绑定」的域名，保证断言与状态一致
    const snapshot = await request(server).get('/api/admin/domain-licenses/' + domainLicenseId).set(admin());
    const activeRows = (snapshot.body.domains as Array<{ domain: string; status: string }>).filter((row) => row.status === 'active');
    assert.ok(activeRows.length > 0, '应至少有一个已授权域名');
    const target = activeRows[0].domain;

    const suspend = await request(server).post('/api/admin/domain-licenses/' + domainLicenseId + '/suspend').set(admin())
      .send({ reason: '欠费' });
    assert.equal(suspend.status, 201);
    const suspended = await request(server).post('/api/v1/domain/verify').set(withKey()).send({ domain: target });
    assert.equal(suspended.body.valid, false);
    assert.equal(suspended.body.reason, 'invalid_suspended');
    const blockedActivate = await request(server).post('/api/v1/domain/activate').set(withKey()).send({ domain: target });
    assert.equal(blockedActivate.status, 410);

    const resume = await request(server).post('/api/admin/domain-licenses/' + domainLicenseId + '/resume').set(admin()).send({});
    assert.equal(resume.status, 201);
    const ok = await request(server).post('/api/v1/domain/verify').set(withKey()).send({ domain: target });
    assert.equal(ok.body.valid, true);

    const revoke = await request(server).post('/api/admin/domain-licenses/' + domainLicenseId + '/revoke').set(admin())
      .send({ reason: '退款' });
    assert.equal(revoke.status, 201);
    const revoked = await request(server).post('/api/v1/domain/verify').set(withKey()).send({ domain: target });
    assert.equal(revoked.body.reason, 'invalid_revoked');
    await request(server).post('/api/admin/domain-licenses/' + domainLicenseId + '/resume').set(admin()).send({});
  });

  it('延期与事件流', async () => {
    const extend = await request(server).post('/api/admin/domain-licenses/' + domainLicenseId + '/extend').set(admin())
      .send({ days: 30, reason: '续费' });
    assert.equal(extend.status, 201);
    assert.ok(new Date(extend.body.expiresAt).getTime() > Date.now());

    const detail = await request(server).get('/api/admin/domain-licenses/' + domainLicenseId).set(admin());
    const types = (detail.body.events as Array<{ type: string }>).map((row) => row.type);
    for (const expected of ['created', 'domain_added', 'domain_removed', 'suspended', 'resumed', 'revoked', 'extended']) {
      assert.ok(types.includes(expected), '事件流应包含 ' + expected + '，实际：' + types.join(','));
    }
    const domainEvents = (detail.body.events as Array<{ domain: string | null }>).filter((row) => row.domain);
    assert.ok(domainEvents.length > 0, '事件应记录具体域名');
  });

  it('客户门户：可见自己的域名授权，并在额度内自助增删域名', async () => {
    const register = await request(server).post('/api/portal/auth/register')
      .send({ email: 'webmaster@example.com', password: 'Webmaster123', name: '站长' });
    assert.equal(register.status, 201);
    portalToken = register.body.tokens.accessToken;
    const auth = { Authorization: 'Bearer ' + portalToken };

    // 额度已满（2/2），先解绑一个
    const mine = await request(server).get('/api/portal/domain-licenses').set(auth);
    assert.equal(mine.status, 200, JSON.stringify(mine.body));
    assert.equal(mine.body.length, 1);
    const item = mine.body[0] as { id: string; domains: Array<{ id: string; domain: string; status: string }> };
    assert.equal(item.id, domainLicenseId);
    const bound = item.domains.filter((row) => row.status === 'active');
    assert.equal(bound.length, 2);

    const removed = await request(server).delete('/api/portal/domain-licenses/domains/' + bound[0].id).set(auth);
    assert.equal(removed.status, 200);
    assert.equal(removed.body.domainCount, 1);

    const added = await request(server).post('/api/portal/domain-licenses/' + domainLicenseId + '/domains').set(auth)
      .send({ domain: 'my-new-site.cn' });
    assert.equal(added.status, 201, JSON.stringify(added.body));
    assert.equal(added.body.domain, 'my-new-site.cn');
    assert.equal(added.body.domainCount, 2);

    // 越权：别人看不到也改不了
    const other = await request(server).post('/api/portal/auth/register')
      .send({ email: 'stranger@example.com', password: 'Stranger123' });
    const strangerAuth = { Authorization: 'Bearer ' + other.body.tokens.accessToken };
    const strangerList = await request(server).get('/api/portal/domain-licenses').set(strangerAuth);
    assert.equal(strangerList.body.length, 0);
    const strangerAdd = await request(server).post('/api/portal/domain-licenses/' + domainLicenseId + '/domains').set(strangerAuth)
      .send({ domain: 'stolen.com' });
    assert.equal(strangerAdd.status, 404);
  });

  it('域名事件推送到 Webhook', async () => {
    const hook = await request(server).post('/api/admin/webhooks').set(admin())
      .send({ url: 'http://127.0.0.1:9/never', events: ['domain.bound', 'domain.unbound'] });
    assert.equal(hook.status, 201);
    const fresh = await request(server).post('/api/admin/domain-licenses').set(admin())
      .send({ productId, planId, customerEmail: 'hook@example.com' });
    assert.equal(fresh.status, 201, JSON.stringify(fresh.body));

    const before = await request(server).get('/api/admin/webhooks/deliveries?pageSize=50').set(admin());
    const bound = await request(server).post('/api/admin/domain-licenses/' + fresh.body.license.id + '/domains').set(admin())
      .send({ domain: 'hook-site.example.com' });
    assert.equal(bound.status, 201, '新授权应有可用额度');
    const after = await request(server).get('/api/admin/webhooks/deliveries?pageSize=50').set(admin());
    const events = (after.body.items as Array<{ event: string }>).map((row) => row.event);
    assert.ok(after.body.total > before.body.total || events.includes('domain.bound'), '应有域名事件投递：' + events.join(','));
  });

  it('到期任务会把域名授权置为 expired', async () => {
    const soon = await request(server).post('/api/admin/domain-licenses').set(admin())
      .send({ productId, planId, customerEmail: 'expire@example.com', domains: ['expiring.example.com'] });
    const id = soon.body.license.id as string;
    await request(server).patch('/api/admin/domain-licenses/' + id).set(admin())
      .send({ expiresAt: new Date(Date.now() - 86_400_000).toISOString() });

    const run = await request(server).post('/api/admin/tasks/run').set(admin()).send({ task: 'expire-licenses' });
    assert.equal(run.status, 201);
    assert.ok(run.body.detail.expiredDomainLicenses >= 1, JSON.stringify(run.body.detail));

    const detail = await request(server).get('/api/admin/domain-licenses/' + id).set(admin());
    assert.equal(detail.body.status, 'expired');

    const verifyExpired = await request(server).post('/api/v1/domain/verify').set(withKey()).send({ domain: 'expiring.example.com' });
    assert.equal(verifyExpired.body.valid, false);
    assert.equal(verifyExpired.body.reason, 'invalid_expired');
  });

  it('授权码与域名授权彻底分离：授权码列表不含任何域名字段', async () => {
    const licenses = await request(server).get('/api/admin/licenses').set(admin());
    assert.equal(licenses.status, 200);
    const body = JSON.stringify(licenses.body);
    for (const field of ['maxDomains', 'allowSubdomains', 'domainCount', 'domains']) {
      assert.ok(!body.includes(field), '授权码列表不应出现域名字段：' + field);
    }

    const domainStats = await request(server).get('/api/admin/domain-licenses/stats').set(admin());
    assert.equal(domainStats.status, 200);
    assert.equal(typeof domainStats.body.activeDomains, 'number');
  });

  it('删除域名授权：连带释放域名、可再次授权、写审计快照', async () => {
    const created = await request(server).post('/api/admin/domain-licenses').set(admin())
      .send({ productId, planId, customerEmail: 'delete-me@example.com', domains: ['delete-me.example.com'] });
    assert.equal(created.status, 201);
    const id = created.body.license.id as string;

    const del = await request(server).delete('/api/admin/domain-licenses/' + id).set(admin());
    assert.equal(del.status, 200, JSON.stringify(del.body));
    assert.deepEqual(del.body.releasedDomains, ['delete-me.example.com']);

    const gone = await request(server).get('/api/admin/domain-licenses/' + id).set(admin());
    assert.equal(gone.status, 404, '删除后应查不到');

    const reuse = await request(server).post('/api/admin/domain-licenses').set(admin())
      .send({ productId, planId, customerEmail: 'new-owner@example.com', domains: ['delete-me.example.com'] });
    assert.equal(reuse.body.addedDomains.length, 1, '释放后的域名应可再次授权');

    const audit = await request(server).get('/api/admin/audit-logs?action=domain_license.delete').set(admin());
    const rows = audit.body.items as Array<{ diff?: { before?: { releasedDomains?: string[] } } }>;
    const entry = rows.find((row) => (row.diff?.before?.releasedDomains ?? []).length > 0);
    assert.ok(entry, '审计应记录被释放的域名快照');
  });
});
