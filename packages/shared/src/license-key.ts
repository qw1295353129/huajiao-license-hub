/**
 * 授权码编解码规则（前后端共用，必须完全一致）。
 * 字母表去掉了易混字符 I/L/O/U，生成 16 位 Crockford 风格码，例如 LHAB-9F3K-7M2P-XQ4T。
 */

export const KEY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const KEY_LENGTH = 16;
export const KEY_GROUP_SIZE = 4;

const ALPHABET_SET = new Set(KEY_ALPHABET.split(''));

/** 归一化：去分隔符、转大写、修正易混字符（用户手抄常见错误）。 */
export function normalizeLicenseKey(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/I/g, '1')
    .replace(/L/g, '1')
    .replace(/O/g, '0')
    .replace(/U/g, 'V');
}

export function isValidLicenseKeyShape(raw: string): boolean {
  const normalized = normalizeLicenseKey(raw);
  if (normalized.length !== KEY_LENGTH) return false;
  for (const ch of normalized) if (!ALPHABET_SET.has(ch)) return false;
  return true;
}

export function formatLicenseKey(normalized: string, groupSize = KEY_GROUP_SIZE): string {
  const clean = normalizeLicenseKey(normalized);
  const groups: string[] = [];
  for (let i = 0; i < clean.length; i += groupSize) groups.push(clean.slice(i, i + groupSize));
  return groups.join('-');
}

/** 展示用掩码：保留首组与末 4 位，中间打码。 */
export function maskLicenseKey(raw: string, groupSize = KEY_GROUP_SIZE): string {
  const formatted = formatLicenseKey(raw, groupSize);
  const groups = formatted.split('-');
  if (groups.length <= 2) return formatted;
  return [groups[0], ...groups.slice(1, -1).map((g) => '*'.repeat(g.length)), groups[groups.length - 1]].join('-');
}

/** 用户输入容错：允许带前缀、空格、大小写。 */
export function extractLicenseKeyCandidate(input: string): string | null {
  const normalized = normalizeLicenseKey(input);
  if (normalized.length < KEY_LENGTH) return null;
  return normalized.slice(-KEY_LENGTH);
}
