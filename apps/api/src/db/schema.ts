/**
 * LicenseHub 数据模型（Drizzle / PostgreSQL）。
 *
 * 约定：
 * - 枚举一律使用 text + `$type<Union>()`，不用 PG enum —— 迁移更安全、可自由增删取值。
 * - 金额一律为「分」的整数；时间一律 timestamptz。
 * - 敏感数据（授权码/卡密/API Key/密钥）只存密文 + HMAC 盲索引 + 掩码，禁止明文落库。
 */
import {
  boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type {
  ActivationStatus, ActorType, AdminRole, ApiKeyScope, CouponType, CustomerStatus,
  LicenseSource, LicenseStatus, LicenseType, OrderProvider, OrderStatus, OverLimitPolicy,
  PlanStatus, ProductStatus, RedeemStatus, ReleaseChannel, SigningKeyStatus, VerifyResult,
  WebhookDeliveryStatus, WebhookEvent,
} from '@license-hub/shared';

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).defaultNow().notNull();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).defaultNow().notNull();

/* ------------------------------------------------------------------ 账号与鉴权 */

export const admins = pgTable('admins', {
  id: id(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').$type<AdminRole>().notNull().default('admin'),
  status: text('status').$type<'active' | 'disabled'>().notNull().default('active'),
  totpSecretEnc: text('totp_secret_enc'),
  totpEnabled: boolean('totp_enabled').notNull().default(false),
  failedAttempts: integer('failed_attempts').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  lastLoginIp: text('last_login_ip'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('admins_email_key').on(t.email)]);

/** 统一会话表：管理员与客户共用，刷新即轮换。 */
export const sessions = pgTable('sessions', {
  id: id(),
  subjectType: text('subject_type').$type<'admin' | 'customer'>().notNull(),
  subjectId: uuid('subject_id').notNull(),
  refreshTokenHash: text('refresh_token_hash').notNull(),
  userAgent: text('user_agent'),
  ip: text('ip'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  rotatedFrom: uuid('rotated_from'),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('sessions_refresh_key').on(t.refreshTokenHash),
  index('sessions_subject_idx').on(t.subjectType, t.subjectId),
]);

export const customers = pgTable('customers', {
  id: id(),
  email: text('email').notNull(),
  passwordHash: text('password_hash'),
  name: text('name').notNull().default(''),
  status: text('status').$type<CustomerStatus>().notNull().default('active'),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  unbindCount30d: integer('unbind_count_30d').notNull().default(0),
  unbindWindowStart: timestamp('unbind_window_start', { withTimezone: true }),
  notes: text('notes'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('customers_email_key').on(t.email)]);

/** 一次性令牌：邮箱验证、找回密码。 */
export const authTokens = pgTable('auth_tokens', {
  id: id(),
  subjectType: text('subject_type').$type<'admin' | 'customer'>().notNull(),
  subjectId: uuid('subject_id').notNull(),
  purpose: text('purpose').$type<'email_verify' | 'password_reset'>().notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('auth_tokens_hash_key').on(t.tokenHash),
  index('auth_tokens_subject_idx').on(t.subjectType, t.subjectId),
]);

/* ------------------------------------------------------------------ 产品与策略 */

export const products = pgTable('products', {
  id: id(),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  logoUrl: text('logo_url'),
  websiteUrl: text('website_url'),
  status: text('status').$type<ProductStatus>().notNull().default('draft'),
  keyPrefix: text('key_prefix'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('products_slug_key').on(t.slug)]);

export const productFeatures = pgTable('product_features', {
  id: id(),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('product_features_key').on(t.productId, t.key)]);

export const productReleases = pgTable('product_releases', {
  id: id(),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  version: text('version').notNull(),
  channel: text('channel').$type<ReleaseChannel>().notNull().default('stable'),
  notes: text('notes').notNull().default(''),
  downloadUrl: text('download_url'),
  publishedAt: timestamp('published_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('product_releases_key').on(t.productId, t.version, t.channel)]);

export const plans = pgTable('plans', {
  id: id(),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'restrict' }),
  code: text('code').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  licenseType: text('license_type').$type<LicenseType>().notNull().default('subscription'),
  durationDays: integer('duration_days'),
  maxDevices: integer('max_devices').notNull().default(1),
  offlineGraceDays: integer('offline_grace_days').notNull().default(7),
  heartbeatIntervalHours: integer('heartbeat_interval_hours').notNull().default(24),
  overLimitPolicy: text('over_limit_policy').$type<OverLimitPolicy>().notNull().default('reject'),
  requireDeviceApproval: boolean('require_device_approval').notNull().default(false),
  featureKeys: jsonb('feature_keys').$type<string[]>().notNull().default([]),
  maxUsages: integer('max_usages'),
  /** 域名授权额度：0 表示关闭域名授权（只允许设备绑定） */
  maxDomains: integer('max_domains').notNull().default(0),
  /** 授权 example.com 时是否覆盖 *.example.com */
  allowSubdomains: boolean('allow_subdomains').notNull().default(true),
  priceCents: integer('price_cents').notNull().default(0),
  currency: text('currency').notNull().default('CNY'),
  status: text('status').$type<PlanStatus>().notNull().default('active'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('plans_code_key').on(t.productId, t.code)]);

/* ------------------------------------------------------------------ 授权 */

export const licenses = pgTable('licenses', {
  id: id(),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'restrict' }),
  planId: uuid('plan_id').notNull().references(() => plans.id, { onDelete: 'restrict' }),
  keyLookup: text('key_lookup').notNull(),
  keyEnc: text('key_enc').notNull(),
  keyMasked: text('key_masked').notNull(),
  status: text('status').$type<LicenseStatus>().notNull().default('issued'),
  customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  customerEmail: text('customer_email'),
  maxDevices: integer('max_devices').notNull().default(1),
  activationCount: integer('activation_count').notNull().default(0),
  validFrom: timestamp('valid_from', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  featureKeys: jsonb('feature_keys').$type<string[]>().notNull().default([]),
  maxUsages: integer('max_usages'),
  remainingUsages: integer('remaining_usages'),
  source: text('source').$type<LicenseSource>().notNull().default('manual'),
  batchId: uuid('batch_id'),
  orderId: uuid('order_id'),
  notes: text('notes'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokedReason: text('revoked_reason'),
  issuedBy: uuid('issued_by').references(() => admins.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('licenses_key_lookup_key').on(t.keyLookup),
  index('licenses_status_idx').on(t.status),
  index('licenses_product_idx').on(t.productId, t.status),
  index('licenses_customer_idx').on(t.customerId),
  index('licenses_expires_idx').on(t.expiresAt),
  index('licenses_email_idx').on(t.customerEmail),
]);

export const devices = pgTable('devices', {
  id: id(),
  fingerprintHash: text('fingerprint_hash').notNull(),
  productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
  os: text('os'),
  appVersion: text('app_version'),
  name: text('name'),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
  lastIp: text('last_ip'),
  blacklisted: boolean('blacklisted').notNull().default(false),
  blacklistReason: text('blacklist_reason'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('devices_fingerprint_key').on(t.fingerprintHash),
  index('devices_last_seen_idx').on(t.lastSeenAt),
]);

export const licenseActivations = pgTable('license_activations', {
  id: id(),
  licenseId: uuid('license_id').notNull().references(() => licenses.id, { onDelete: 'cascade' }),
  deviceId: uuid('device_id').notNull().references(() => devices.id, { onDelete: 'cascade' }),
  status: text('status').$type<ActivationStatus>().notNull().default('active'),
  activatedAt: timestamp('activated_at', { withTimezone: true }).defaultNow().notNull(),
  deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
  ip: text('ip'),
  appVersion: text('app_version'),
  os: text('os'),
  unbindReason: text('unbind_reason'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('license_activations_active_key')
    .on(t.licenseId, t.deviceId)
    .where(sql`status = 'active'`),
  index('license_activations_license_idx').on(t.licenseId, t.status),
  index('license_activations_device_idx').on(t.deviceId),
]);

/* ------------------------------------------------------------------ 域名授权（独立体系，不依赖授权码） */

/**
 * 域名授权：运营者直接发给"域名 + 套餐 + 到期"的授权。
 * 客户在自己的网站后台填入域名即可激活，**不需要授权码**。
 * 一张域名授权覆盖 maxDomains 个域名（来自套餐，可单独覆盖）。
 */
export const domainLicenses = pgTable('domain_licenses', {
  id: id(),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'restrict' }),
  planId: uuid('plan_id').notNull().references(() => plans.id, { onDelete: 'restrict' }),
  customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  customerEmail: text('customer_email'),
  status: text('status').$type<LicenseStatus>().notNull().default('active'),
  maxDomains: integer('max_domains').notNull().default(1),
  allowSubdomains: boolean('allow_subdomains').notNull().default(true),
  domainCount: integer('domain_count').notNull().default(0),
  validFrom: timestamp('valid_from', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  featureKeys: jsonb('feature_keys').$type<string[]>().notNull().default([]),
  notes: text('notes'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokedReason: text('revoked_reason'),
  issuedBy: uuid('issued_by').references(() => admins.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('domain_licenses_status_idx').on(t.status),
  index('domain_licenses_product_idx').on(t.productId, t.status),
  index('domain_licenses_customer_idx').on(t.customerId),
  index('domain_licenses_email_idx').on(t.customerEmail),
]);

/** 已授权域名：域名授权的具体绑定对象。域名全局唯一（同一域名只能有一张有效授权）。 */
export const authorizedDomains = pgTable('authorized_domains', {
  id: id(),
  domainLicenseId: uuid('domain_license_id').notNull().references(() => domainLicenses.id, { onDelete: 'cascade' }),
  domain: text('domain').notNull(),
  domainRaw: text('domain_raw'),
  status: text('status').$type<ActivationStatus>().notNull().default('active'),
  environment: text('environment').$type<'production' | 'staging' | 'development'>().notNull().default('production'),
  source: text('source').$type<'admin' | 'customer' | 'import'>().notNull().default('admin'),
  lastIp: text('last_ip'),
  userAgent: text('user_agent'),
  activatedAt: timestamp('activated_at', { withTimezone: true }).defaultNow().notNull(),
  deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
  verifyCount: integer('verify_count').notNull().default(0),
  unbindReason: text('unbind_reason'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('authorized_domains_active_key')
    .on(t.domain)
    .where(sql`status = 'active'`),
  index('authorized_domains_license_idx').on(t.domainLicenseId, t.status),
]);

/** 域名授权事件流（与授权码的事件流分开，避免混在一起看） */
export const domainEvents = pgTable('domain_events', {
  id: id(),
  domainLicenseId: uuid('domain_license_id').notNull().references(() => domainLicenses.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  actorType: text('actor_type').$type<ActorType>().notNull().default('system'),
  actorId: uuid('actor_id'),
  actorLabel: text('actor_label'),
  domain: text('domain'),
  message: text('message'),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  ip: text('ip'),
  createdAt: createdAt(),
}, (t) => [index('domain_events_license_idx').on(t.domainLicenseId, t.createdAt)]);

export const licenseEvents = pgTable('license_events', {
  id: id(),
  licenseId: uuid('license_id').notNull().references(() => licenses.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  actorType: text('actor_type').$type<ActorType>().notNull().default('system'),
  actorId: uuid('actor_id'),
  actorLabel: text('actor_label'),
  message: text('message'),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  ip: text('ip'),
  createdAt: createdAt(),
}, (t) => [index('license_events_license_idx').on(t.licenseId, t.createdAt)]);

export const verificationLogs = pgTable('verification_logs', {
  id: id(),
  licenseId: uuid('license_id').references(() => licenses.id, { onDelete: 'cascade' }),
  deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'set null' }),
  result: text('result').$type<VerifyResult>().notNull(),
  ip: text('ip'),
  appVersion: text('app_version'),
  os: text('os'),
  at: timestamp('at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index('verification_logs_license_idx').on(t.licenseId, t.at),
  index('verification_logs_at_idx').on(t.at),
  index('verification_logs_result_idx').on(t.result, t.at),
]);

export const trials = pgTable('trials', {
  id: id(),
  fingerprintHash: text('fingerprint_hash').notNull(),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  emailHash: text('email_hash'),
  licenseId: uuid('license_id').references(() => licenses.id, { onDelete: 'set null' }),
  firstTrialAt: timestamp('first_trial_at', { withTimezone: true }).defaultNow().notNull(),
  count: integer('count').notNull().default(1),
}, (t) => [
  uniqueIndex('trials_fingerprint_key').on(t.fingerprintHash, t.productId),
  index('trials_email_idx').on(t.emailHash),
]);

/* ------------------------------------------------------------------ 商业化 */

export const orders = pgTable('orders', {
  id: id(),
  orderNo: text('order_no').notNull(),
  customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  email: text('email').notNull(),
  status: text('status').$type<OrderStatus>().notNull().default('pending'),
  currency: text('currency').notNull().default('CNY'),
  subtotalCents: integer('subtotal_cents').notNull().default(0),
  discountCents: integer('discount_cents').notNull().default(0),
  totalCents: integer('total_cents').notNull().default(0),
  couponId: uuid('coupon_id'),
  provider: text('provider').$type<OrderProvider>().notNull().default('manual'),
  providerRef: text('provider_ref'),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  refundedAt: timestamp('refunded_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  notes: text('notes'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('orders_no_key').on(t.orderNo),
  index('orders_status_idx').on(t.status, t.createdAt),
  index('orders_email_idx').on(t.email),
]);

export const orderItems = pgTable('order_items', {
  id: id(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'restrict' }),
  planId: uuid('plan_id').notNull().references(() => plans.id, { onDelete: 'restrict' }),
  quantity: integer('quantity').notNull().default(1),
  unitPriceCents: integer('unit_price_cents').notNull().default(0),
  licenseId: uuid('license_id').references(() => licenses.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, (t) => [index('order_items_order_idx').on(t.orderId)]);

export const paymentEvents = pgTable('payment_events', {
  id: id(),
  provider: text('provider').notNull(),
  eventId: text('event_id').notNull(),
  orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  processedAt: timestamp('processed_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex('payment_events_key').on(t.provider, t.eventId)]);

export const coupons = pgTable('coupons', {
  id: id(),
  code: text('code').notNull(),
  type: text('type').$type<CouponType>().notNull().default('percent'),
  value: integer('value').notNull().default(0),
  maxUses: integer('max_uses'),
  usedCount: integer('used_count').notNull().default(0),
  validFrom: timestamp('valid_from', { withTimezone: true }),
  validUntil: timestamp('valid_until', { withTimezone: true }),
  appliesTo: jsonb('applies_to').$type<{ productIds?: string[]; planIds?: string[] }>().notNull().default({}),
  status: text('status').$type<'active' | 'disabled'>().notNull().default('active'),
  notes: text('notes'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('coupons_code_key').on(t.code)]);

export const redeemBatches = pgTable('redeem_batches', {
  id: id(),
  name: text('name').notNull(),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'restrict' }),
  planId: uuid('plan_id').notNull().references(() => plans.id, { onDelete: 'restrict' }),
  quantity: integer('quantity').notNull().default(0),
  usedCount: integer('used_count').notNull().default(0),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  channel: text('channel'),
  notes: text('notes'),
  createdBy: uuid('created_by').references(() => admins.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, (t) => [index('redeem_batches_product_idx').on(t.productId)]);

export const redeemCodes = pgTable('redeem_codes', {
  id: id(),
  batchId: uuid('batch_id').notNull().references(() => redeemBatches.id, { onDelete: 'cascade' }),
  codeLookup: text('code_lookup').notNull(),
  codeEnc: text('code_enc').notNull(),
  codeMasked: text('code_masked').notNull(),
  status: text('status').$type<RedeemStatus>().notNull().default('unused'),
  usedByCustomerId: uuid('used_by_customer_id').references(() => customers.id, { onDelete: 'set null' }),
  usedAt: timestamp('used_at', { withTimezone: true }),
  licenseId: uuid('license_id').references(() => licenses.id, { onDelete: 'set null' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('redeem_codes_lookup_key').on(t.codeLookup),
  index('redeem_codes_batch_idx').on(t.batchId, t.status),
]);

/* ------------------------------------------------------------------ 集成与运维 */

export const apiKeys = pgTable('api_keys', {
  id: id(),
  name: text('name').notNull(),
  keyLookup: text('key_lookup').notNull(),
  keyEnc: text('key_enc').notNull(),
  keyMasked: text('key_masked').notNull(),
  productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
  scopes: jsonb('scopes').$type<ApiKeyScope[]>().notNull().default([]),
  status: text('status').$type<'active' | 'revoked'>().notNull().default('active'),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => admins.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('api_keys_lookup_key').on(t.keyLookup)]);

export const webhookEndpoints = pgTable('webhook_endpoints', {
  id: id(),
  url: text('url').notNull(),
  description: text('description').notNull().default(''),
  secretEnc: text('secret_enc').notNull(),
  secretMasked: text('secret_masked').notNull(),
  events: jsonb('events').$type<WebhookEvent[]>().notNull().default([]),
  status: text('status').$type<'active' | 'disabled'>().notNull().default('active'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('webhook_endpoints_status_idx').on(t.status)]);

export const webhookDeliveries = pgTable('webhook_deliveries', {
  id: id(),
  endpointId: uuid('endpoint_id').notNull().references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
  event: text('event').$type<WebhookEvent>().notNull(),
  eventId: text('event_id').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  status: text('status').$type<WebhookDeliveryStatus>().notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  responseCode: integer('response_code'),
  responseBody: text('response_body'),
  error: text('error'),
  nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('webhook_deliveries_event_key').on(t.endpointId, t.eventId),
  index('webhook_deliveries_status_idx').on(t.status, t.nextRetryAt),
]);

export const auditLogs = pgTable('audit_logs', {
  id: id(),
  actorType: text('actor_type').$type<ActorType>().notNull().default('admin'),
  actorId: uuid('actor_id'),
  actorEmail: text('actor_email'),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: text('target_id'),
  ip: text('ip'),
  userAgent: text('user_agent'),
  requestId: text('request_id'),
  diff: jsonb('diff').$type<{ before?: unknown; after?: unknown } | null>(),
  createdAt: createdAt(),
}, (t) => [
  index('audit_logs_created_idx').on(t.createdAt),
  index('audit_logs_target_idx').on(t.targetType, t.targetId),
  index('audit_logs_actor_idx').on(t.actorId, t.createdAt),
]);

export const emailLogs = pgTable('email_logs', {
  id: id(),
  to: text('to').notNull(),
  template: text('template').notNull(),
  subject: text('subject').notNull(),
  status: text('status').$type<'queued' | 'sent' | 'failed'>().notNull().default('queued'),
  error: text('error'),
  providerMessageId: text('provider_message_id'),
  relatedType: text('related_type'),
  relatedId: text('related_id'),
  createdAt: createdAt(),
}, (t) => [index('email_logs_created_idx').on(t.createdAt)]);

export const signingKeys = pgTable('signing_keys', {
  id: id(),
  kid: text('kid').notNull(),
  algo: text('algo').$type<'ed25519'>().notNull().default('ed25519'),
  publicKey: text('public_key').notNull(),
  privateKeyEnc: text('private_key_enc').notNull(),
  status: text('status').$type<SigningKeyStatus>().notNull().default('active'),
  rotatedAt: timestamp('rotated_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => admins.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('signing_keys_kid_key').on(t.kid),
  index('signing_keys_status_idx').on(t.status),
]);

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  updatedAt: updatedAt(),
});

/** 离线激活请求码台账：防止请求码被重复使用。 */
export const offlineRequests = pgTable('offline_requests', {
  id: id(),
  requestCodeHash: text('request_code_hash').notNull(),
  licenseId: uuid('license_id').references(() => licenses.id, { onDelete: 'set null' }),
  deviceFingerprintHash: text('device_fingerprint_hash'),
  productSlug: text('product_slug'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  fulfilledAt: timestamp('fulfilled_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('offline_requests_hash_key').on(t.requestCodeHash)]);

export const schema = {
  admins, sessions, customers, authTokens,
  products, productFeatures, productReleases, plans,
  licenses, devices, licenseActivations, licenseEvents, verificationLogs, trials,
  domainLicenses, authorizedDomains, domainEvents,
  orders, orderItems, paymentEvents, coupons, redeemBatches, redeemCodes,
  apiKeys, webhookEndpoints, webhookDeliveries, auditLogs, emailLogs, signingKeys, settings,
  offlineRequests,
};