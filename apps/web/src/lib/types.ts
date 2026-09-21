import type {
  ActivationStatus, LicenseSource, LicenseStatus, LicenseType, OverLimitPolicy, PlanStatus,
  ProductStatus, ApiKeyScope,
} from '@license-hub/shared';

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ProductRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  logoUrl: string | null;
  websiteUrl: string | null;
  status: ProductStatus;
  keyPrefix: string | null;
  planCount: number;
  licenseCount: number;
  activeLicenseCount: number;
  createdAt: string;
}

export interface Plan {
  id: string;
  productId: string;
  code: string;
  name: string;
  description: string;
  licenseType: LicenseType;
  durationDays: number | null;
  maxDevices: number;
  offlineGraceDays: number;
  heartbeatIntervalHours: number;
  overLimitPolicy: OverLimitPolicy;
  requireDeviceApproval: boolean;
  featureKeys: string[];
  maxUsages: number | null;
  /** 域名授权额度：0 = 关闭 */
  maxDomains: number;
  allowSubdomains: boolean;
  priceCents: number;
  currency: string;
  status: PlanStatus;
}

export interface ProductFeature {
  id: string;
  key: string;
  name: string;
  description: string;
}

export interface ProductDetail extends ProductRow {
  plans: Plan[];
  features: ProductFeature[];
  releases: { id: string; version: string; channel: string; notes: string; publishedAt: string }[];
}

export interface LicenseRow {
  id: string;
  keyMasked: string;
  status: LicenseStatus;
  productId: string;
  productName: string;
  planId: string;
  planName: string;
  planCode: string;
  licenseType: LicenseType;
  customerEmail: string | null;
  maxDevices: number;
  activationCount: number;
  validFrom: string;
  expiresAt: string | null;
  featureKeys: string[];
  remainingUsages: number | null;
  maxDomains: number;
  allowSubdomains: boolean;
  domainCount: number;
  source: LicenseSource;
  notes: string | null;
  lastVerifiedAt: string | null;
  createdAt: string;
}

export interface LicenseDomain {
  id: string;
  licenseId?: string;
  domain: string;
  domainRaw?: string | null;
  status: ActivationStatus;
  environment?: 'production' | 'staging' | 'development';
  lastIp?: string | null;
  activatedAt: string;
  deactivatedAt?: string | null;
  lastSeenAt: string;
  unbindReason?: string | null;
}

export interface LicenseEvent {
  id: string;
  type: string;
  actorType: string;
  actorLabel: string | null;
  message: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface LicenseDetail extends LicenseRow {
  events: LicenseEvent[];
}

export interface LicenseStats {
  total: number;
  issued: number;
  active: number;
  expired: number;
  suspended: number;
  revoked: number;
  expiring7d: number;
}

export interface ApiKeyRow {
  id: string;
  name: string;
  keyMasked: string;
  scopes: ApiKeyScope[];
  productId: string | null;
  status: 'active' | 'revoked';
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface ActivationRow {
  id: string;
  licenseId: string;
  keyMasked: string;
  productName: string;
  deviceId: string;
  status: ActivationStatus;
  activatedAt: string;
  lastSeenAt: string;
  ip: string | null;
  os: string | null;
  appVersion: string | null;
}