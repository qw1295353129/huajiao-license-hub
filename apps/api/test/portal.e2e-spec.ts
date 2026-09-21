import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { maskLicenseKey } from '@license-hub/shared';
import { TEST_ADMIN } from './env';
import { closeTestApp, createTestApp, type TestContext } from './utils/test-app';

describe('客户门户 / 订单 / 卡密（e2e）', () => {
  let ctx: TestContext;
  let server: never;
  let adminToken = '';
  let productId = '';
  let planId = '';
  let customerToken = '';
  let customerId = '';
  const CUSTOMER = { email: 'buyer@example.com', password: 'Buyer12345' };

  const admin = () => ({ Authorization: 'Bearer ' + adminToken });
  const portal = () => ({ Authorization: 'Bearer ' + customerToken });

  before(async () => {
    ctx = await createTestApp();
    server = ctx.server as never;
    const login = await request(server).post('/api/admin/auth/login').send(TEST_ADMIN);
    adminToken = login.body.tokens.accessToken;

    const product = await request(server).post('/api/admin/products').set(admin())
      .send({ slug: 'portal-app', name: '门户测试产品', status: 'active' });
    productId = product.body.id;
    const plan = await request(server).post('/api/admin/products/' + productId + '/plans').set(admin())
      .send({ code: 'yearly', name: '年付', licenseType: 'subscription', durationDays: 365, maxDevices: 1, priceCents: 9900 });
    planId = plan.body.id;
  });

  after(async () => {
    await closeTestApp(ctx);
  });

  it('客户注册：创建账号并返回门户令牌', async () => {
    const res = await request(server).post('/api/portal/auth/register').send(CUSTOMER);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.user.email, CUSTOMER.email);
    assert.ok(res.body.tokens.accessToken);
    customerId = res.body.user.id;
    customerToken = res.body.tokens.accessToken;

    const dup = await request(server).post('/api/portal/auth/register').send(CUSTOMER);
    assert.equal(dup.status, 409);
  });

  it('注册成功会写入邮件日志（未配置 SMTP 时只记录不发送）', async () => {
    const res = await request(server).get('/api/admin/settings').set(admin());
    assert.equal(res.status, 200);
    assert.equal(res.body.siteName.length > 0, true);
    // 邮件日志通过数据库直接断言更稳（没有对外接口时）
    const { DB } = await import('../src/db/db.module');
    const { emailLogs } = await import('../src/db/schema');
    const handle = ctx.app.get(DB) as { db: { select: () => { from: (t: unknown) => Promise<unknown[]> } } };
    const rows = (await handle.db.select().from(emailLogs)) as { to: string; template: string; status: string }[];
    assert.ok(rows.some((row) => row.to === CUSTOMER.email && row.template === 'welcome'));
  });

  it('门户登录 + 我 的授权为空', async () => {
    const login = await request(server).post('/api/portal/auth/login').send(CUSTOMER);
    assert.equal(login.status, 201);
    customerToken = login.body.tokens.accessToken;

    const me = await request(server).get('/api/portal/me').set(portal());
    assert.equal(me.status, 200);
    assert.equal(me.body.licenseCount, 0);

    const list = await request(server).get('/api/portal/licenses').set(portal());
    assert.equal(list.status, 200);
    assert.equal(list.body.total, 0);
  });

  it('管理端令牌不能访问门户接口，反之亦然（受众隔离）', async () => {
    const adminOnPortal = await request(server).get('/api/portal/me').set(admin());
    assert.equal(adminOnPortal.status, 403);
    const customerOnAdmin = await request(server).get('/api/admin/licenses').set(portal());
    assert.equal(customerOnAdmin.status, 403);
  });

  it('订单：建单 + 优惠券折扣 + 标记支付自动发码 + 幂等', async () => {
    const coupon = await request(server).post('/api/admin/coupons').set(admin())
      .send({ code: 'SAVE10', type: 'percent', value: 10, maxUses: 5 });
    assert.equal(coupon.status, 201);

    const order = await request(server).post('/api/admin/orders').set(admin()).send({
      email: CUSTOMER.email, items: [{ productId, planId, quantity: 2 }], couponCode: 'SAVE10',
    });
    assert.equal(order.status, 201, JSON.stringify(order.body));
    assert.equal(order.body.subtotalCents, 19800);
    assert.equal(order.body.discountCents, 1980);
    assert.equal(order.body.totalCents, 17820);
    assert.equal(order.body.status, 'pending');

    const paid = await request(server).post('/api/admin/orders/' + order.body.id + '/mark-paid').set(admin()).send({});
    assert.equal(paid.status, 201);
    assert.equal(paid.body.licenses.length, 2);
    assert.equal(paid.body.order.status, 'paid');
    assert.equal(paid.body.alreadyPaid, false);

    // 重复标记：不得重复发码
    const again = await request(server).post('/api/admin/orders/' + order.body.id + '/mark-paid').set(admin()).send({});
    assert.equal(again.body.alreadyPaid, true);
    assert.equal(again.body.licenses.length, 0, '幂等：已支付订单不得重复发码');

    const stats = await request(server).get('/api/admin/orders/stats').set(admin());
    assert.equal(stats.body.paid, 1);
    assert.equal(stats.body.revenueCents, 17820);

    // 发码后授权归属到该客户，门户可见
    const mine = await request(server).get('/api/portal/licenses').set(portal());
    assert.equal(mine.body.total, 2);
    assert.equal(mine.body.items[0].productName, '门户测试产品');
  });

  it('支付回调：签名校验 + 事件去重 + 自动发码', async () => {
    const secret = 'test-callback-secret-123456';
    const saveSecret = await request(server).post('/api/admin/settings/secrets').set(admin())
      .send({ key: 'payments.generic.secret', value: secret });
    assert.equal(saveSecret.status, 201);
    assert.ok(saveSecret.body.masked.includes('****'));

    const order = await request(server).post('/api/admin/orders').set(admin()).send({
      email: 'callback@example.com', items: [{ productId, planId, quantity: 1 }], provider: 'generic',
    });
    assert.equal(order.status, 201, JSON.stringify(order.body));
    assert.equal(order.body.provider, 'generic');
    const orderNo = order.body.orderNo as string;

    const payload = { eventId: 'evt-001', orderNo, status: 'paid', providerRef: 'tx-001' };
    const raw = JSON.stringify(payload);
    const badSig = await request(server).post('/api/payments/generic/callback')
      .set({ 'X-LH-Signature': 'sha256=deadbeef', 'Content-Type': 'application/json' })
      .send(raw);
    assert.equal(badSig.status, 401);

    const signature = createHmac('sha256', secret).update(raw).digest('hex');
    const ok = await request(server).post('/api/payments/generic/callback')
      .set({ 'X-LH-Signature': 'sha256=' + signature, 'Content-Type': 'application/json' })
      .send(raw);
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.licenses.length, 1);

    // 同一 eventId 重放：视为重复，不再发码
    const replay = await request(server).post('/api/payments/generic/callback')
      .set({ 'X-LH-Signature': 'sha256=' + signature, 'Content-Type': 'application/json' })
      .send(raw);
    assert.equal(replay.status, 201);
    assert.equal(replay.body.duplicate, true);

    const detail = await request(server).get('/api/admin/orders/' + order.body.id).set(admin());
    assert.equal(detail.body.status, 'paid');
    assert.equal(detail.body.items[0].licenseId !== null, true);
  });

  it('退款：订单转已退款并吊销关联授权', async () => {
    const order = await request(server).post('/api/admin/orders').set(admin()).send({
      email: 'refund@example.com', items: [{ productId, planId, quantity: 1 }], markPaid: true,
    });
    assert.equal(order.body.status, 'paid');
    const licenseId = order.body.items[0].licenseId as string;

    const refund = await request(server).post('/api/admin/orders/' + order.body.id + '/refund').set(admin())
      .send({ reason: '买家申请退款' });
    assert.equal(refund.status, 201);
    assert.equal(refund.body.status, 'refunded');
    assert.equal(refund.body.revokedLicenses, 1);

    const license = await request(server).get('/api/admin/licenses/' + licenseId).set(admin());
    assert.equal(license.body.status, 'revoked');
  });

  it('卡密：生成批次 → 兑换 → 重复兑换被拒 → 作废', async () => {
    const batch = await request(server).post('/api/admin/redeem/batches').set(admin()).send({
      name: '淘宝批次', productId, planId, quantity: 3, channel: 'taobao',
    });
    assert.equal(batch.status, 201);
    assert.equal(batch.body.codes.length, 3);
    const code = batch.body.codes[0] as string;
    const secondCode = batch.body.codes[1] as string;

    const redeemed = await request(server).post('/api/portal/redeem').set(portal()).send({ code });
    assert.equal(redeemed.status, 201, JSON.stringify(redeemed.body));
    assert.ok(redeemed.body.licenseKey);
    assert.equal(redeemed.body.license.customerEmail, CUSTOMER.email);

    const again = await request(server).post('/api/portal/redeem').set(portal()).send({ code });
    assert.equal(again.status, 409);
    assert.equal(again.body.code, 'REDEEM_CODE_USED');

    const unknown = await request(server).post('/api/portal/redeem').set(portal()).send({ code: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ' });
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.code, 'REDEEM_CODE_INVALID');

    const codes = await request(server).get('/api/admin/redeem/codes?batchId=' + batch.body.batch.id).set(admin());
    assert.equal(codes.body.total, 3);
    const items = codes.body.items as { id: string; status: string; codeMasked: string }[];
    assert.equal(items.filter((item) => item.status === 'used').length, 1);

    // 精确作废第三张（按掩码定位，避免依赖列表顺序）
    const third = batch.body.codes[2] as string;
    const thirdMasked = maskLicenseKey(third.replace(/-/g, ''));
    const target = items.find((item) => item.codeMasked === thirdMasked);
    assert.ok(target, '应能通过掩码定位到第三张卡密');
    const voided = await request(server).post('/api/admin/redeem/codes/' + target.id + '/void').set(admin()).send({});
    assert.equal(voided.status, 201);

    const useVoid = await request(server).post('/api/portal/redeem').set(portal()).send({ code: secondCode });
    assert.equal(useVoid.status, 201, '另一张未作废的卡密应仍可兑换');

    const voidedUse = await request(server).post('/api/portal/redeem').set(portal()).send({ code: third });
    assert.equal(voidedUse.status, 410, '已作废的卡密必须拒绝');

    const exportCsv = await request(server).get('/api/admin/redeem/batches/' + batch.body.batch.id + '/export').set(admin());
    assert.equal(exportCsv.status, 200);
    assert.ok((exportCsv.text as string).includes('code,status'));
  });

  it('门户自助解绑设备：解绑成功并扣减配额', async () => {
    const mine = await request(server).get('/api/portal/licenses').set(portal());
    const target = (mine.body.items as { id: string; activationCount: number }[])[0];

    // 先用客户端 API 激活一台设备
    const key = await request(server).post('/api/admin/api-keys').set(admin())
      .send({ name: '门户测试 Key', scopes: ['license:activate', 'license:verify', 'license:deactivate'] });
    const licensePlain = await request(server).get('/api/admin/licenses/' + target.id + '/reveal').set(admin());
    const activated = await request(server).post('/api/v1/activate')
      .set({ 'X-Api-Key': key.body.key })
      .send({ licenseKey: licensePlain.body.keyFormatted, device: { fingerprint: 'portal-device-0001' } });
    assert.equal(activated.status, 201);

    const detail = await request(server).get('/api/portal/licenses/' + target.id).set(portal());
    assert.equal(detail.status, 200);
    const device = (detail.body.devices as { id: string; status: string }[]).find((item) => item.status === 'active');
    assert.ok(device, '应存在一台已绑定设备');

    const unbound = await request(server).delete('/api/portal/licenses/' + target.id + '/devices/' + device.id).set(portal());
    assert.equal(unbound.status, 200, JSON.stringify(unbound.body));
    assert.equal(unbound.body.activeDevices, 0);
    assert.equal(unbound.body.remainingUnbinds, 2, '默认 30 天 3 次自助解绑');
  });

  it('越权访问他人授权返回 404（不泄露资源是否存在）', async () => {
    const other = await request(server).post('/api/admin/licenses').set(admin())
      .send({ productId, planId, customerEmail: 'someone-else@example.com' });
    const res = await request(server).get('/api/portal/licenses/' + other.body.license.id).set(portal());
    assert.equal(res.status, 404);
  });

  it('找回密码：生成令牌 → 重置 → 旧密码失效', async () => {
    const forgot = await request(server).post('/api/portal/auth/forgot-password').send({ email: CUSTOMER.email });
    assert.equal(forgot.status, 201);
    assert.ok(forgot.body.devToken, '开发环境（未配置 SMTP）应回显令牌便于自测');

    const reset = await request(server).post('/api/portal/auth/reset-password')
      .send({ token: forgot.body.devToken, password: 'NewBuyer12345' });
    assert.equal(reset.status, 201);
    assert.ok(reset.body.revokedSessions >= 1);

    const oldLogin = await request(server).post('/api/portal/auth/login').send(CUSTOMER);
    assert.equal(oldLogin.status, 401);
    const newLogin = await request(server).post('/api/portal/auth/login')
      .send({ email: CUSTOMER.email, password: 'NewBuyer12345' });
    assert.equal(newLogin.status, 201);
    customerToken = newLogin.body.tokens.accessToken;

    const reused = await request(server).post('/api/portal/auth/reset-password')
      .send({ token: forgot.body.devToken, password: 'Another12345' });
    assert.equal(reused.status, 400, '重置令牌必须一次性');
  });

  it('管理端：客户列表统计正确，封禁后无法登录门户', async () => {
    const list = await request(server).get('/api/admin/customers').set(admin());
    assert.equal(list.status, 200);
    const row = (list.body.items as { id: string; email: string; licenseCount: number }[])
      .find((item) => item.email === CUSTOMER.email);
    assert.ok(row);
    assert.ok(row.licenseCount >= 3, '应统计到已归属的授权，实际 ' + row.licenseCount);

    const blocked = await request(server).post('/api/admin/customers/' + row.id + '/block').set(admin()).send({});
    assert.equal(blocked.status, 201);
    const denied = await request(server).post('/api/portal/auth/login')
      .send({ email: CUSTOMER.email, password: 'NewBuyer12345' });
    assert.equal(denied.status, 403);
    const unblocked = await request(server).post('/api/admin/customers/' + row.id + '/unblock').set(admin()).send({});
    assert.equal(unblocked.status, 201);
  });

  it('站点设置：关闭自助注册后注册被拒', async () => {
    const off = await request(server).patch('/api/admin/settings').set(admin()).send({ allowRegistration: false });
    assert.equal(off.status, 200);
    const denied = await request(server).post('/api/portal/auth/register')
      .send({ email: 'late@example.com', password: 'Latecomer123' });
    assert.equal(denied.status, 403);
    await request(server).patch('/api/admin/settings').set(admin()).send({ allowRegistration: true });
  });

  it('客户只能看到自己的订单', async () => {
    const mine = await request(server).get('/api/portal/orders').set(portal());
    assert.equal(mine.status, 200);
    assert.ok(mine.body.total >= 1);
    const others = (mine.body.items as { orderNo: string }[]).filter((item) => item.orderNo.length === 0);
    assert.equal(others.length, 0);

    const foreign = await request(server).post('/api/admin/orders').set(admin())
      .send({ email: 'foreign@example.com', items: [{ productId, planId, quantity: 1 }] });
    const denied = await request(server).get('/api/portal/orders/' + foreign.body.id).set(portal());
    assert.equal(denied.status, 404);
  });
});