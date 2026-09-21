import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { SessionUser } from '@license-hub/shared';
import { ApiError, api, portalApi, type ApiClient } from './api';

interface LoginResponse {
  user: SessionUser;
  tokens: { accessToken: string; refreshToken: string; expiresIn: number };
}

interface AuthState {
  user: SessionUser | null;
  loading: boolean;
  login: (email: string, password: string, totp?: string) => Promise<{ requires2fa?: boolean }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    if (!api.getTokens()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      setUser(await api.get<SessionUser>('/api/admin/auth/me'));
    } catch {
      api.setTokens(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  useEffect(() => api.onTokenChange((next) => {
    if (!next) setUser(null);
  }), []);

  const login = useCallback(async (email: string, password: string, totp?: string) => {
    const res = await api.post<LoginResponse>('/api/admin/auth/login', { email, password, ...(totp ? { totp } : {}) });
    api.setTokens({ accessToken: res.tokens.accessToken, refreshToken: res.tokens.refreshToken });
    setUser(res.user);
    return {};
  }, []);

  const logout = useCallback(async () => {
    const current = api.getTokens();
    api.setTokens(null);
    setUser(null);
    if (current?.refreshToken) {
      try {
        await api.post('/api/admin/auth/logout', { refreshToken: current.refreshToken });
      } catch {
        /* 本地已登出，忽略网络错误 */
      }
    }
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, loading, login, logout, refreshUser }),
    [user, loading, login, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return ctx;
}

/* ------------------------------------------------------------------ 用户门户认证 */

export interface PortalUser {
  id: string;
  email: string;
  name: string;
  status?: string;
  createdAt?: string;
}

interface PortalAuthState {
  user: PortalUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const PortalAuthContext = createContext<PortalAuthState | null>(null);

export function PortalAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PortalUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    if (!portalApi.getTokens()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      setUser(await portalApi.get<PortalUser>('/api/portal/me'));
    } catch {
      portalApi.setTokens(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  useEffect(() => portalApi.onTokenChange((next) => {
    if (!next) setUser(null);
  }), []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await portalApi.post<LoginResponse>('/api/portal/auth/login', { email, password });
    portalApi.setTokens({ accessToken: res.tokens.accessToken, refreshToken: res.tokens.refreshToken });
    setUser(await portalApi.get<PortalUser>('/api/portal/me'));
  }, []);

  const register = useCallback(async (email: string, password: string, name?: string) => {
    const res = await portalApi.post<LoginResponse>('/api/portal/auth/register', { email, password, ...(name ? { name } : {}) });
    portalApi.setTokens({ accessToken: res.tokens.accessToken, refreshToken: res.tokens.refreshToken });
    setUser(await portalApi.get<PortalUser>('/api/portal/me'));
  }, []);

  const logout = useCallback(async () => {
    const current = portalApi.getTokens();
    portalApi.setTokens(null);
    setUser(null);
    if (current?.refreshToken) {
      try {
        await portalApi.post('/api/portal/auth/logout', { refreshToken: current.refreshToken });
      } catch {
        /* ignore */
      }
    }
  }, []);

  const value = useMemo<PortalAuthState>(
    () => ({ user, loading, login, register, logout, refreshUser }),
    [user, loading, login, register, logout, refreshUser],
  );

  return <PortalAuthContext.Provider value={value}>{children}</PortalAuthContext.Provider>;
}

export function usePortalAuth(): PortalAuthState {
  const ctx = useContext(PortalAuthContext);
  if (!ctx) throw new Error('usePortalAuth 必须在 PortalAuthProvider 内使用');
  return ctx;
}

export { ApiError };
export type { ApiClient };
