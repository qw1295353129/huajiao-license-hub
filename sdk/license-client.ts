/**
 * LicenseHub 客户端 SDK（零依赖，浏览器 / Node 18+ / Electron / Tauri 通用）。
 *
 * 设计要点：
 * 1. 只用 fetch + WebCrypto，不引入任何运行时依赖；
 * 2. 授权文件用 Ed25519 验签，**离线也能判定有效性**（把公钥内置或首次联网缓存）；
 * 3. 网络不可用时返回 { valid: false, reason: 'network' } 而不是抛异常，方便调用方做宽限期降级。
 *
 * 用法：
 * ~~~ts
 * const client = new LicenseClient({
 *   baseUrl: 'https://lic.example.com',
 *   apiKey: 'lh_live_xxx',
 *   product: 'my-app',
 *   // 建议内置公钥，避免首次启动必须联网
 *   publicKey: 'MCowBQYDK2VwAyEA...',
 * });
 * const result = await client.activate('LHAB-9F3K-7M2P-XQ4T', deviceFingerprint());
 * if (result.ok) saveLicenseFile(result.licenseFile);
 * ~~~
 */

export interface LicenseClientOptions {
  baseUrl: string;
  apiKey: string;
  product: string;
  /** 内置公钥（base64url, SPKI）；不填则首次调用时从服务端拉取并缓存 */
  publicKey?: string;
  /** 自定义 fetch（Electron 主进程 / 代理场景） */
  fetchImpl?: typeof fetch;
  /** 请求超时（毫秒），默认 10s */
  timeoutMs?: number;
}

export interface DeviceInfo {
  fingerprint: string;
  name?: string;
  os?: string;
  appVersion?: string;
}

export interface LicenseFile {
  v: 1;
  kid: string;
  licenseId: string;
  product: string;
  plan: string;
  customer: string | null;
  issuedAt: string;
  validFrom: string;
  expiresAt: string | null;
  perpetual: boolean;
  features: string[];
  maxDevices: number;
  deviceFingerprint: string | null;
  offlineGraceDays: number;
  remainingUsages: number | null;
  nonce: string;
  sig: string;
}

export interface Entitlements {
  valid: boolean;
  reason?: string;
  message?: string;
  licenseId?: string;
  product?: string;
  plan?: string;
  expiresAt?: string | null;
  perpetual?: boolean;
  features?: string[];
  maxDevices?: number;
  activeDevices?: number;
  remainingUsages?: number | null;
  heartbeatIntervalHours?: number;
  offlineGraceDays?: number;
}

export type ClientResult<T> =
  | ({ ok: true } & T)
  | { ok: false; reason: string; message: string; status?: number };

interface RawLicenseFile extends LicenseFile {}

/** 规范化 JSON：键按字典序、无空白 —— 与服务端签名规则一致。 */
export function canonicalize(value: unknown): string {
  const sort = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(sort);
    if (input && typeof input === 'object') {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>)
          .filter(([, v]) => v !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, v]) => [k, sort(v)]),
      );
    }
    return input;
  };
  return JSON.stringify(sort(value));
}

