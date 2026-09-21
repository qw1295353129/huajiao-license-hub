import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { redact } from './audit.service';

describe('审计脱敏', () => {
  it('递归抹掉敏感字段但保留普通字段', () => {
    const output = redact({
      email: 'a@b.com',
      password: 'plain-text',
      nested: { licenseKey: 'ABCD-1234', keep: 'ok' },
      list: [{ apiKey: 'k' }],
    }) as Record<string, unknown>;

    assert.equal(output.password, '***');
    assert.equal(output.email, 'a@b.com');
    const nested = output.nested as Record<string, unknown>;
    assert.equal(nested.licenseKey, '***');
    assert.equal(nested.keep, 'ok');
    assert.equal(((output.list as unknown[])[0] as Record<string, unknown>).apiKey, '***');
  });

  it('超长字符串被截断，避免审计表膨胀', () => {
    const output = redact({ note: 'x'.repeat(900) }) as Record<string, unknown>;
    assert.equal((output.note as string).length, 501);
  });
});
