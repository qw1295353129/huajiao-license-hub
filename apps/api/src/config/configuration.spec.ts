import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadConfig } from './configuration';

const base = {
  NODE_ENV: 'production',
  JWT_SECRET: 'x'.repeat(40),
  LICENSE_PEPPER: 'p'.repeat(40),
  DATA_KEY: Buffer.alloc(32, 7).toString('base64'),
  BOOTSTRAP_ADMIN_EMAIL: 'admin@example.com',
  BOOTSTRAP_ADMIN_PASSWORD: 'Str0ng-Pass-2026',
} as NodeJS.ProcessEnv;

describe('loadConfig · 连接串校验与自愈', () => {
  it('口令含 / 的 DATABASE_URL：自动按百分号编码，且还原出原口令', () => {
    const config = loadConfig({
      ...base,
      DATABASE_DRIVER: 'postgres',
      DATABASE_URL: 'postgres://licensehub:ab/cd+ef=gh@postgres:5432/licensehub',
    });
    const parsed = new URL(config.database.url);
    assert.equal(parsed.hostname, 'postgres');
    assert.equal(parsed.port, '5432');
    assert.equal(parsed.username, 'licensehub');
    assert.equal(decodeURIComponent(parsed.password), 'ab/cd+ef=gh');
    assert.equal(parsed.pathname, '/licensehub');
  });

  it('已经编码过的口令保持原样（不重复编码）', () => {
    const url = 'postgres://licensehub:ab%2Fcd+ef%3Dgh@postgres:5432/licensehub';
    const config = loadConfig({ ...base, DATABASE_DRIVER: 'postgres', DATABASE_URL: url });
    assert.equal(config.database.url, url);
  });

  it('口令含 @ 也能自愈（最后一个 @ 才是分隔符）', () => {
    const config = loadConfig({
      ...base,
      DATABASE_DRIVER: 'postgres',
      DATABASE_URL: 'postgres://licensehub:a@b@postgres:5432/licensehub',
    });
    const parsed = new URL(config.database.url);
    assert.equal(parsed.hostname, 'postgres');
    assert.equal(decodeURIComponent(parsed.password), 'a@b');
  });

  it('REDIS_URL 同样自愈', () => {
    const config = loadConfig({
      ...base,
      DATABASE_DRIVER: 'postgres',
      DATABASE_URL: 'postgres://licensehub:pw@postgres:5432/licensehub',
      REDIS_URL: 'redis://:ab/cd@redis:6379',
    });
    assert.equal(new URL(config.redis.url as string).hostname, 'redis');
    assert.equal(decodeURIComponent(new URL(config.redis.url as string).password), 'ab/cd');
  });

  it('彻底无法解析的连接串仍然抛错，并给出可执行修法', () => {
    assert.throws(
      () => loadConfig({ ...base, DATABASE_DRIVER: 'postgres', DATABASE_URL: 'postgres://[bad' }),
      (error: Error) => {
        assert.match(error.message, /DATABASE_URL 无法解析为 URL/);
        assert.match(error.message, /%2F|openssl rand -hex/);
        return true;
      },
    );
  });

  it('pglite 模式不碰 DATABASE_URL（本地开发不受影响）', () => {
    const config = loadConfig({ ...base, NODE_ENV: 'development', DATABASE_DRIVER: 'pglite' });
    assert.equal(config.database.driver, 'pglite');
  });
});

describe('loadConfig · CORS 多 Origin', () => {
  it('默认只放行 APP_ORIGIN', () => {
    const config = loadConfig({ ...base, APP_ORIGIN: 'https://lic.example.com' });
    assert.deepEqual(config.corsOrigins, ['https://lic.example.com']);
  });

  it('CORS_ORIGINS 逗号分隔追加，并与 APP_ORIGIN 去重', () => {
    const config = loadConfig({
      ...base,
      APP_ORIGIN: 'https://lic.example.com',
      CORS_ORIGINS: 'https://lic.example.com, http://127.0.0.1:5178 ,http://localhost:5178,',
    });
    assert.deepEqual(config.corsOrigins, [
      'https://lic.example.com',
      'http://127.0.0.1:5178',
      'http://localhost:5178',
    ]);
  });

  it('空 CORS_ORIGINS / 空白项不会污染列表', () => {
    const config = loadConfig({ ...base, APP_ORIGIN: 'https://lic.example.com', CORS_ORIGINS: '  , ,' });
    assert.deepEqual(config.corsOrigins, ['https://lic.example.com']);
  });
});
