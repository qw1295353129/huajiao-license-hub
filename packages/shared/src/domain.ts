/**
 * 域名归一化与匹配规则（前后端 + SDK 共用，必须完全一致）。
 *
 * 为什么需要归一化：用户会填 https://www.Example.com:8080/path、Example.COM.、裸 example.com……
 * 这些在业务上是同一个站点，若不归一化会出现「同一域名反复占用额度」的投诉。
 */

export interface NormalizedDomain {
  /** 归一化后的主机名（小写、无 www、无端口/路径、IDN 已转 punycode） */
  domain: string;
  valid: boolean;
  reason?: 'EMPTY' | 'MALFORMED' | 'INVALID_HOST' | 'TOO_LONG';
  /** 是否是本地/内网地址（开发环境允许，但要能识别出来） */
  isLocal?: boolean;
}

const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * 归一化域名。
 * 例：'HTTPS://WWW.Example.com:8080/a/b' → 'example.com'
 *     '例え.jp'                          → 'xn--r8jz45g.jp'
 *     'localhost:3000'                   → 'localhost'
 */
export function normalizeDomain(raw: string | null | undefined): NormalizedDomain {
  const input = (raw ?? '').trim().toLowerCase();
  if (!input) return { domain: '', valid: false, reason: 'EMPTY' };

  let host: string;
  try {
    // 统一补协议后交给 URL 解析：一次搞定端口、路径、查询串、IDN → punycode
    const url = new URL(input.includes('://') ? input : 'http://' + input);
    host = url.hostname;
  } catch {
    return { domain: '', valid: false, reason: 'MALFORMED' };
  }

  host = host.replace(/\.$/, ''); // 去掉 FQDN 尾点
  if (host.startsWith('www.')) host = host.slice(4);
  if (host.length === 0) return { domain: '', valid: false, reason: 'MALFORMED' };
  if (host.length > 253) return { domain: host, valid: false, reason: 'TOO_LONG' };

  const isLocal = host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
    || host.endsWith('.test') || IPV4_RE.test(host) || host.startsWith('192.168.')
    || host.startsWith('10.') || /^172\.(1[6-9]|2\d|3[01])\./.test(host);

  if (!HOST_RE.test(host)) return { domain: host, valid: false, reason: 'INVALID_HOST', isLocal };
  // 必须至少有一个点（localhost / IP 除外），防止把 "example" 这种单标签当成域名
  if (!host.includes('.') && host !== 'localhost') {
    return { domain: host, valid: false, reason: 'INVALID_HOST', isLocal };
  }
  return { domain: host, valid: true, isLocal };
}

/** 展示用：把 punycode 还原成可读形式（失败则原样返回） */
export function displayDomain(domain: string): string {
  try {
    return new URL('http://' + domain).hostname === domain ? domain : domain;
  } catch {
    return domain;
  }
}

/**
 * 判断访问域名是否被已授权的域名覆盖。
 * allowSubdomains 为真时，授权 example.com 覆盖 a.example.com（但不覆盖 notexample.com）。
 */
export function domainMatches(candidate: string, licensed: string, allowSubdomains = true): boolean {
  if (!candidate || !licensed) return false;
  if (candidate === licensed) return true;
  if (!allowSubdomains) return false;
  return candidate.endsWith('.' + licensed);
}

/** 从请求头推断域名（Host / X-Forwarded-Host），供服务端集成参考实现使用 */
export function domainFromHeaders(headers: Record<string, string | string[] | undefined>): NormalizedDomain {
  const raw = headers['x-forwarded-host'] ?? headers.host ?? headers[':authority'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return normalizeDomain(value ?? '');
}
