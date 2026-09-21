/**
 * 客户端视角的规范化 JSON —— 与 src/crypto/crypto.service.ts 的 canonicalJson 规则一致，
 * 但这里**独立实现**，用于验证「服务端签的、客户端能不能验」，避免共用同一份代码导致假阳性。
 */
export function canonicalJsonLikeServer(value: unknown): string {
  return JSON.stringify(sort(value));
}

function sort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([k, v]) => [k, sort(v)]));
  }
  return value;
}