function base64UrlToBytes(input: string): Uint8Array {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  if (typeof atob === 'function') {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  return new Uint8Array(Buffer.from(padded, 'base64'));
}

/** 离线验签：只用公开信息即可判断授权文件是否被篡改。 */
export async function verifyLicenseFile(file: RawLicenseFile, publicKeyBase64Url: string): Promise<boolean> {
  const { sig, ...payload } = file;
  if (!sig) return false;
  try {
    const key = await crypto.subtle.importKey(
      'spki',
      base64UrlToBytes(publicKeyBase64Url),
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    return await crypto.subtle.verify(
      { name: 'Ed25519' },
      key,
      base64UrlToBytes(sig),
      new TextEncoder().encode(canonicalize(payload)),
    );
  } catch {
    return false;
  }
}

export class LicenseClient {
  private cachedKey: string | null;
  private readonly doFetch: typeof fetch;

  constructor(private readonly options: LicenseClientOptions) {
    this.cachedKey = options.publicKey ?? null;
    this.doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  private async request<T>(path: string, body?: unknown, method: 'GET' | 'POST' = 'POST'): Promise<ClientResult<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 10_000);
    try {
      const response = await this.doFetch(this.options.baseUrl.replace(/\/$/, '') + path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': this.options.apiKey,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          reason: String(data.code ?? 'HTTP_' + response.status),
          message: String(data.message ?? response.statusText),
        };
      }
      return { ok: true, ...(data as T) };
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      return {
        ok: false,
        reason: aborted ? 'timeout' : 'network',
        message: aborted ? '请求超时' : '无法连接授权服务（离线或网络异常）',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /** 拉取并缓存验签公钥。 */
  async fetchPublicKey(): Promise<string | null> {
    if (this.cachedKey) return this.cachedKey;
    const res = await this.request<{ current: { publicKey: string } | null }>('/api/v1/public-key', undefined, 'GET');
    if (!res.ok || !res.current) return null;
    this.cachedKey = res.current.publicKey;
    return this.cachedKey;
  }

  /** 激活：绑定设备并拿回签名授权文件。 */
  async activate(licenseKey: string, device: DeviceInfo): Promise<ClientResult<{
    licenseFile: LicenseFile;
    entitlements: Entitlements;
    accessToken: string;
  }>> {
    const res = await this.request<{ licenseFile: LicenseFile; entitlements: Entitlements; accessToken: string }>(
      '/api/v1/activate',
      { licenseKey, product: this.options.product, device },
    );
    if (res.ok) {
      const key = await this.fetchPublicKey();
      if (key && !(await verifyLicenseFile(res.licenseFile, key))) {
        return { ok: false, reason: 'SIGNATURE_INVALID', message: '授权文件验签失败，请勿使用被篡改的文件' };
      }
    }
    return res;
  }

  /** 心跳：优先用 accessToken（快路径），失败自动回退授权码。 */
  async verify(params: { licenseKey?: string; accessToken?: string; device: DeviceInfo }): Promise<ClientResult<{ valid: boolean } & Entitlements>> {
    return this.request('/api/v1/verify', {
      ...(params.licenseKey ? { licenseKey: params.licenseKey } : {}),
      ...(params.accessToken ? { accessToken: params.accessToken } : {}),
      device: params.device,
    });
  }

  async deactivate(licenseKey: string, device: DeviceInfo, reason?: string): Promise<ClientResult<{ valid: boolean }>> {
    return this.request('/api/v1/deactivate', { licenseKey, device, ...(reason ? { reason } : {}) });
  }

  async trial(device: DeviceInfo, email?: string): Promise<ClientResult<{ licenseFile: LicenseFile; entitlements: Entitlements; trial: { days: number; licenseKey: string } }>> {
    return this.request('/api/v1/trial', { product: this.options.product, device, ...(email ? { email } : {}) });
  }

  async requestOffline(device: DeviceInfo, licenseKey?: string): Promise<ClientResult<{ requestCode: string }>> {
    return this.request('/api/v1/offline/request', {
      product: this.options.product,
      device,
      ...(licenseKey ? { licenseKey } : {}),
    });
  }

  async activateOffline(responseCode: string): Promise<ClientResult<{ licenseFile: LicenseFile }>> {
    const res = await this.request<{ licenseFile: LicenseFile }>('/api/v1/offline/activate', { responseCode });
    if (res.ok) {
      const key = await this.fetchPublicKey();
      if (key && !(await verifyLicenseFile(res.licenseFile, key))) {
        return { ok: false, reason: 'SIGNATURE_INVALID', message: '响应码验签失败' };
      }
    }
    return res;
  }

  /** 纯离线判断：不联网，直接用授权文件 + 内置公钥判断当前是否可用。 */
  async checkOffline(file: LicenseFile, now = Date.now()): Promise<{ valid: boolean; reason?: string; daysLeft?: number }> {
    const key = await this.fetchPublicKey();
    if (!key) return { valid: false, reason: 'NO_PUBLIC_KEY' };
    if (!(await verifyLicenseFile(file, key))) return { valid: false, reason: 'SIGNATURE_INVALID' };
    if (file.perpetual || !file.expiresAt) return { valid: true };
    const expires = new Date(file.expiresAt).getTime();
    const graceMs = file.offlineGraceDays * 86_400_000;
    const daysLeft = Math.ceil((expires - now) / 86_400_000);
    if (now > expires + graceMs) return { valid: false, reason: 'EXPIRED', daysLeft };
    return { valid: true, daysLeft };
  }
}

/**
 * 生成设备指纹的参考实现：把稳定硬件/安装标识哈希后取前 32 位十六进制。
 * 注意：不要用 MAC 地址等会变的字段；安装 ID 建议首次运行生成并持久化。
 */
export async function fingerprintFrom(parts: string[]): Promise<string> {
  const data = new TextEncoder().encode(parts.join('|'));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}
