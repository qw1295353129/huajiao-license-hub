import type { AdminRole, LicenseStatus, LicenseType, VerifyResult } from './enums';

/** 客户端拿到的授权文件：Ed25519 签名，客户端本地验签即可离线判定有效性。 */
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
  /** 域名授权：本次授权文件绑定的站点域名（设备授权时为 null） */
  domain?: string | null;
  maxDomains?: number;
  offlineGraceDays: number;
  remainingUsages: number | null;
  nonce: string;
  sig: string;
}

export interface Entitlements {
  valid: boolean;
  reason?: VerifyResult;
  message?: string;
  licenseId?: string;
  product?: string;
  plan?: string;
  status?: LicenseStatus;
  licenseType?: LicenseType;
  expiresAt?: string | null;
  perpetual?: boolean;
  features?: string[];
  maxDevices?: number;
  activeDevices?: number;
  /** 已绑定的域名数量 */
  domainCount?: number;
  maxDomains?: number;
  /** 本次校验对应的域名 */
  domain?: string | null;
  remainingUsages?: number | null;
  heartbeatIntervalHours?: number;
  offlineGraceDays?: number;
}

export interface ActivationResponse {
  valid: true;
  accessToken: string;
  expiresIn: number;
  licenseFile: LicenseFile;
  entitlements: Entitlements;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  totpEnabled: boolean;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  requestId?: string;
}

export interface DashboardSummary {
  totalLicenses: number;
  activeLicenses: number;
  expiringIn7Days: number;
  totalCustomers: number;
  totalDevices: number;
  activationsToday: number;
  newLicenses7Days: number;
  activeDevices7Days: number;
  revenueTotalCents: number;
  revenue30DaysCents: number;
  trialConversionRate: number;
}

export interface TimeseriesPoint {
  date: string;
  activations: number;
  verifications: number;
  newLicenses: number;
}