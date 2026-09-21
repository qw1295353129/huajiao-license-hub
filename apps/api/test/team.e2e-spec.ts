import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { TEST_ADMIN } from './env';
import { closeTestApp, createTestApp, type TestContext } from './utils/test-app';

describe('团队与角色管理（e2e）', () => {
  let ctx: TestContext;
  let server: never;
  let ownerToken = '';
  let supportId = '';
  let supportToken = '';

  const owner = () => ({ Authorization: 'Bearer ' + ownerToken });
  const support = () => ({ Authorization: 'Bearer ' + supportToken });

  before(async () => {
    ctx = await createTestApp();
    server = ctx.server as never;
    const login = await request(server).post('/api/admin/auth/login').send(TEST_ADMIN);
    ownerToken = login.body.tokens.accessToken;
  });

  after(async () => {
    await closeTestApp(ctx);
  });

  it('owner 可以查看团队成员', async () => {
    const res = await request(server).get('/api/admin/auth/team').set(owner());
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 1);
    assert.equal(res.body[0].role, 'owner');
    assert.ok(!JSON.stringify(res.body).includes('passwordHash'), '不得返回口令哈希');
  });

  it('owner 创建客服账号，客服只能读不能写', async () => {
    const created = await request(server).post('/api/admin/auth/team').set(owner()).send({
      email: 'support@test.local', password: 'Support12345', name: '客服小张', role: 'support',
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    supportId = created.body.id;

    const login = await request(server).post('/api/admin/auth/login')
      .send({ email: 'support@test.local', password: 'Support12345' });
    assert.equal(login.status, 201);
    supportToken = login.body.tokens.accessToken;
    assert.equal(login.body.user.role, 'support');

    const canRead = await request(server).get('/api/admin/licenses').set(support());
    assert.equal(canRead.status, 200);

    const cannotWrite = await request(server).post('/api/admin/products').set(support())
      .send({ slug: 'nope-app', name: 'Nope' });
    assert.equal(cannotWrite.status, 403);
    assert.ok(cannotWrite.body.message.includes('admin'));
  });

  it('非 owner 无法访问团队管理', async () => {
    const res = await request(server).get('/api/admin/auth/team').set(support());
    assert.equal(res.status, 403);
    assert.ok(res.body.message.includes('owner'));

    const create = await request(server).post('/api/admin/auth/team').set(support())
      .send({ email: 'x@test.local', password: 'Whatever12345' });
    assert.equal(create.status, 403);
  });

  it('owner 调整角色后权限立即变化', async () => {
    const updated = await request(server).patch('/api/admin/auth/team/' + supportId).set(owner())
      .send({ role: 'readonly' });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.role, 'readonly');

    // 已签发的旧令牌携带旧角色，需要重新登录才会生效
    const relogin = await request(server).post('/api/admin/auth/login')
      .send({ email: 'support@test.local', password: 'Support12345' });
    supportToken = relogin.body.tokens.accessToken;
    const denied = await request(server).post('/api/admin/products').set(support())
      .send({ slug: 'deny-app', name: 'Deny' });
    assert.equal(denied.status, 403);
  });

  it('owner 重置他人密码后可登录，旧密码失效且会话被吊销', async () => {
    const reset = await request(server).post('/api/admin/auth/team/' + supportId + '/reset-password').set(owner()).send({});
    assert.equal(reset.status, 201);
    assert.ok(reset.body.password.startsWith('Lh-'));

    const stale = await request(server).get('/api/admin/licenses').set(support());
    assert.equal(stale.status, 401, '重置密码后旧会话必须失效');

    const oldPassword = await request(server).post('/api/admin/auth/login')
      .send({ email: 'support@test.local', password: 'Support12345' });
    assert.equal(oldPassword.status, 401);
    const newPassword = await request(server).post('/api/admin/auth/login')
      .send({ email: 'support@test.local', password: reset.body.password });
    assert.equal(newPassword.status, 201);
    supportToken = newPassword.body.tokens.accessToken;
  });

  it('owner 停用账号后该账号无法登录', async () => {
    const disabled = await request(server).patch('/api/admin/auth/team/' + supportId).set(owner())
      .send({ status: 'disabled' });
    assert.equal(disabled.status, 200);
    assert.equal(disabled.body.status, 'disabled');

    const stale = await request(server).get('/api/admin/licenses').set(support());
    assert.equal(stale.status, 401, '停用后会话必须立即失效');

    const login = await request(server).post('/api/admin/auth/login')
      .send({ email: 'support@test.local', password: 'Lh-whatever' });
    assert.ok([401, 403].includes(login.status));

    const reenable = await request(server).patch('/api/admin/auth/team/' + supportId).set(owner())
      .send({ status: 'active' });
    assert.equal(reenable.body.status, 'active');
  });

  it('owner 不能停用或降级自己（避免把自己锁在门外）', async () => {
    const me = await request(server).get('/api/admin/auth/me').set(owner());
    const selfDisable = await request(server).patch('/api/admin/auth/team/' + me.body.id).set(owner())
      .send({ status: 'disabled' });
    assert.equal(selfDisable.status, 400);
    const selfDemote = await request(server).patch('/api/admin/auth/team/' + me.body.id).set(owner())
      .send({ role: 'support' });
    assert.equal(selfDemote.status, 400);
  });

  it('团队变更写入审计日志', async () => {
    const res = await request(server).get('/api/admin/audit-logs?action=admin.&pageSize=50').set(owner());
    const actions = (res.body.items as { action: string }[]).map((item) => item.action);
    assert.ok(actions.includes('admin.create'));
    assert.ok(actions.includes('admin.update'));
    assert.ok(actions.includes('admin.reset_password'));
  });
});
