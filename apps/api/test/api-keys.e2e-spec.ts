import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { TEST_ADMIN } from './env';
import { closeTestApp, createTestApp, type TestContext } from './utils/test-app';

describe('接口密钥管理（e2e）', () => {
  let ctx: TestContext;
  let server: never;
  let token = '';
  let keyId = '';
  let plain = '';
  const auth = () => ({ Authorization: 'Bearer ' + token });

  before(async () => {
    ctx = await createTestApp();
    server = ctx.server as never;
    token = (await request(server).post('/api/admin/auth/login').send(TEST_ADMIN)).body.tokens.accessToken;
  });

  after(async () => {
    await closeTestApp(ctx);
  });

  it('创建：明文只返回一次，列表只给掩码', async () => {
    const created = await request(server).post('/api/admin/api-keys').set(auth())
      .send({ name: '桌面客户端', scopes: ['license:activate', 'license:verify'] });
    assert.equal(created.status, 201);
    plain = created.body.key;
    keyId = created.body.apiKey.id;
    assert.ok(plain.startsWith('lh_live_'));

    const list = await request(server).get('/api/admin/api-keys').set(auth());
    assert.equal(list.status, 200);
    assert.ok(!JSON.stringify(list.body).includes(plain), '列表不得返回明文');
    assert.ok(list.body.items[0].keyMasked.includes('****'));
    assert.equal(list.body.items[0].lastUsedAt, null);
  });

  it('查看明文与最近使用时间', async () => {
    const revealed = await request(server).get('/api/admin/api-keys/' + keyId + '/reveal').set(auth());
    assert.equal(revealed.status, 200);
    assert.equal(revealed.body.key, plain);

    // 用一次密钥，验证 lastUsedAt 会更新
    await request(server).get('/api/v1/public-key').set({ 'X-Api-Key': plain });
    const list = await request(server).get('/api/admin/api-keys').set(auth());
    assert.ok(list.body.items[0].lastUsedAt, '使用后应记录最近使用时间');
  });

  it('吊销后立即失效，恢复后可用', async () => {
    const revoked = await request(server).patch('/api/admin/api-keys/' + keyId).set(auth()).send({ revoked: true });
    assert.equal(revoked.status, 200);
    assert.equal(revoked.body.status, 'revoked');
    const denied = await request(server).get('/api/v1/public-key').set({ 'X-Api-Key': plain });
    assert.equal(denied.status, 403);

    await request(server).patch('/api/admin/api-keys/' + keyId).set(auth()).send({ revoked: false });
    const ok = await request(server).get('/api/v1/public-key').set({ 'X-Api-Key': plain });
    assert.equal(ok.status, 200);
  });

  it('改名与调整作用域', async () => {
    const updated = await request(server).patch('/api/admin/api-keys/' + keyId).set(auth())
      .send({ name: '桌面客户端 v2', scopes: ['license:read'] });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.name, '桌面客户端 v2');
    assert.deepEqual(updated.body.scopes, ['license:read']);

    const denied = await request(server).post('/api/v1/activate').set({ 'X-Api-Key': plain })
      .send({ licenseKey: 'X'.repeat(20), device: { fingerprint: 'scope-check-0001' } });
    assert.equal(denied.status, 403, '作用域被收紧后应拒绝激活');
    assert.equal(denied.body.code, 'SCOPE_MISSING');
  });

  it('删除后彻底消失，且写审计', async () => {
    const del = await request(server).delete('/api/admin/api-keys/' + keyId).set(auth());
    assert.equal(del.status, 200);
    const list = await request(server).get('/api/admin/api-keys').set(auth());
    assert.equal(list.body.total, 0);
    const denied = await request(server).get('/api/v1/public-key').set({ 'X-Api-Key': plain });
    assert.equal(denied.status, 401, '删除后密钥不可用');

    const audit = await request(server).get('/api/admin/audit-logs?action=api_key&pageSize=50').set(auth());
    const actions = (audit.body.items as Array<{ action: string }>).map((row) => row.action);
    for (const expected of ['api_key.create', 'api_key.update', 'api_key.reveal', 'api_key.delete']) {
      assert.ok(actions.includes(expected), '审计应包含 ' + expected + '，实际：' + actions.join(','));
    }
  });
});
