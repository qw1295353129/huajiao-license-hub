import type { AdminRole } from '@license-hub/shared';

export type Audience = 'admin' | 'customer';

/** 认证后挂到 request.user 上的上下文。 */
export interface RequestUser {
  id: string;
  email: string;
  name: string;
  audience: Audience;
  role?: AdminRole;
  sessionId?: string;
}

export interface AccessTokenPayload {
  sub: string;
  email: string;
  name: string;
  aud: Audience;
  role?: AdminRole;
  sid?: string;
  iat?: number;
  exp?: number;
}
