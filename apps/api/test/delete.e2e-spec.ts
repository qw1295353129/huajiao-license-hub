import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { TEST_ADMIN } from './env';
import { closeTestApp, createTestApp, type TestContext } from './utils/test-app';

describe('删除能力（产品 / 策略 / 授权码）e2e', () => {
  let ctx: TestContext;
  let server: never;
  let token = '';
  const auth = () => ({ Authorization: 'Bearer ' + token });

  before(async () => {
    ctx = await createTestApp();
    server = ctx.server as never;
    const login = await request(server).post('/api/admin/auth/login').send(TEST_ADMIN);
    token = login.body.tokens.accessToken;
  });

  after(async () => {
    await closeTestApp(ctx);
  });

  it('没有授权的产品可以直接删除', async () => {
    const product = await request(server).post('/api/admin/products').set(auth())
      .send({ slug: 'throwaway-app', name: '临时产品' });
    await request(server).post('/api/admin/products/' + product.body.id + '/plans').set(auth())
      .send({ code: 'temp-plan', name: '临时套餐', licenseType: 'subscription', durationDays: 30 });

    const res = await request(server).post('/api/admin/products/' + product.body.id + '/delete').set(auth()).send({});
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.deleted, true);

    const gone = await request(server).get('/api/admin/products/' + product.body.id).set(auth());
    assert.equal(gone.status, 404, '产品应已不存在');
  });

  it('有授权的产品拒绝删除并说明原因', async () => {
    const product = await request(server).post('/api/admin/products').set(auth())
      .send({ slug: 'busy-app', name: '在用产品', status: 'active' });
    const plan = await request(server).post('/api/admin/products/' + product.body.id + '/plans').set(auth())
      .send({ code: 'busy-plan', name: '在用套餐', licenseType: 'subscription', durationDays: 365 });
    await request(server).post('/api/admin/licenses').set(auth())
      .send({ productId: product.body.id, planId: plan.body.id });

    const res = await request(server).post('/api/admin/products/' + product.body.id + '/delete').set(auth()).send({});
    assert.equal(res.status, 409);
    assert.ok(res.body.message.includes('授权'), res.body.message);
    assert.equal(res.body.details.licenseCount, 1);

    const still = await request(server).get('/api/admin/products/' + product.body.id).set(auth());
    assert.equal(still.status, 200, '删除失败后产品应仍然存在');
  });

  it('策略：有授权使用时改为归档，未使用时真删', async () => {
    const product = await request(server).post('/api/admin/products').set(auth())
      .send({ slug: 'plan-del-app', name: '策略删除测试' });
    const used = await request(server).post('/api/admin/products/' + product.body.id + '/plans').set(auth())
      .send({ code: 'used-plan', name: '被使用', licenseType: 'subscription', durationDays: 30 });
    const unused = await request(server).post('/api/admin/products/' + product.body.id + '/plans').set(auth())
      .send({ code: 'unused-plan', name: '未使用', licenseType: 'subscription', durationDays: 30 });
    await request(server).post('/api/admin/licenses').set(auth())
      .send({ productId: product.body.id, planId: used.body.id });

    const archived = await request(server).post('/api/admin/plans/' + used.body.id + '/delete').set(auth()).send({});
    assert.equal(archived.body.deleted, false);
    assert.ok(archived.body.reason.includes('归档'), archived.body.reason);

    const removed = await request(server).post('/api/admin/plans/' + unused.body.id + '/delete').set(auth()).send({});
    assert.equal(removed.body.deleted, true);
  });

  it('授权码删除：真的消失、写审计、可批量', async () => {
    const product = await request(server).post('/api/admin/products').set(auth())
      .send({ slug: 'license-del-app', name: '授权码删除测试' });
    const plan = await request(server).post('/api/admin/products/' + product.body.id + '/plans').set(auth())
      .send({ code: 'del-plan', name: '套餐', licenseType: 'subscription', durationDays: 30 });

    const one = await request(server).post('/api/admin/licenses').set(auth())
      .send({ productId: product.body.id, planId: plan.body.id, notes: '待删除' });
    const del = await request(server).delete('/api/admin/licenses/' + one.body.license.id).set(auth());
    assert.equal(del.status, 200);
    assert.equal(del.body.ok, true);

    const gone = await request(server).get('/api/admin/licenses/' + one.body.license.id).set(auth());
    assert.equal(gone.status, 404, '授权码应已不存在');

    const audit = await request(server).get('/api/admin/audit-logs?action=license.delete').set(auth());
    assert.ok(audit.body.total >= 1, '删除必须留审计');
    const rows = audit.body.items as Array<{ diff?: { before?: { keyMasked?: string } } }>;
    const entry = rows.find((row) => row.diff?.before?.keyMasked);
    assert.ok(entry, '审计应包含被删授权码的快照，实际：' + JSON.stringify(rows[0] ?? null));
    assert.equal(entry.diff?.before?.keyMasked, one.body.license.keyMasked);

    const batch = await request(server).post('/api/admin/licenses/batch').set(auth())
      .send({ productId: product.body.id, planId: plan.body.id, count: 3 });
    const list = await request(server).get('/api/admin/licenses?productId=' + product.body.id).set(auth());
    const ids = (list.body.items as Array<{ id: string }>).map((row) => row.id);
    assert.equal(ids.length, 3);
    const many = await request(server).post('/api/admin/licenses/batch-delete').set(auth()).send({ ids });
    assert.equal(many.status, 201);
    assert.equal(many.body.deletedCount, 3, JSON.stringify(many.body));
    assert.equal(many.body.failed.length, 0);
    void batch;
  });
});