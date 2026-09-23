import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import request from 'supertest';
import { TEST_ADMIN } from './env';
import { closeTestApp, createTestApp, type TestContext } from './utils/test-app';

interface Received {
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  json: Record<string, unknown>;
}

describe('Webhook 投递与定时任务（e2e）', () => {
  let ctx: TestContext;
  let server: never;
  let adminToken = '';
  let productId = '';
  let planId = '';
  let receiver: Server;
  let receiverPort = 0;
  let received: Received[] = [];
  let failNext = false;

  const admin = () => ({ Authorization: 'Bearer ' + adminToken });
  const base = () => 'http://127.0.0.1:' + receiverPort;

  before(async () => {
    receiver = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        if (failNext) {
          failNext = false;
          res.writeHead(500);
          res.end('boom');
          return;
        }
        received.push({
          url: req.url ?? '',
          headers: req.headers,
          body,
          json: body ? JSON.parse(body) : {},
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      });
    });
    await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', () => resolve()));
    const address = receiver.address();
    receiverPort = typeof address === 'object' && address ? address.port : 0;

    ctx = await createTestApp();
    server = ctx.server as never;
    const login = await request(server).post('/api/admin/auth/login').send(TEST_ADMIN);
    adminToken = login.body.tokens.accessToken;

    const product = await request(server).post('/api/admin/products').set(admin())
      .send({ slug: 'hook-app', name: 'Webhook 测试产品', status: 'active' });
    productId = product.body.id;
    const plan = await request(server).post('/api/admin/products/' + productId + '/plans').set(admin())
      .send({ code: 'monthly', name: '月付', licenseType: 'subscription', durationDays: 30, maxDevices: 1 });
    planId = plan.body.id;
  });

  after(async () => {
    await closeTestApp(ctx);
    await new Promise<void>((resolve) => receiver.close(() => resolve()));
  });

  let endpointId = '';
  let secret = '';

  it('创建 Webhook 端点：返回一次性签名密钥与掩码', async () => {
    const res = await request(server).post('/api/admin/webhooks').set(admin()).send({
      url: base() + '/hook',
      description: '测试接收端',
      events: ['license.created', 'license.activated', 'license.revoked', 'order.paid', 'license.expired', 'device.bound', 'device.unbound'],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    endpointId = res.body.endpoint.id;
    secret = res.body.secret;
    assert.ok(secret.startsWith('whsec_'));
    assert.ok(res.body.endpoint.secretMasked.includes('****'));

    const list = await request(server).get('/api/admin/webhooks').set(admin());
    assert.equal(list.status, 200);
    assert.ok(!JSON.stringify(list.body).includes(secret), '列表不得返回明文密钥');
  });

  it('非法 URL 与空事件列表被拒绝', async () => {
    const badUrl = await request(server).post('/api/admin/webhooks').set(admin())
      .send({ url: 'not-a-url', events: ['license.created'] });
    assert.equal(badUrl.status, 400);
    const emptyEvents = await request(server).post('/api/admin/webhooks').set(admin())
      .send({ url: base() + '/hook2', events: [] });
    assert.equal(emptyEvents.status, 400);
  });

  it('内网 / 元数据 / localhost 目标被拒绝（SSRF 防护）', async () => {
    for (const url of [
      'http://169.254.169.254/latest/meta-data',
      'http://10.0.0.8/hook',
      'http://192.168.1.10/hook',
      'http://172.16.0.1/hook',
      'http://localhost/hook',
      'http://foo.local/hook',
      'ftp://127.0.0.1/hook',
    ]) {
      const res = await request(server).post('/api/admin/webhooks').set(admin())
        .send({ url, events: ['license.created'] });
      assert.equal(res.status, 400, '应拒绝：' + url + '，实际 ' + res.status + ' ' + JSON.stringify(res.body));
    }
  });

  it('发码事件入队，手动触发投递后接收端验签通过', async () => {
    received = [];
    const license = await request(server).post('/api/admin/licenses').set(admin())
      .send({ productId, planId, customerEmail: 'hook@example.com' });
    assert.equal(license.status, 201);

    const queued = await request(server).get('/api/admin/webhooks/deliveries?status=pending').set(admin());
    assert.ok(queued.body.total >= 1, '应至少有 1 条待投递');

    const run = await request(server).post('/api/admin/tasks/run').set(admin()).send({ task: 'webhook-deliveries' });
    assert.equal(run.status, 201);
    assert.ok(run.body.detail.processed >= 1);
    assert.equal(run.body.detail.succeeded >= 1, true);

    assert.equal(received.length, 1, '接收端应收到 1 次投递');
    const hit = received[0];
    const timestamp = String(hit.headers['x-lh-timestamp']);
    const signature = String(hit.headers['x-lh-signature']);
    assert.equal(String(hit.headers['x-lh-event']), 'license.created');
    assert.ok(hit.headers['x-lh-delivery']);

    // 消费方视角独立验签：HMAC-SHA256(secret, timestamp + '.' + body)
    const expected = 'sha256=' + createHmac('sha256', secret).update(timestamp + '.' + hit.body).digest('hex');
    assert.equal(signature, expected, '签名必须可由消费方独立复算');
    assert.equal((hit.json.data as Record<string, unknown>).licenseId !== undefined, true);

    const after1 = await request(server).get('/api/admin/webhooks/deliveries?status=success').set(admin());
    assert.ok(after1.body.total >= 1);
  });

  it('未订阅的事件不会投递', async () => {
    const other = await request(server).post('/api/admin/webhooks').set(admin())
      .send({ url: base() + '/only-order', events: ['order.paid'] });
    assert.equal(other.status, 201);

    received = [];
    await request(server).post('/api/admin/licenses').set(admin()).send({ productId, planId });
    await request(server).post('/api/admin/tasks/run').set(admin()).send({ task: 'webhook-deliveries' });

    const urls = received.map((item) => item.url);
    assert.equal(urls.includes('/only-order'), false, '只订阅 order.paid 的端点不应收到 license.created');
    assert.ok(urls.includes('/hook'));
  });

  it('投递失败会记录错误并按退避安排重试', async () => {
    failNext = true;
    received = [];
    await request(server).post('/api/admin/licenses').set(admin()).send({ productId, planId });
    const run = await request(server).post('/api/admin/tasks/run').set(admin()).send({ task: 'webhook-deliveries' });
    assert.equal(run.status, 201);
    assert.ok(run.body.detail.failed >= 1);

    const failed = await request(server).get('/api/admin/webhooks/deliveries?status=pending').set(admin());
    const row = (failed.body.items as { attempts: number; error: string | null; nextRetryAt: string | null }[])
      .find((item) => item.error !== null);
    assert.ok(row, '应存在一条带错误信息的待重试记录');
    assert.equal(row.attempts, 1);
    assert.ok(row.nextRetryAt, '应安排下次重试时间');
  });

  it('激活与吊销事件也能投递（含设备信息）', async () => {
    const license = await request(server).post('/api/admin/licenses').set(admin())
      .send({ productId, planId, customerEmail: 'activate-hook@example.com' });
    const plain = await request(server).get('/api/admin/licenses/' + license.body.license.id + '/reveal').set(admin());
    const key = await request(server).post('/api/admin/api-keys').set(admin())
      .send({ name: 'hook key', scopes: ['license:activate', 'license:deactivate'] });

    received = [];
    const activated = await request(server).post('/api/v1/activate')
      .set({ 'X-Api-Key': key.body.key })
      .send({ licenseKey: plain.body.keyFormatted, device: { fingerprint: 'hook-device-0001', os: 'macOS' } });
    assert.equal(activated.status, 201);
    await request(server).post('/api/admin/tasks/run').set(admin()).send({ task: 'webhook-deliveries' });

    const events = received.map((item) => String(item.headers['x-lh-event']));
    assert.ok(events.includes('license.activated'), '事件列表：' + events.join(','));
    assert.ok(events.includes('device.bound'));
  });

  it('测试投递与重放接口可用', async () => {
    const test = await request(server).post('/api/admin/webhooks/' + endpointId + '/test').set(admin()).send({});
    assert.equal(test.status, 201);
    assert.equal(test.body.ok, true);

    const replay = await request(server).post('/api/admin/webhooks/deliveries/' + test.body.deliveryId + '/replay').set(admin()).send({});
    assert.equal(replay.status, 201);
    assert.equal(replay.body.ok, true);
  });

  it('停用端点后不再入队', async () => {
    const patched = await request(server).patch('/api/admin/webhooks/' + endpointId).set(admin()).send({ status: 'disabled' });
    assert.equal(patched.status, 200, JSON.stringify(patched.body));
    assert.equal(patched.body.endpoint.status, 'disabled');

    const before = await request(server).get('/api/admin/webhooks/deliveries?endpointId=' + endpointId).set(admin());
    await request(server).post('/api/admin/licenses').set(admin()).send({ productId, planId });
    const after = await request(server).get('/api/admin/webhooks/deliveries?endpointId=' + endpointId).set(admin());
    assert.equal(after.body.total, before.body.total, '停用后不应为该端点新增投递记录');

    const reenabled = await request(server).patch('/api/admin/webhooks/' + endpointId).set(admin()).send({ status: 'active' });
    assert.equal(reenabled.body.endpoint.status, 'active');
  });

  it('定时任务：把过期授权置为 expired 并发出 license.expired', async () => {
    const status = await request(server).get('/api/admin/webhooks').set(admin());
    const hook = (status.body as { id: string; status: string; events: string[] }[]).find((item) => item.id === endpointId);
    assert.equal(hook?.status, 'active', '前置条件：端点应为启用状态');
    assert.ok(hook?.events.includes('license.expired'));
    const past = await request(server).post('/api/admin/licenses').set(admin())
      .send({ productId, planId, customerEmail: 'expired@example.com' });
    const licenseId = past.body.license.id as string;
    // 直接把到期时间改到过去
    await request(server).patch('/api/admin/licenses/' + licenseId).set(admin())
      .send({ expiresAt: new Date(Date.now() - 86_400_000).toISOString() });

    received = [];
    const run = await request(server).post('/api/admin/tasks/run').set(admin()).send({ task: 'expire-licenses' });
    assert.equal(run.status, 201);
    assert.ok(run.body.detail.expiredLicenses >= 1);

    const detail = await request(server).get('/api/admin/licenses/' + licenseId).set(admin());
    assert.equal(detail.body.status, 'expired');
    const types = (detail.body.events as { type: string }[]).map((event) => event.type);
    assert.ok(types.includes('expired'));

    await request(server).post('/api/admin/tasks/run').set(admin()).send({ task: 'webhook-deliveries' });
    assert.ok(received.some((item) => item.headers['x-lh-event'] === 'license.expired'));
  });

  it('定时任务：到期提醒幂等（同一剩余天数只发一次）', async () => {
    const license = await request(server).post('/api/admin/licenses').set(admin())
      .send({ productId, planId, customerEmail: 'remind@example.com' });
    const licenseId = license.body.license.id as string;

    // 用「站点时区」推导目标日期，避免测试结果随运行钟点变化（曾因此在 23:43 失败）
    const dbModule = await import('../src/db/db.module');
    const drizzle = await import('drizzle-orm');
    const rawHandle = ctx.app.get(dbModule.DB) as {
      db: { execute: (query: unknown) => Promise<{ rows?: Array<{ target: string }> }> };
    };
    const tz = process.env.TIMEZONE ?? 'Asia/Shanghai';
    const dateQuery = await rawHandle.db.execute(
      drizzle.sql`select ((now() at time zone ${tz})::date + interval '7 days')::date::text as target`,
    );
    const target = (dateQuery.rows ?? [])[0]?.target as string;
    assert.ok(target, '应能从数据库取到目标日期');
    await request(server).patch('/api/admin/licenses/' + licenseId).set(admin())
      .send({ expiresAt: target + 'T04:00:00.000Z' });

    const first = await request(server).post('/api/admin/tasks/run').set(admin()).send({ task: 'expiry-reminders' });
    assert.equal(first.status, 201);
    assert.ok(first.body.detail.sent >= 1, JSON.stringify(first.body));

    const second = await request(server).post('/api/admin/tasks/run').set(admin()).send({ task: 'expiry-reminders' });
    assert.ok(second.body.detail.skipped >= 1, '重复执行应跳过已提醒的授权');

    const { DB } = await import('../src/db/db.module');
    const { emailLogs } = await import('../src/db/schema');
    const handle = ctx.app.get(DB) as { db: { select: () => { from: (t: unknown) => Promise<unknown[]> } } };
    const logs = (await handle.db.select().from(emailLogs)) as { to: string; template: string }[];
    const reminders = logs.filter((row) => row.to === 'remind@example.com' && row.template === 'license_expiring');
    assert.equal(reminders.length, 1, '同一授权同一剩余天数只能提醒一次');
  });

  it('未知任务名返回明确错误', async () => {
    const res = await request(server).post('/api/admin/tasks/run').set(admin()).send({ task: 'nope' });
    assert.equal(res.status, 400);
  });

  it('任务待办统计可用', async () => {
    const res = await request(server).get('/api/admin/tasks/backlog').set(admin());
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.pendingWebhookDeliveries, 'number');
    assert.equal(typeof res.body.licensesExpiringIn7Days, 'number');
  });

  it('审计记录了 Webhook 相关操作', async () => {
    const res = await request(server).get('/api/admin/audit-logs?action=webhook&pageSize=50').set(admin());
    assert.equal(res.status, 200);
    const actions = (res.body.items as { action: string }[]).map((item) => item.action);
    assert.ok(actions.some((action) => action.startsWith('webhook.')), '审计动作：' + actions.join(','));
  });
});