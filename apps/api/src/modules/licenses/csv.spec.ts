import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, toCsv } from './csv';

describe('csv', () => {
  it('Excel 公式注入字符加前导单引号', () => {
    const out = toCsv([
      { note: '=cmd|calc' },
      { note: '+1+1' },
      { note: '@sum' },
      { note: '-2' },
      { note: 'plain' },
    ], ['note']);
    assert.ok(out.includes("'=cmd|calc"), '应转义 = 开头');
    assert.ok(out.includes("'+1+1"), '应转义 + 开头');
    assert.ok(out.includes("'@sum"), '应转义 @ 开头');
    assert.ok(out.includes("'-2"), '应转义 - 开头');
    assert.ok(out.includes('plain'), '普通文本不转义');
  });

  it('逗号与引号按 CSV 规则包裹', () => {
    const out = toCsv([{ a: 'x,y', b: 'say "hi"' }], ['a', 'b']);
    assert.ok(out.includes('"x,y"'));
    assert.ok(out.includes('"say ""hi"""'));
  });

  it('parseCsv 可往返简单表', () => {
    const rows = [{ name: 'alice', city: '北京' }];
    const parsed = parseCsv(toCsv(rows, ['name', 'city']));
    assert.deepEqual(parsed, rows);
  });
});
