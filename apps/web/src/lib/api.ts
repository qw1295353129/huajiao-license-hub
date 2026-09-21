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

  /** 供 UI 判断是否需要额外交互（如双因素、设备超限） */
  get isAuthError(): boolean {
    return this.status === 401;
  }
}

export interface TokenBundle {
  accessToken: string;
  refreshToken: string;
}

const STORAGE_KEY = 'licensehub.tokens';

/**
 * 读取本地令牌。
 * ⚠️ 曾经把 STORAGE_KEY 声明在 §readTokens()§ 调用之后，模块初始化时命中 TDZ 抛错，
 * 又被这里的 try/catch 静默吞掉 —— 表现为「刷新页面即掉登录」。
 * 现在：常量先行，且只在真正解析失败时兜底。
 */
function readTokens(): TokenBundle | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // 隐私模式下 localStorage 不可用
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as TokenBundle;
    if (!parsed.accessToken || !parsed.refreshToken) return null;
    return parsed;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

let tokens: TokenBundle | null = readTokens();
let refreshPromise: Promise<TokenBundle | null> | null = null;
const listeners = new Set<(tokens: TokenBundle | null) => void>();

export function getTokens(): TokenBundle | null {
  return tokens;
}

export function setTokens(next: TokenBundle | null): void {
  tokens = next;
  if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  else localStorage.removeItem(STORAGE_KEY);
  listeners.forEach((fn) => fn(next));
}

export function onTokenChange(fn: (tokens: TokenBundle | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** 内部使用：标记这是刷新后的重试，避免无限递归 */
  retry?: boolean;
  signal?: AbortSignal;
}

async function refreshTokens(): Promise<TokenBundle | null> {
  if (!tokens?.refreshToken) return null;
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const res = await fetch(API_BASE + '/api/admin/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: tokens?.refreshToken }),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { tokens: TokenBundle };
        setTokens(data.tokens);
        return data.tokens;
      } catch {
        return null;
      } finally {
        refreshPromise = null;
      }
    })();
  }
  return refreshPromise;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (tokens?.accessToken) headers.Authorization = 'Bearer ' + tokens.accessToken;

  const res = await fetch(API_BASE + path, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });

  if (res.status === 401 && !options.retry && tokens?.refreshToken) {
    const refreshed = await refreshTokens();
    if (refreshed) return apiRequest<T>(path, { ...options, retry: true });
    setTokens(null);
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

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => apiRequest<T>(path, { method: 'GET', signal }),
  post: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string) => apiRequest<T>(path, { method: 'DELETE' }),
};

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