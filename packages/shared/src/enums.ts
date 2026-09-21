/** 领域枚举：前后端共用，禁止在业务代码里出现裸字符串。 */

export const LICENSE_STATUSES = ['issued', 'active', 'expired', 'suspended', 'revoked', 'banned'] as const;
export type LicenseStatus = (typeof LICENSE_STATUSES)[number];

export const LICENSE_TYPES = ['trial', 'subscription', 'perpetual', 'duration', 'consumable'] as const;
export type LicenseType = (typeof LICENSE_TYPES)[number];

export const LICENSE_SOURCES = ['manual', 'batch', 'import', 'order', 'redeem', 'trial', 'api', 'reissue'] as const;
export type LicenseSource = (typeof LICENSE_SOURCES)[number];

export const ACTIVATION_STATUSES = ['active', 'deactivated', 'blocked', 'pending'] as const;
export type ActivationStatus = (typeof ACTIVATION_STATUSES)[number];

export const VERIFY_RESULTS = [
  'valid',
  'invalid_not_found',
  'invalid_expired',
  'invalid_revoked',
  'invalid_suspended',
  'invalid_banned',
  'invalid_device',
  'over_limit',
] as const;
export type VerifyResult = (typeof VERIFY_RESULTS)[number];

export const PRODUCT_STATUSES = ['draft', 'active', 'archived'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const PLAN_STATUSES = ['active', 'archived'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const OVER_LIMIT_POLICIES = ['reject', 'kick_oldest'] as const;
export type OverLimitPolicy = (typeof OVER_LIMIT_POLICIES)[number];

export const RELEASE_CHANNELS = ['stable', 'beta', 'alpha'] as const;
export type ReleaseChannel = (typeof RELEASE_CHANNELS)[number];

export const ADMIN_ROLES = ['owner', 'admin', 'support', 'readonly'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

/** 角色能力矩阵：路由守卫与服务层共用同一份定义，避免各处硬编码。 */
export const ROLE_RANK: Record<AdminRole, number> = { readonly: 1, support: 2, admin: 3, owner: 4 };

export const ORDER_STATUSES = ['pending', 'paid', 'cancelled', 'refunded'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_PROVIDERS = ['manual', 'redeem', 'stripe', 'webhook', 'coupon', 'generic'] as const;
export type OrderProvider = (typeof ORDER_PROVIDERS)[number];

export const COUPON_TYPES = ['percent', 'fixed'] as const;
export type CouponType = (typeof COUPON_TYPES)[number];

export const REDEEM_STATUSES = ['unused', 'used', 'void'] as const;
export type RedeemStatus = (typeof REDEEM_STATUSES)[number];

export const CUSTOMER_STATUSES = ['active', 'blocked'] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export const WEBHOOK_STATUSES = ['pending', 'success', 'failed'] as const;
export type WebhookDeliveryStatus = (typeof WEBHOOK_STATUSES)[number];

export const WEBHOOK_EVENTS = [
  'license.created',
  'license.activated',
  'license.verified',
  'license.deactivated',
  'license.expired',
  'license.revoked',
  'license.extended',
  'device.bound',
  'device.unbound',
  'device.blacklisted',
  'order.paid',
  'order.refunded',
  'customer.created',
  'trial.created',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const API_KEY_SCOPES = [
  'license:read',
  'license:activate',
  'license:verify',
  'license:deactivate',
  'license:trial',
  'license:create',
  'license:revoke',
  'device:read',
] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const ACTOR_TYPES = ['admin', 'customer', 'system', 'api'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export const SIGNING_KEY_STATUSES = ['active', 'retired'] as const;
export type SigningKeyStatus = (typeof SIGNING_KEY_STATUSES)[number];