import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { DB } from '../src/db/db.module';
import type { DatabaseHandle } from '../src/db/db.provider';
import { admins } from '../src/db/schema';
import { CryptoService } from '../src/crypto/crypto.service';
import { totpCode } from '../src/crypto/totp';
import { TEST_ADMIN } from './env';
import { closeTestApp, createTestApp, type TestContext } from './utils/test-app';

describe('管理端认证（e2e）', () => {
  let ctx: TestContext;
  let server: never;
  let accessToken = '';
  let refreshToken = '';

  before(async () => {
    ctx = await createTestApp();
    server = ctx.server as never;
  });

  after(async () => {
    await closeTestApp(ctx);
  });

  it('初始管理员由环境变量自动创建，可以登录', async () => {
    const res = await request(server).post('/api/admin/auth/login').send(TEST_ADMIN);
    assert.equal(res.status, 201);
    assert.equal(res.body.user.email, TEST_ADMIN.email);
    assert.equal(res.body.user.role, 'owner');
    assert.equal(res.body.tokens.accessToken.split('.').length, 3);
    accessToken = res.body.tokens.accessToken;
    refreshToken = res.body.tokens.refreshToken;
  });

  it('带令牌可以获取自己的信息', async () => {
    const res = await request(server).get('/api/admin/auth/me').set('Authorization', 'Bearer ' + accessToken);
    assert.equal(res.status, 200);
    assert.equal(res.body.email, TEST_ADMIN.email);
    assert.equal(res.body.totpEnabled, false);
  });

  it('无令牌访问受保护接口返回统一错误信封', async () => {
    const res = await request(server).get('/api/admin/auth/me');
    assert.equal(res.status, 401);
    assert.equal(res.body.code, 'UNAUTHENTICATED');
    assert.equal(typeof res.body.requestId, 'string');
  });

  it('伪造令牌被拒绝', async () => {
    const res = await request(server).get('/api/admin/auth/me').set('Authorization', 'Bearer not.a.token');
    assert.equal(res.status, 401);
    assert.equal(res.body.code, 'UNAUTHENTICATED');
  });

  it('参数校验失败返回 VALIDATION_FAILED 与字段明细', async () => {
    const res = await request(server).post('/api/admin/auth/login').send({ email: 'not-an-email', password: 'x' });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'VALIDATION_FAILED');
    assert.ok(Array.isArray(res.body.details.errors));
  });

  it('密码错误返回 INVALID_CREDENTIALS（不泄露账号是否存在）', async () => {
    const wrong = await request(server).post('/api/admin/auth/login').send({ email: TEST_ADMIN.email, password: 'WrongPass123' });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.code, 'INVALID_CREDENTIALS');

    const unknown = await request(server).post('/api/admin/auth/login').send({ email: 'nobody@test.local', password: 'WrongPass123' });
    assert.equal(unknown.status, 401);
    assert.equal(unknown.body.code, 'INVALID_CREDENTIALS');
  });

  it('连续 5 次失败后账号被锁定', async () => {
    for (let i = 0; i < 5; i += 1) {
      await request(server).post('/api/admin/auth/login').send({ email: TEST_ADMIN.email, password: 'WrongPass' + i });
    }
    // 密码错误时不泄露锁定状态（N5）
    const wrongWhileLocked = await request(server).post('/api/admin/auth/login')
      .send({ email: TEST_ADMIN.email, password: 'StillWrong1' });
    assert.equal(wrongWhileLocked.status, 401);
    assert.equal(wrongWhileLocked.body.code, 'INVALID_CREDENTIALS');

    // 密码正确时才暴露锁定状态
    const res = await request(server).post('/api/admin/auth/login').send(TEST_ADMIN);
    assert.equal(res.status, 423);
    assert.equal(res.body.code, 'ACCOUNT_LOCKED');

    const handle = ctx.app.get<DatabaseHandle>(DB);
    await handle.db.update(admins).set({ failedAttempts: 0, lockedUntil: null }).where(eq(admins.email, TEST_ADMIN.email));
  });

  it('刷新令牌会轮换，旧令牌立即失效', async () => {
    const login = await request(server).post('/api/admin/auth/login').send(TEST_ADMIN);
    const oldRefresh = login.body.tokens.refreshToken as string;

    const first = await request(server).post('/api/admin/auth/refresh').send({ refreshToken: oldRefresh });
    assert.equal(first.status, 201);
    assert.notEqual(first.body.tokens.refreshToken, oldRefresh);
    accessToken = first.body.tokens.accessToken;
    refreshToken = first.body.tokens.refreshToken;

    const replay = await request(server).post('/api/admin/auth/refresh').send({ refreshToken: oldRefresh });
    assert.equal(replay.status, 401);
    assert.equal(replay.body.code, 'UNAUTHENTICATED');
  });

  it('会话列表可见，踢下线接口可用', async () => {
    const list = await request(server).get('/api/admin/auth/sessions').set('Authorization', 'Bearer ' + accessToken);
    assert.equal(list.status, 200);
    assert.ok(Array.isArray(list.body));
    assert.ok(list.body.length >= 1);

    const target = list.body.find((s: { current: boolean }) => !s.current) ?? list.body[0];
    const revoke = await request(server).delete('/api/admin/auth/sessions/' + target.id).set('Authorization', 'Bearer ' + accessToken);
    assert.equal(revoke.status, 200);

    const relogin = await request(server).post('/api/admin/auth/login').send(TEST_ADMIN);
    accessToken = relogin.body.tokens.accessToken;
    refreshToken = relogin.body.tokens.refreshToken;
  });

  it('双因素：setup → enable → 登录必须带动态码', async () => {
    const setup = await request(server).post('/api/admin/auth/2fa/setup').set('Authorization', 'Bearer ' + accessToken);
    assert.equal(setup.status, 201);
    const secret = setup.body.secret as string;
    assert.ok(setup.body.otpauthUri.includes('otpauth://totp/'));

    const badEnable = await request(server).post('/api/admin/auth/2fa/enable')
      .set('Authorization', 'Bearer ' + accessToken).send({ code: '000000' });
    assert.equal(badEnable.status, 400);
    assert.equal(badEnable.body.code, 'TWO_FACTOR_INVALID');

    const enable = await request(server).post('/api/admin/auth/2fa/enable')
      .set('Authorization', 'Bearer ' + accessToken).send({ code: totpCode(secret) });
    assert.equal(enable.status, 201);

    const withoutTotp = await request(server).post('/api/admin/auth/login').send(TEST_ADMIN);
    assert.equal(withoutTotp.status, 401);
    assert.equal(withoutTotp.body.code, 'TWO_FACTOR_REQUIRED');

    const withTotp = await request(server).post('/api/admin/auth/login')
      .send({ ...TEST_ADMIN, totp: totpCode(secret) });
    assert.equal(withTotp.status, 201);
    assert.equal(withTotp.body.user.totpEnabled, true);
    accessToken = withTotp.body.tokens.accessToken;

    const disable = await request(server).post('/api/admin/auth/2fa/disable')
      .set('Authorization', 'Bearer ' + accessToken)
      .send({ password: TEST_ADMIN.password, code: totpCode(secret) });
    assert.equal(disable.status, 201);
  });

  it('改密后旧会话被撤销，当前会话保留，新密码可登录', async () => {
    const res = await request(server).post('/api/admin/auth/password')
      .set('Authorization', 'Bearer ' + accessToken)
      .send({ currentPassword: TEST_ADMIN.password, newPassword: 'NewPass12345' });
    assert.equal(res.status, 201);
    assert.ok(res.body.revokedSessions >= 1);

    // 当前会话（keepSessionId）在改密后仍可用
    const stillMe = await request(server).get('/api/admin/auth/me').set('Authorization', 'Bearer ' + accessToken);
    assert.equal(stillMe.status, 200);

    const stale = await request(server).post('/api/admin/auth/refresh').send({ refreshToken });
    assert.equal(stale.status, 401);

    const relogin = await request(server).post('/api/admin/auth/login')
      .send({ email: TEST_ADMIN.email, password: 'NewPass12345' });
    assert.equal(relogin.status, 201);
    accessToken = relogin.body.tokens.accessToken;
  });

  it('角色不足时返回明确所需角色', async () => {
    const handle = ctx.app.get<DatabaseHandle>(DB);
    const crypto = ctx.app.get(CryptoService);
    await handle.db.insert(admins).values({
      email: 'readonly@test.local',
      name: '只读用户',
      passwordHash: crypto.hashPassword('ReadOnly12345'),
      role: 'readonly',
    });

    const login = await request(server).post('/api/admin/auth/login')
      .send({ email: 'readonly@test.local', password: 'ReadOnly12345' });
    assert.equal(login.status, 201);

    const denied = await request(server).get('/api/admin/auth/roles')
      .set('Authorization', 'Bearer ' + login.body.tokens.accessToken);
    assert.equal(denied.status, 403);
    assert.ok(denied.body.message.includes('support'));

    const allowed = await request(server).get('/api/admin/auth/roles')
      .set('Authorization', 'Bearer ' + accessToken);
    assert.equal(allowed.status, 200);
  });

  it('审计日志记录了登录、失败与双因素事件', async () => {
    const res = await request(server).get('/api/admin/audit-logs?pageSize=50').set('Authorization', 'Bearer ' + accessToken);
    assert.equal(res.status, 200);
    const actions = (res.body.items as { action: string }[]).map((item) => item.action);
    assert.ok(actions.includes('admin.login'));
    assert.ok(actions.includes('admin.login_failed'));
    assert.ok(actions.includes('admin.2fa_enabled'));
    assert.ok(actions.includes('admin.password_changed'));
    assert.ok(res.body.total > 0);
  });
});
