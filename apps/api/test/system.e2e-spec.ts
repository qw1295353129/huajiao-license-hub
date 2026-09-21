import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { closeTestApp, createTestApp, type TestContext } from './utils/test-app';

describe('系统接口（e2e）', () => {
  let ctx: TestContext;
  let server: never;

  before(async () => {
    ctx = await createTestApp();
    server = ctx.server as never;
  });

  after(async () => {
    await closeTestApp(ctx);
  });

  it('健康检查免认证（容器 healthcheck 依赖此行为）', async () => {
    const res = await request(server).get('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
    assert.equal(res.body.database.ok, true);
    assert.ok(res.body.database.latencyMs >= 0);
  });

  it('迁移已自动应用：核心表可查询', async () => {
    const { DB } = await import('../src/db/db.module');
    const { sql } = await import('drizzle-orm');
    const handle = ctx.app.get(DB) as { db: { execute: (q: unknown) => Promise<unknown> } };
    const result = (await handle.db.execute(sql`
      select count(*)::int as tables from information_schema.tables where table_schema = 'public'
    `)) as { rows?: { tables: number }[] } | { tables: number }[];
    const count = Array.isArray(result) ? result[0].tables : (result.rows?.[0]?.tables ?? 0);
    assert.ok(count >= 25, '期望至少 25 张表，实际 ' + count);
  });

  it('未知路由返回统一错误信封而不是默认 HTML', async () => {
    const res = await request(server).get('/api/definitely-not-here');
    assert.equal(res.status, 404);
    assert.equal(res.body.code, 'NOT_FOUND');
    assert.equal(typeof res.body.requestId, 'string');
  });
});
