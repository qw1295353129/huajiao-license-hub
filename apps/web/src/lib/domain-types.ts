import type { ActivationStatus, LicenseStatus } from '@license-hub/shared';

/** 域名授权（独立体系，与授权码无关） */
export interface DomainLicenseRow {
  id: string;
  productId: string;
  productName: string;
  productSlug: string;
  planId: string;
  planCode: string;
  planName: string;
  customerId: string | null;
  customerEmail: string | null;
  status: LicenseStatus;
  maxDomains: number;
  allowSubdomains: boolean;
  domainCount: number;
  featureKeys: string[];
  validFrom: string;
  expiresAt: string | null;
  notes: string | null;
  lastVerifiedAt: string | null;
  createdAt: string;
}

export interface AuthorizedDomain {
  id: string;
  domainLicenseId: string;
  domain: string;
  domainRaw: string | null;
  status: ActivationStatus;
  environment: 'production' | 'staging' | 'development';
  source: 'admin' | 'customer' | 'import';
  lastIp: string | null;
  userAgent: string | null;
  activatedAt: string;
  deactivatedAt: string | null;
  lastSeenAt: string;
  verifyCount: number;
  unbindReason: string | null;
}

export interface DomainEvent {
  id: string;
  type: string;
  actorType: string;
  actorLabel: string | null;
  domain: string | null;
  message: string | null;
  createdAt: string;
}

export interface DomainLicenseDetail extends DomainLicenseRow {
  domains: AuthorizedDomain[];
  events: DomainEvent[];
}

export interface DomainStats {
  total: number;
  active: number;
  expiring7d: number;
  activeDomains: number;
}
