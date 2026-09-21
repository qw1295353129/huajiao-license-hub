import type { ApiErrorBody } from '@license-hub/shared';

const API_BASE = import.meta.env.VITE_API_BASE ?? '';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isAuthError(): boolean {
    return this.status === 401;
  }
}

export interface TokenBundle {
  accessToken: string;
  refreshToken: string;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  retry?: boolean;
  signal?: AbortSignal;
}

interface ClientOptions {
  /** localStorage 键名：不同领域使用不同键，避免管理员与客户互相顶掉 */
  storageKey: string;
  /** 刷新端点 */
  refreshPath: string;
}

/** 一个「领域」的 API 客户端：管理端与用户门户各一份，互不干扰。 */
export class ApiClient {
  private tokens: TokenBundle | null;
  private refreshPromise: Promise<TokenBundle | null> | null = null;
  private readonly listeners = new Set<(tokens: TokenBundle | null) => void>();

  constructor(private readonly options: ClientOptions) {
    this.tokens = this.read();
  }

  private read(): TokenBundle | null {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(this.options.storageKey);
    } catch {
      return null; // 隐私模式下不可用
    }
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as TokenBundle;
      if (!parsed.accessToken || !parsed.refreshToken) return null;
      return parsed;
    } catch {
      localStorage.removeItem(this.options.storageKey);
      return null;
    }
  }

  getTokens(): TokenBundle | null {
    return this.tokens;
  }

  setTokens(next: TokenBundle | null): void {
    this.tokens = next;
    if (next) localStorage.setItem(this.options.storageKey, JSON.stringify(next));
    else localStorage.removeItem(this.options.storageKey);
    this.listeners.forEach((fn) => fn(next));
  }

  onTokenChange(fn: (tokens: TokenBundle | null) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private async refresh(): Promise<TokenBundle | null> {
    if (!this.tokens?.refreshToken) return null;
    if (!this.refreshPromise) {
      this.refreshPromise = (async () => {
        try {
          const res = await fetch(API_BASE + this.options.refreshPath, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken: this.tokens?.refreshToken }),
          });
          if (!res.ok) return null;
          const data = (await res.json()) as { tokens: TokenBundle };
          this.setTokens(data.tokens);
          return data.tokens;
        } catch {
          return null;
        } finally {
          this.refreshPromise = null;
        }
      })();
    }
    return this.refreshPromise;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.tokens?.accessToken) headers.Authorization = 'Bearer ' + this.tokens.accessToken;

    const res = await fetch(API_BASE + path, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });

    if (res.status === 401 && !options.retry && this.tokens?.refreshToken) {
      const refreshed = await this.refresh();
      if (refreshed) return this.request<T>(path, { ...options, retry: true });
      this.setTokens(null);
    }

    if (res.status === 204) return undefined as T;

    const text = await res.text();
    const data = text ? (JSON.parse(text) as unknown) : null;

    if (!res.ok) {
      const body = (data ?? {}) as ApiErrorBody;
      throw new ApiError(res.status, body.code ?? 'UNKNOWN', body.message ?? res.statusText, body.details, body.requestId);
    }
    return data as T;
  }

  get = <T>(path: string, signal?: AbortSignal) => this.request<T>(path, { method: 'GET', signal });
  post = <T>(path: string, body?: unknown) => this.request<T>(path, { method: 'POST', body });
  patch = <T>(path: string, body?: unknown) => this.request<T>(path, { method: 'PATCH', body });
  put = <T>(path: string, body?: unknown) => this.request<T>(path, { method: 'PUT', body });
  delete = <T>(path: string) => this.request<T>(path, { method: 'DELETE' });
}

/** 管理端客户端 */
export const api = new ApiClient({
  storageKey: 'licensehub.tokens',
  refreshPath: '/api/admin/auth/refresh',
});

/** 用户门户客户端（独立令牌，互不影响） */
export const portalApi = new ApiClient({
  storageKey: 'licensehub.portal.tokens',
  refreshPath: '/api/portal/auth/refresh',
});

/** 把查询参数拼成 query string，自动跳过空值。 */
export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    usp.set(key, String(value));
  }
  const text = usp.toString();
  return text ? '?' + text : '';
}
