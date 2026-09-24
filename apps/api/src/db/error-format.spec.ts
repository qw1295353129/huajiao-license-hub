import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeError } from './error-format';

describe('describeError', () => {
  it('展开 cause 链：drizzle 把真正原因藏在 cause 里', () => {
    const cause = new Error('permission denied for database "licensehub"');
    const wrapped = new Error('Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"\nparams: ', { cause });
    const text = describeError(wrapped);
    assert.match(text, /Failed query: CREATE SCHEMA/);
    assert.match(text, /↳ permission denied for database/);
    assert.match(text, /ALTER DATABASE .* OWNER TO|GRANT CREATE ON DATABASE/);
  });

  it('多层 cause 也能全部展开', () => {
    const root = new Error('relation "admins" does not exist');
    const mid = new Error('查询失败', { cause: root });
    const top = new Error('顶层错误', { cause: mid });
    const text = describeError(top);
    assert.equal(text.split('\n').filter((line) => line.startsWith('↳ ')).length, 2);
    assert.match(text, /relation "admins" does not exist/);
    assert.match(text, /migrate-cli/);
  });

  it('口令不一致时提示改口令', () => {
    const text = describeError(new Error('password authentication failed for user "licensehub"'));
    assert.match(text, /ALTER USER .* WITH PASSWORD/);
  });

  it('非 Error 值原样输出', () => {
    assert.equal(describeError('boom'), 'boom');
  });

  it('cause 自引用不会死循环', () => {
    const self = new Error('self');
    (self as { cause?: unknown }).cause = self;
    assert.equal(describeError(self).startsWith('self'), true);
  });
});
