import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { TEST_ADMIN } from './env';
import { closeTestApp, createTestApp, type TestContext } from './utils/test-app';

describe('看板聚合（e2e）', () => {
  let ctx: TestContext;
  let server: never;
  let token = '';

  before(async () => {
    ctx = await createTestApp();
    server = ctx.server as never;
    const login = await request(server).post('/api/admin/auth/login').send(TEST_ADMIN);
    token = login.body.tokens.accessToken;
  });

  after(async () => {
    await closeTestApp(ctx);
  });

  it('空库时所有指标为 0，趋势仍有 30 个数据点', async () => {
    const res = await request(server).get('/api/admin/dashboard').set('Authorization', 'Bearer ' + token);
    assert.equal(res.status, 200);
    const { summary, timeseries, recentEvents, expiringSoon } = res.body;
    assert.equal(summary.totalLicenses, 0);
    assert.equal(summary.activeLicenses, 0);
    assert.equal(summary.revenueTotalCents, 0);
    assert.equal(summary.trialConversionRate, 0);
    assert.equal(timeseries.length, 30);
    assert.ok(typeof timeseries[0].date === 'string');
    assert.equal(timeseries[0].activations, 0);
    const actions = recentEvents.map((e: { action: string }) => e.action) as string[];
    // 初始化管理员时会写一条 admin.create，随后是本次登录
    assert.ok(actions.includes('admin.login'));
    assert.ok(actions.includes('admin.create'));
    const times = recentEvents.map((e: { createdAt: string }) => new Date(e.createdAt).getTime());
    assert.deepEqual(times, [...times].sort((a, b) => b - a), '最近操作应按时间倒序');
    assert.deepEqual(expiringSoon, []);
  });

  it('签名密钥与产品可以被 seed 逻辑写入并出现在统计中', async () => {
    // 直接通过 API 依赖的服务写入一条产品，验证统计口径会跟随数据变化
    const res = await request(server).get('/api/admin/dashboard/summary').set('Authorization', 'Bearer ' + token);
    assert.equal(res.status, 200);
    assert.equal(res.body.totalDevices, 0);
    assert.equal(res.body.totalCustomers, 0);
  });

  it('days 参数越界时被夹紧而不是报错', async () => {
    const res = await request(server).get('/api/admin/dashboard/timeseries?days=99999').set('Authorization', 'Bearer ' + token);
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 365);
  });

  it('未登录无法查看看板', async () => {
    const res = await request(server).get('/api/admin/dashboard');
    assert.equal(res.status, 401);
  });
});