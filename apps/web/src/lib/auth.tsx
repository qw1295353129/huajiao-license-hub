import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { SessionUser } from '@license-hub/shared';
import { api, getTokens, onTokenChange, setTokens } from './api';

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
    if (!getTokens()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const me = await api.get<SessionUser>('/api/admin/auth/me');
      setUser(me);
    } catch {
      setTokens(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  useEffect(() => onTokenChange((next) => {
    if (!next) setUser(null);
  }), []);

  const login = useCallback(async (email: string, password: string, totp?: string) => {
    const res = await api.post<LoginResponse>('/api/admin/auth/login', { email, password, ...(totp ? { totp } : {}) });
    setTokens({ accessToken: res.tokens.accessToken, refreshToken: res.tokens.refreshToken });
    setUser(res.user);
    return {};
  }, []);

  const logout = useCallback(async () => {
    const current = getTokens();
    setTokens(null);
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
