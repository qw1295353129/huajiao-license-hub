import { Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { and, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import type { Entitlements, LicenseFile } from '@license-hub/shared';
import { domainMatches, formatLicenseKey, normalizeDomain, normalizeLicenseKey } from '@license-hub/shared';
import { CONFIG_TOKEN, type AppConfig } from '../../config/configuration';
import { CryptoService } from '../../crypto/crypto.service';
import { DB } from '../../db/db.module';
import type { DatabaseHandle } from '../../db/db.provider';
import {
  devices, licenseActivations, licenseDomains, licenseEvents, licenses, offlineRequests, plans, products, trials, verificationLogs,
} from '../../db/schema';
import { AppError, ErrorCodes } from '../../common/errors';
import { LicenseSignerService } from './license-signer.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import type {
  ActivateDomainDto, ActivateDto, DeactivateDomainDto, DeactivateDto, OfflineRequestDto, TrialDto,
  VerifyDomainDto, VerifyDto,
} from './dto';

export interface CallContext {
  ip?: string;
  userAgent?: string;
  apiKeyId?: string;
}

interface ResolvedLicense {
  license: typeof licenses.$inferSelect;
  plan: typeof plans.$inferSelect;
  product: typeof products.$inferSelect;
}

const CLIENT_TOKEN_AUDIENCE = 'client';

@Injectable()
export class ActivationService {
  private readonly logger = new Logger('Activation');

  constructor(
    @Inject(DB) private readonly handle: DatabaseHandle,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
    private readonly crypto: CryptoService,
    private readonly signer: LicenseSignerService,
    private readonly jwt: JwtService,
    private readonly webhooks: WebhooksService,
  ) {}

  private get db() {
    return this.handle.db;
  }

  /* ------------------------------------------------ 查询与校验 */

  private async resolveByKey(rawKey: string): Promise<ResolvedLicense | null> {
    const normalized = normalizeLicenseKey(rawKey);
    const lookup = this.crypto.blindIndex(normalized, 'license');
    const [row] = await this.db.select({
      license: licenses,
      plan: plans,
      product: products,
    }).from(licenses)
      .innerJoin(plans, eq(plans.id, licenses.planId))
      .innerJoin(products, eq(products.id, licenses.productId))
      .where(eq(licenses.keyLookup, lookup))
      .limit(1);
    return row ?? null;
  }

  /** 状态与有效期校验：返回 null 表示有效，否则返回失效原因。 */
  private validateState(resolved: ResolvedLicense): { reason: Entitlements['reason']; message: string } | null {
    const { license } = resolved;
    if (license.status === 'revoked') {
      return { reason: 'invalid_revoked', message: '授权已被吊销' };
    }
    if (license.status === 'banned') {
      return { reason: 'invalid_banned', message: '授权已被封禁' };
    }
    if (license.status === 'suspended') {
      return { reason: 'invalid_suspended', message: '授权已被暂停，请联系客服' };
    }
    if (license.validFrom.getTime() > Date.now()) {
      return { reason: 'invalid_not_found', message: '授权尚未生效' };
    }
    if (license.expiresAt && license.expiresAt.getTime() < Date.now()) {
      return { reason: 'invalid_expired', message: '授权已过期' };
    }
    if (license.remainingUsages !== null && license.remainingUsages <= 0) {
      return { reason: 'invalid_expired', message: '授权次数已用完' };
    }
    return null;
  }

  private async findOrCreateDevice(
    fingerprint: string,
    meta: { productId: string; os?: string; appVersion?: string; name?: string; ip?: string },
  ) {
    const hash = this.crypto.fingerprintHash(fingerprint);
    const [existing] = await this.db.select().from(devices).where(eq(devices.fingerprintHash, hash)).limit(1);
    if (existing) {
      await this.db.update(devices).set({
        lastSeenAt: new Date(),
        lastIp: meta.ip ?? existing.lastIp,
        os: meta.os ?? existing.os,
        appVersion: meta.appVersion ?? existing.appVersion,
        name: meta.name ?? existing.name,
      }).where(eq(devices.id, existing.id));
      return { ...existing, os: meta.os ?? existing.os, appVersion: meta.appVersion ?? existing.appVersion };
    }
    const [created] = await this.db.insert(devices).values({
      fingerprintHash: hash,
      productId: meta.productId,
      os: meta.os ?? null,
      appVersion: meta.appVersion ?? null,
      name: meta.name ?? null,
      lastIp: meta.ip ?? null,
    }).returning();
    return created;
  }

  private async countActiveDevices(licenseId: string): Promise<number> {
    const [row] = await this.db.select({ value: count() }).from(licenseActivations)
      .where(and(eq(licenseActivations.licenseId, licenseId), eq(licenseActivations.status, 'active')));
    return Number(row?.value ?? 0);
  }

  private async recordEvent(input: {
    licenseId: string;
    type: string;
    actorType?: 'admin' | 'customer' | 'system' | 'api';
    actorId?: string | null;
    actorLabel?: string | null;
    message?: string | null;
    payload?: Record<string, unknown>;
    ip?: string | null;
  }): Promise<void> {
    await this.db.insert(licenseEvents).values({
      licenseId: input.licenseId,
      type: input.type,
      actorType: input.actorType ?? 'api',
      actorId: input.actorId ?? null,
      actorLabel: input.actorLabel ?? null,
      message: input.message ?? null,
      payload: input.payload ?? {},
      ip: input.ip ?? null,
    });
  }

  private async logVerification(input: {
    licenseId: string | null;
    deviceId: string | null;
    result: string;
    ip?: string;
    appVersion?: string;
    os?: string;
  }): Promise<void> {
    try {
      await this.db.insert(verificationLogs).values({
        licenseId: input.licenseId,
        deviceId: input.deviceId,
        result: input.result as 'valid',
        ip: input.ip ?? null,
        appVersion: input.appVersion ?? null,
        os: input.os ?? null,
      });
    } catch {
      /* 心跳日志失败不影响主流程 */
    }
  }

  private buildEntitlements(
    resolved: ResolvedLicense,
    activeDevices: number,
    override?: { valid: boolean; reason?: Entitlements['reason']; message?: string },
  ): Entitlements {
    const { license, plan, product } = resolved;
    return {
      valid: override?.valid ?? true,
      ...(override?.reason ? { reason: override.reason } : {}),
      ...(override?.message ? { message: override.message } : {}),
      licenseId: license.id,
      product: product.slug,
      plan: plan.code,
      status: license.status,
      licenseType: plan.licenseType,
      expiresAt: license.expiresAt ? license.expiresAt.toISOString() : null,
      perpetual: license.expiresAt === null,
      features: license.featureKeys,
      maxDevices: license.maxDevices,
      activeDevices,
      remainingUsages: license.remainingUsages,
      heartbeatIntervalHours: plan.heartbeatIntervalHours,
      offlineGraceDays: plan.offlineGraceDays,
    };
  }

  private async buildLicenseFile(
    resolved: ResolvedLicense,
    binding: { deviceFingerprint?: string | null; domain?: string | null } | null,
  ): Promise<LicenseFile> {
    const { license, plan, product } = resolved;
    return this.signer.sign({
      domain: binding?.domain ?? null,
      maxDomains: license.maxDomains,
      licenseId: license.id,
      product: product.slug,
      plan: plan.code,
      customer: license.customerEmail,
      validFrom: license.validFrom.toISOString(),
      expiresAt: license.expiresAt ? license.expiresAt.toISOString() : null,
      perpetual: license.expiresAt === null,
      features: license.featureKeys,
      maxDevices: license.maxDevices,
      deviceFingerprint: binding?.deviceFingerprint ?? null,
      offlineGraceDays: plan.offlineGraceDays,
      remainingUsages: license.remainingUsages,
    });
  }

  private async signClientToken(licenseId: string, deviceId: string, heartbeatHours: number): Promise<string> {
    // 令牌有效期不超过心跳间隔的 3 倍，避免客户端长期离线后仍持有有效令牌
    const ttlHours = Math.min(72, Math.max(6, heartbeatHours * 3));
    return this.jwt.signAsync(
      { sub: licenseId, dev: deviceId, aud: CLIENT_TOKEN_AUDIENCE },
      { expiresIn: ttlHours * 3600 },
    );
  }

  /* ------------------------------------------------ 激活 */

  async activate(dto: ActivateDto, ctx: CallContext) {
    const resolved = await this.resolveByKey(dto.licenseKey);
    if (!resolved) {
      await this.logVerification({ licenseId: null, deviceId: null, result: 'invalid_not_found', ip: ctx.ip });
      throw new AppError(ErrorCodes.LICENSE_NOT_FOUND, '授权码不存在', 404);
    }
    const { license, plan, product } = resolved;

    if (dto.product && dto.product !== product.slug) {
      throw AppError.badRequest(ErrorCodes.VALIDATION_FAILED, '授权码不属于产品 ' + dto.product);
    }

    const invalid = this.validateState(resolved);
    if (invalid) {
      await this.logVerification({ licenseId: license.id, deviceId: null, result: invalid.reason ?? 'invalid_expired', ip: ctx.ip });
      throw new AppError(invalid.reason === 'invalid_expired' ? ErrorCodes.LICENSE_EXPIRED : ErrorCodes.LICENSE_REVOKED, invalid.message, 410);
    }

    const device = await this.findOrCreateDevice(dto.device.fingerprint, {
      productId: product.id,
      os: dto.device.os,
      appVersion: dto.device.appVersion,
      name: dto.device.name,
      ip: ctx.ip,
    });

    if (device.blacklisted) {
      await this.logVerification({ licenseId: license.id, deviceId: device.id, result: 'invalid_device', ip: ctx.ip });
      throw new AppError(ErrorCodes.DEVICE_BLACKLISTED, '该设备已被列入黑名单' + (device.blacklistReason ? '：' + device.blacklistReason : ''), 403);
    }

    const [existingActivation] = await this.db.select().from(licenseActivations)
      .where(and(
        eq(licenseActivations.licenseId, license.id),
        eq(licenseActivations.deviceId, device.id),
        eq(licenseActivations.status, 'active'),
      )).limit(1);

    if (!existingActivation) {
      const activeCount = await this.countActiveDevices(license.id);
      if (license.maxDevices > 0 && activeCount >= license.maxDevices) {
        if (plan.overLimitPolicy === 'kick_oldest') {
          const [oldest] = await this.db.select().from(licenseActivations)
            .where(and(eq(licenseActivations.licenseId, license.id), eq(licenseActivations.status, 'active')))
            .orderBy(licenseActivations.lastSeenAt)
            .limit(1);
          if (oldest) {
            await this.db.update(licenseActivations)
              .set({ status: 'deactivated', deactivatedAt: new Date(), unbindReason: 'kicked_by_new_device' })
              .where(eq(licenseActivations.id, oldest.id));
            this.logger.warn('设备数超限自动踢出：license=' + license.id + ' activation=' + oldest.id);
            await this.recordEvent({
              licenseId: license.id,
              type: 'deactivated',
              message: '设备数超限，自动踢出最久未使用的设备',
              payload: { kickedActivationId: oldest.id },
              ip: ctx.ip ?? null,
            });
          }
        } else {
          await this.logVerification({ licenseId: license.id, deviceId: device.id, result: 'over_limit', ip: ctx.ip });
          throw new AppError(
            ErrorCodes.DEVICE_LIMIT_REACHED,
            '设备数已达上限（' + license.maxDevices + ' 台），请先在客户端解绑或联系客服',
            409,
            { maxDevices: license.maxDevices, activeDevices: activeCount },
          );
        }
      }

      if (plan.requireDeviceApproval) {
        await this.db.insert(licenseActivations).values({
          licenseId: license.id,
          deviceId: device.id,
          status: 'pending',
          ip: ctx.ip ?? null,
          appVersion: dto.device.appVersion ?? null,
          os: dto.device.os ?? null,
        });
        await this.recordEvent({
          licenseId: license.id,
          type: 'activation_pending',
          message: '新设备待人工审批',
          payload: { deviceId: device.id },
          ip: ctx.ip ?? null,
        });
        throw new AppError(ErrorCodes.DEVICE_APPROVAL_REQUIRED, '该授权开启人工审批，新设备需管理员确认后可用', 409);
      }

      await this.db.insert(licenseActivations).values({
        licenseId: license.id,
        deviceId: device.id,
        status: 'active',
        ip: ctx.ip ?? null,
        appVersion: dto.device.appVersion ?? null,
        os: dto.device.os ?? null,
      });
    } else {
      await this.db.update(licenseActivations).set({
        lastSeenAt: new Date(),
        ip: ctx.ip ?? null,
        appVersion: dto.device.appVersion ?? existingActivation.appVersion,
        os: dto.device.os ?? existingActivation.os,
      }).where(eq(licenseActivations.id, existingActivation.id));
    }

    const activeDevices = await this.countActiveDevices(license.id);
    await this.db.update(licenses).set({
      status: 'active',
      activationCount: activeDevices,
      lastVerifiedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(licenses.id, license.id));

    await this.recordEvent({
      licenseId: license.id,
      type: 'activated',
      message: existingActivation ? '设备重新激活' : '新设备激活',
      payload: { deviceId: device.id, os: dto.device.os, appVersion: dto.device.appVersion },
      ip: ctx.ip ?? null,
    });
    await this.logVerification({
      licenseId: license.id,
      deviceId: device.id,
      result: 'valid',
      ip: ctx.ip,
      appVersion: dto.device.appVersion,
      os: dto.device.os,
    });

    await this.webhooks.emit('license.activated', {
      licenseId: license.id,
      keyMasked: license.keyMasked,
      product: product.slug,
      deviceId: device.id,
      os: dto.device.os ?? null,
      appVersion: dto.device.appVersion ?? null,
      activeDevices,
      isNewDevice: !existingActivation,
    }).catch(() => undefined);
    if (!existingActivation) {
      await this.webhooks.emit('device.bound', {
        licenseId: license.id,
        deviceId: device.id,
        os: dto.device.os ?? null,
        activeDevices,
      }).catch(() => undefined);
    }

    const refreshed = { license: { ...license, status: 'active' as const }, plan, product };
    const licenseFile = await this.buildLicenseFile(refreshed, { deviceFingerprint: dto.device.fingerprint });
    const accessToken = await this.signClientToken(license.id, device.id, plan.heartbeatIntervalHours);

    return {
      valid: true as const,
      accessToken,
      expiresIn: Math.min(72, Math.max(6, plan.heartbeatIntervalHours * 3)) * 3600,
      licenseFile,
      entitlements: this.buildEntitlements(refreshed, activeDevices),
    };
  }

  /* ------------------------------------------------ 域名授权 */

  /** 统计仍处于 active 的域名绑定数。 */
  private async countActiveDomains(licenseId: string): Promise<number> {
    const [row] = await this.db.select({ value: count() }).from(licenseDomains)
      .where(and(eq(licenseDomains.licenseId, licenseId), eq(licenseDomains.status, 'active')));
    return Number(row?.value ?? 0);
  }

  /**
   * 查找覆盖该域名的绑定记录。
   * 先精确匹配，再在允许子域时按「父域名」匹配，保证 a.example.com 命中 example.com 的授权。
   */
  private async findDomainBinding(licenseId: string, domain: string, allowSubdomains: boolean) {
    const rows = await this.db.select().from(licenseDomains)
      .where(and(eq(licenseDomains.licenseId, licenseId), eq(licenseDomains.status, 'active')));
    for (const row of rows) {
      if (domainMatches(domain, row.domain, allowSubdomains)) return row;
    }
    return null;
  }

  private buildDomainEntitlements(
    resolved: ResolvedLicense,
    domainCount: number,
    domain: string,
    override?: { valid: boolean; reason?: Entitlements['reason']; message?: string },
  ): Entitlements {
    return {
      ...this.buildEntitlements(resolved, 0, override),
      domain,
      domainCount,
      maxDomains: resolved.license.maxDomains,
    };
  }

  /** 域名激活：把一个站点域名绑定到授权上。 */
  async activateDomain(dto: ActivateDomainDto, ctx: CallContext) {
    const parsed = normalizeDomain(dto.domain);
    if (!parsed.valid) {
      throw AppError.badRequest(
        ErrorCodes.VALIDATION_FAILED,
        '域名格式不正确：' + (dto.domain || '(空)') + '（示例：example.com 或 https://www.example.com）',
        { reason: parsed.reason },
      );
    }
    const domain = parsed.domain;

    const resolved = await this.resolveByKey(dto.licenseKey);
    if (!resolved) throw new AppError(ErrorCodes.LICENSE_NOT_FOUND, '授权码不存在', 404);
    const { license, plan, product } = resolved;

    if (dto.product && dto.product !== product.slug) {
      throw AppError.badRequest(ErrorCodes.VALIDATION_FAILED, '授权码不属于产品 ' + dto.product);
    }

    const invalid = this.validateState(resolved);
    if (invalid) {
      throw new AppError(
        invalid.reason === 'invalid_expired' ? ErrorCodes.LICENSE_EXPIRED : ErrorCodes.LICENSE_REVOKED,
        invalid.message,
        410,
      );
    }

    if (license.maxDomains <= 0) {
      throw new AppError(
        ErrorCodes.DOMAIN_NOT_ALLOWED,
        '该授权不支持域名授权，请在后台把「域名额度」调大后重试',
        409,
        { maxDomains: license.maxDomains, plan: plan.code },
      );
    }

    const existing = await this.findDomainBinding(license.id, domain, license.allowSubdomains);
    if (existing) {
      // 同一域名重复激活：视为幂等，直接续期令牌
      await this.db.update(licenseDomains)
        .set({ lastSeenAt: new Date(), lastIp: ctx.ip ?? existing.lastIp, userAgent: dto.userAgent ?? existing.userAgent })
        .where(eq(licenseDomains.id, existing.id));
      const domainCount = await this.countActiveDomains(license.id);
      await this.touchLicense(license.id, domainCount);
      const file = await this.buildLicenseFile(resolved, { domain: existing.domain });
      const token = await this.signClientToken(license.id, existing.id, plan.heartbeatIntervalHours);
      return {
        valid: true as const,
        accessToken: token,
        expiresIn: Math.min(72, Math.max(6, plan.heartbeatIntervalHours * 3)) * 3600,
        licenseFile: file,
        domain: existing.domain,
        entitlements: this.buildDomainEntitlements(resolved, domainCount, existing.domain),
        reactivated: true,
      };
    }

    const activeCount = await this.countActiveDomains(license.id);
    if (activeCount >= license.maxDomains) {
      throw new AppError(
        ErrorCodes.DOMAIN_LIMIT_REACHED,
        '域名额度已用完（' + license.maxDomains + ' 个），请先在后台解绑不用的域名',
        409,
        { maxDomains: license.maxDomains, domainCount: activeCount },
      );
    }

    const [binding] = await this.db.insert(licenseDomains).values({
      licenseId: license.id,
      domain,
      domainRaw: dto.domain,
      environment: dto.environment ?? 'production',
      lastIp: ctx.ip ?? null,
      userAgent: dto.userAgent ?? null,
    }).returning();

    const domainCount = activeCount + 1;
    await this.touchLicense(license.id, domainCount);
    await this.recordEvent({
      licenseId: license.id,
      type: 'domain_activated',
      message: '新域名激活：' + domain + (parsed.isLocal ? '（本地/内网地址）' : ''),
      payload: { domain, domainRaw: dto.domain, environment: dto.environment ?? 'production' },
      ip: ctx.ip ?? null,
    });

    await this.webhooks.emit('domain.bound', {
      licenseId: license.id,
      keyMasked: license.keyMasked,
      domain,
      environment: dto.environment ?? 'production',
      domainCount,
      maxDomains: license.maxDomains,
    }).catch(() => undefined);

    const file = await this.buildLicenseFile(resolved, { domain });
    const token = await this.signClientToken(license.id, binding.id, plan.heartbeatIntervalHours);
    return {
      valid: true as const,
      accessToken: token,
      expiresIn: Math.min(72, Math.max(6, plan.heartbeatIntervalHours * 3)) * 3600,
      licenseFile: file,
      domain,
      entitlements: this.buildDomainEntitlements({ ...resolved, license: { ...license, status: 'active' } }, domainCount, domain),
      reactivated: false,
    };
  }

  /** 域名心跳校验（服务端集成每次请求或定时调用）。 */
  async verifyDomain(dto: VerifyDomainDto, ctx: CallContext): Promise<Entitlements> {
    const parsed = normalizeDomain(dto.domain);
    if (!parsed.valid) {
      return { valid: false, reason: 'invalid_device', message: '域名格式不正确：' + dto.domain };
    }
    const domain = parsed.domain;

    let resolved: ResolvedLicense | null = null;
    if (dto.accessToken) {
      try {
        const payload = await this.jwt.verifyAsync<{ sub: string; dev: string; aud: string }>(dto.accessToken);
        if (payload.aud !== CLIENT_TOKEN_AUDIENCE) throw new Error('audience mismatch');
        resolved = await this.resolveById(payload.sub);
      } catch {
        resolved = dto.licenseKey ? await this.resolveByKey(dto.licenseKey) : null;
      }
    } else if (dto.licenseKey) {
      resolved = await this.resolveByKey(dto.licenseKey);
    }

    if (!resolved) {
      return { valid: false, reason: 'invalid_not_found', message: '授权码不存在或令牌已失效' };
    }

    const { license } = resolved;
    const domainCount = await this.countActiveDomains(license.id);
    const fail = (reason: Entitlements['reason'], message: string): Entitlements =>
      this.buildDomainEntitlements(resolved as ResolvedLicense, domainCount, domain, { valid: false, reason, message });

    const invalid = this.validateState(resolved);
    if (invalid) return fail(invalid.reason, invalid.message);

    const binding = await this.findDomainBinding(license.id, domain, license.allowSubdomains);
    if (!binding) {
      return fail('invalid_device', '该域名未激活此授权，请先调用 /api/v1/activate-domain');
    }

    await this.db.update(licenseDomains)
      .set({ lastSeenAt: new Date(), lastIp: ctx.ip ?? binding.lastIp, userAgent: dto.userAgent ?? binding.userAgent })
      .where(eq(licenseDomains.id, binding.id));
    await this.touchLicense(license.id, domainCount);

    return this.buildDomainEntitlements(resolved, domainCount, domain);
  }

  /** 域名解绑（客户端/服务端主动释放额度）。 */
  async deactivateDomain(dto: DeactivateDomainDto, ctx: CallContext) {
    const parsed = normalizeDomain(dto.domain);
    if (!parsed.valid) throw AppError.badRequest(ErrorCodes.VALIDATION_FAILED, '域名格式不正确：' + dto.domain);

    const resolved = await this.resolveByKey(dto.licenseKey);
    if (!resolved) throw new AppError(ErrorCodes.LICENSE_NOT_FOUND, '授权码不存在', 404);

    const binding = await this.findDomainBinding(resolved.license.id, parsed.domain, resolved.license.allowSubdomains);
    if (!binding) throw new AppError(ErrorCodes.DOMAIN_NOT_BOUND, '该域名未绑定此授权', 404);

    await this.db.update(licenseDomains)
      .set({ status: 'deactivated', deactivatedAt: new Date(), unbindReason: dto.reason ?? 'client_request' })
      .where(eq(licenseDomains.id, binding.id));

    const domainCount = await this.countActiveDomains(resolved.license.id);
    await this.touchLicense(resolved.license.id, domainCount);
    await this.recordEvent({
      licenseId: resolved.license.id,
      type: 'domain_deactivated',
      message: (dto.reason ?? '客户端解绑域名') + '：' + binding.domain,
      payload: { domain: binding.domain },
      ip: ctx.ip ?? null,
    });

    await this.webhooks.emit('domain.unbound', {
      licenseId: resolved.license.id,
      domain: binding.domain,
      reason: dto.reason ?? 'client_request',
      domainCount,
    }).catch(() => undefined);

    return { valid: true, released: 1, domainCount, maxDomains: resolved.license.maxDomains };
  }

  /** 更新授权上的域名计数与最近校验时间。 */
  private async touchLicense(licenseId: string, domainCount: number): Promise<void> {
    await this.db.update(licenses).set({
      domainCount,
      status: 'active',
      lastVerifiedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(licenses.id, licenseId));
  }

  /** 管理端/门户：列出某授权的域名绑定。 */
  async listDomains(licenseId: string) {
    return this.db.select({
      id: licenseDomains.id,
      licenseId: licenseDomains.licenseId,
      domain: licenseDomains.domain,
      domainRaw: licenseDomains.domainRaw,
      status: licenseDomains.status,
      environment: licenseDomains.environment,
      lastIp: licenseDomains.lastIp,
      activatedAt: licenseDomains.activatedAt,
      deactivatedAt: licenseDomains.deactivatedAt,
      lastSeenAt: licenseDomains.lastSeenAt,
      unbindReason: licenseDomains.unbindReason,
    }).from(licenseDomains)
      .where(eq(licenseDomains.licenseId, licenseId))
      .orderBy(desc(licenseDomains.lastSeenAt));
  }

  /** 解绑单个域名绑定（管理端与门户共用）。 */
  async unbindDomain(domainId: string, actor: { id?: string; email?: string }, reason?: string) {
    const [binding] = await this.db.select().from(licenseDomains).where(eq(licenseDomains.id, domainId)).limit(1);
    if (!binding) throw AppError.notFound('域名绑定记录不存在');
    if (binding.status !== 'active') throw AppError.conflict('该域名未处于绑定状态');

    await this.db.update(licenseDomains)
      .set({ status: 'deactivated', deactivatedAt: new Date(), unbindReason: reason ?? 'admin_unbind' })
      .where(eq(licenseDomains.id, domainId));

    const domainCount = await this.countActiveDomains(binding.licenseId);
    await this.touchLicense(binding.licenseId, domainCount);
    await this.recordEvent({
      licenseId: binding.licenseId,
      type: 'domain_deactivated',
      actorType: actor.email === 'portal' ? 'customer' : 'admin',
      actorId: actor.id ?? null,
      actorLabel: actor.email ?? null,
      message: (reason ?? '解绑域名') + '：' + binding.domain,
      payload: { domain: binding.domain },
    });
    await this.webhooks.emit('domain.unbound', {
      licenseId: binding.licenseId,
      domain: binding.domain,
      reason: reason ?? 'admin_unbind',
      domainCount,
    }).catch(() => undefined);
    return { ok: true, domainCount, maxDomains: 0 };
  }

  /** 清空某授权的全部域名绑定。 */
  async resetDomains(licenseId: string, actor: { id?: string; email?: string }) {
    const rows = await this.db.update(licenseDomains)
      .set({ status: 'deactivated', deactivatedAt: new Date(), unbindReason: 'admin_reset' })
      .where(and(eq(licenseDomains.licenseId, licenseId), eq(licenseDomains.status, 'active')))
      .returning({ id: licenseDomains.id, domain: licenseDomains.domain });
    await this.touchLicense(licenseId, 0);
    await this.recordEvent({
      licenseId,
      type: 'domains_reset',
      actorType: 'admin',
      actorId: actor.id ?? null,
      actorLabel: actor.email ?? null,
      message: '管理员清空域名绑定',
      payload: { released: rows.length, domains: rows.map((row) => row.domain) },
    });
    return { ok: true, released: rows.length };
  }

  /* ------------------------------------------------ 心跳校验 */

  async verify(dto: VerifyDto, ctx: CallContext): Promise<Entitlements> {
    let resolved: ResolvedLicense | null = null;
    let deviceId: string | null = null;

    if (dto.accessToken) {
      try {
        const payload = await this.jwt.verifyAsync<{ sub: string; dev: string; aud: string }>(dto.accessToken);
        if (payload.aud !== CLIENT_TOKEN_AUDIENCE) throw new Error('audience mismatch');
        deviceId = payload.dev;
        const [row] = await this.db.select({ license: licenses, plan: plans, product: products })
          .from(licenses)
          .innerJoin(plans, eq(plans.id, licenses.planId))
          .innerJoin(products, eq(products.id, licenses.productId))
          .where(eq(licenses.id, payload.sub))
          .limit(1);
        resolved = row ?? null;
      } catch {
        // 令牌失效则回退到授权码路径
        resolved = dto.licenseKey ? await this.resolveByKey(dto.licenseKey) : null;
      }
    } else if (dto.licenseKey) {
      resolved = await this.resolveByKey(dto.licenseKey);
    }

    if (!resolved) {
      await this.logVerification({ licenseId: null, deviceId: null, result: 'invalid_not_found', ip: ctx.ip });
      return { valid: false, reason: 'invalid_not_found', message: '授权码不存在或令牌已失效' };
    }

    const { license, plan, product } = resolved;
    const fingerprintHash = this.crypto.fingerprintHash(dto.device.fingerprint);
    const [device] = await this.db.select().from(devices).where(eq(devices.fingerprintHash, fingerprintHash)).limit(1);
    if (device) deviceId = device.id;

    const invalid = this.validateState(resolved);
    if (invalid) {
      await this.logVerification({ licenseId: license.id, deviceId, result: invalid.reason ?? 'invalid_expired', ip: ctx.ip });
      return this.buildEntitlements(resolved, await this.countActiveDevices(license.id), {
        valid: false,
        reason: invalid.reason,
        message: invalid.message,
      });
    }

    if (device?.blacklisted) {
      await this.logVerification({ licenseId: license.id, deviceId, result: 'invalid_device', ip: ctx.ip });
      return this.buildEntitlements(resolved, 0, { valid: false, reason: 'invalid_device', message: '设备已被封禁' });
    }

    const [activation] = await this.db.select().from(licenseActivations)
      .where(and(
        eq(licenseActivations.licenseId, license.id),
        eq(licenseActivations.deviceId, deviceId ?? '00000000-0000-0000-0000-000000000000'),
        eq(licenseActivations.status, 'active'),
      )).limit(1);

    if (!activation) {
      const [pending] = await this.db.select().from(licenseActivations)
        .where(and(
          eq(licenseActivations.licenseId, license.id),
          eq(licenseActivations.status, 'pending'),
        )).limit(1);
      if (pending) {
        return this.buildEntitlements(resolved, await this.countActiveDevices(license.id), {
          valid: false,
          reason: 'invalid_device',
          message: '该设备待管理员审批',
        });
      }
      return this.buildEntitlements(resolved, await this.countActiveDevices(license.id), {
        valid: false,
        reason: 'invalid_device',
        message: '该设备未激活此授权，请先调用 /api/v1/activate',
      });
    }

    await this.db.update(licenseActivations)
      .set({ lastSeenAt: new Date(), ip: ctx.ip ?? activation.ip })
      .where(eq(licenseActivations.id, activation.id));
    await this.db.update(licenses)
      .set({ lastVerifiedAt: new Date(), activationCount: await this.countActiveDevices(license.id) })
      .where(eq(licenses.id, license.id));
    await this.logVerification({
      licenseId: license.id,
      deviceId,
      result: 'valid',
      ip: ctx.ip,
      appVersion: dto.device.appVersion,
      os: dto.device.os,
    });

    const activeDevices = await this.countActiveDevices(license.id);
    const entitlements = this.buildEntitlements(resolved, activeDevices);
    void plan;
    void product;
    return entitlements;
  }

  /* ------------------------------------------------ 解绑 */

  async deactivate(dto: DeactivateDto, ctx: CallContext) {
    const resolved = await this.resolveByKey(dto.licenseKey);
    if (!resolved) throw new AppError(ErrorCodes.LICENSE_NOT_FOUND, '授权码不存在', 404);
    const { license } = resolved;

    const fingerprintHash = this.crypto.fingerprintHash(dto.device.fingerprint);
    const [device] = await this.db.select().from(devices).where(eq(devices.fingerprintHash, fingerprintHash)).limit(1);
    if (!device) throw new AppError(ErrorCodes.DEVICE_NOT_BOUND, '该设备未绑定此授权', 404);

    const rows = await this.db.update(licenseActivations)
      .set({ status: 'deactivated', deactivatedAt: new Date(), unbindReason: dto.reason ?? 'client_request' })
      .where(and(
        eq(licenseActivations.licenseId, license.id),
        eq(licenseActivations.deviceId, device.id),
        eq(licenseActivations.status, 'active'),
      ))
      .returning({ id: licenseActivations.id });

    if (rows.length === 0) throw new AppError(ErrorCodes.DEVICE_NOT_BOUND, '该设备未激活此授权', 404);

    const activeDevices = await this.countActiveDevices(license.id);
    await this.db.update(licenses)
      .set({ activationCount: activeDevices, updatedAt: new Date() })
      .where(eq(licenses.id, license.id));
    await this.recordEvent({
      licenseId: license.id,
      type: 'deactivated',
      message: dto.reason ?? '客户端主动解绑',
      payload: { deviceId: device.id },
      ip: ctx.ip ?? null,
    });
    await this.webhooks.emit('license.deactivated', {
      licenseId: license.id,
      keyMasked: license.keyMasked,
      deviceId: device.id,
      activeDevices,
    }).catch(() => undefined);
    await this.webhooks.emit('device.unbound', {
      licenseId: license.id,
      deviceId: device.id,
      reason: dto.reason ?? 'client_request',
    }).catch(() => undefined);
    return { valid: true, releasedDevices: 1, activeDevices, maxDevices: license.maxDevices };
  }

  /* ------------------------------------------------ 试用 */

  async trial(dto: TrialDto, ctx: CallContext) {
    const [product] = await this.db.select().from(products).where(eq(products.slug, dto.product)).limit(1);
    if (!product) throw AppError.notFound('产品不存在：' + dto.product);

    const fingerprintHash = this.crypto.fingerprintHash(dto.device.fingerprint);
    const [existingTrial] = await this.db.select().from(trials)
      .where(and(eq(trials.fingerprintHash, fingerprintHash), eq(trials.productId, product.id)))
      .limit(1);
    if (existingTrial) {
      throw new AppError(ErrorCodes.TRIAL_ALREADY_USED, '该设备已领取过试用', 409, {
        firstTrialAt: existingTrial.firstTrialAt.toISOString(),
      });
    }

    const [trialPlan] = await this.db.select().from(plans)
      .where(and(eq(plans.productId, product.id), eq(plans.licenseType, 'trial')))
      .orderBy(plans.durationDays)
      .limit(1);
    if (!trialPlan) {
      throw AppError.badRequest(ErrorCodes.VALIDATION_FAILED, '该产品未配置试用策略，请在后台先创建一个试用型策略');
    }

    const days = trialPlan.durationDays ?? this.config.security.trialDefaultDays;
    const rawKey = this.crypto.generateCode(16);
    const normalized = normalizeLicenseKey(rawKey);
    const [license] = await this.db.insert(licenses).values({
      productId: product.id,
      planId: trialPlan.id,
      keyLookup: this.crypto.blindIndex(normalized, 'license'),
      keyEnc: this.crypto.encrypt(normalized),
      keyMasked: '****-****-****-' + normalized.slice(-4),
      status: 'issued',
      customerEmail: dto.email?.trim().toLowerCase() ?? null,
      maxDevices: trialPlan.maxDevices,
      expiresAt: new Date(Date.now() + days * 86_400_000),
      featureKeys: trialPlan.featureKeys,
      source: 'trial',
      metadata: { trialFingerprint: fingerprintHash },
    }).returning();

    await this.db.insert(trials).values({
      fingerprintHash,
      productId: product.id,
      emailHash: dto.email ? this.crypto.blindIndex(dto.email, 'email') : null,
      licenseId: license.id,
    });

    const activation = await this.activate(
      { licenseKey: formatLicenseKey(rawKey), product: product.slug, device: dto.device },
      ctx,
    );
    await this.recordEvent({
      licenseId: license.id,
      type: 'trial_started',
      actorType: 'api',
      message: '试用授权已发放（' + days + ' 天）',
      ip: ctx.ip ?? null,
    });
    await this.webhooks.emit('trial.created', {
      licenseId: license.id,
      product: product.slug,
      days,
      email: dto.email ?? null,
    }).catch(() => undefined);
    return { ...activation, trial: { days, licenseKey: formatLicenseKey(rawKey) } };
  }

  /* ------------------------------------------------ 离线激活 */

  private requestCodeFor(payload: Record<string, unknown>): string {
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const mac = this.crypto.blindIndex(body, 'offline-request').slice(0, 32);
    return body + '.' + mac;
  }

  private parseRequestCode(code: string): Record<string, unknown> {
    const [body, mac] = code.trim().split('.');
    if (!body || !mac) throw new AppError(ErrorCodes.OFFLINE_CODE_INVALID, '请求码格式不正确', 400);
    if (this.crypto.blindIndex(body, 'offline-request').slice(0, 32) !== mac) {
      throw new AppError(ErrorCodes.OFFLINE_CODE_INVALID, '请求码校验失败，请确认完整复制', 400);
    }
    try {
      return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<string, unknown>;
    } catch {
      throw new AppError(ErrorCodes.OFFLINE_CODE_INVALID, '请求码内容损坏', 400);
    }
  }

  /** 离线机生成请求码（客户端调用，不联网校验授权）。 */
  async offlineRequest(dto: OfflineRequestDto, ctx: CallContext) {
    const payload = {
      product: dto.product,
      licenseKey: dto.licenseKey ? normalizeLicenseKey(dto.licenseKey) : null,
      fingerprint: dto.device.fingerprint,
      os: dto.device.os ?? null,
      appVersion: dto.device.appVersion ?? null,
      issuedAt: new Date().toISOString(),
    };
    const requestCode = this.requestCodeFor(payload);
    await this.db.insert(offlineRequests).values({
      requestCodeHash: this.crypto.blindIndex(requestCode, 'offline-code'),
      productSlug: dto.product,
      deviceFingerprintHash: this.crypto.fingerprintHash(dto.device.fingerprint),
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
    });
    void ctx;
    return {
      requestCode,
      expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      instructions: '请将请求码发送给软件作者，换取响应码后在客户端导入',
    };
  }

  /** 运营者在后台用请求码换取响应码。 */
  async offlineResponse(licenseId: string, requestCode: string, offlineGraceDays?: number) {
    const payload = this.parseRequestCode(requestCode);
    const resolved = await this.resolveById(licenseId);
    if (!resolved) throw AppError.notFound('授权不存在');
    const invalid = this.validateState(resolved);
    if (invalid) throw new AppError(ErrorCodes.LICENSE_REVOKED, invalid.message, 410);

    const hash = this.crypto.blindIndex(requestCode, 'offline-code');
    const [record] = await this.db.select().from(offlineRequests)
      .where(eq(offlineRequests.requestCodeHash, hash)).limit(1);
    if (!record) throw new AppError(ErrorCodes.OFFLINE_CODE_INVALID, '请求码未在本系统登记', 400);
    if (record.fulfilledAt) throw new AppError(ErrorCodes.OFFLINE_CODE_INVALID, '该请求码已使用过', 400);
    if (record.expiresAt.getTime() < Date.now()) {
      throw new AppError(ErrorCodes.OFFLINE_CODE_EXPIRED, '请求码已过期（有效期 7 天）', 410);
    }

    const fingerprint = typeof payload.fingerprint === 'string' ? payload.fingerprint : null;
    const file = await this.buildLicenseFile(resolved, { deviceFingerprint: fingerprint });
    if (offlineGraceDays !== undefined) file.offlineGraceDays = offlineGraceDays;

    await this.db.update(offlineRequests)
      .set({ fulfilledAt: new Date(), licenseId })
      .where(eq(offlineRequests.id, record.id));
    await this.recordEvent({
      licenseId,
      type: 'offline_issued',
      actorType: 'admin',
      message: '签发离线激活响应码',
      payload: { requestCodeHash: hash.slice(0, 16) },
    });

    return {
      responseCode: Buffer.from(JSON.stringify(file), 'utf8').toString('base64url'),
      licenseFile: file,
    };
  }

  /** 离线机导入响应码：本地验签即可，但仍走一次服务端校验（可选）。 */
  async offlineActivate(dto: { responseCode: string }) {
    let file: LicenseFile;
    try {
      file = JSON.parse(Buffer.from(dto.responseCode, 'base64url').toString('utf8')) as LicenseFile;
    } catch {
      throw new AppError(ErrorCodes.OFFLINE_CODE_INVALID, '响应码内容损坏', 400);
    }
    const ok = await this.signer.verifyLicenseFile(file);
    if (!ok) throw new AppError(ErrorCodes.OFFLINE_CODE_INVALID, '响应码签名校验失败', 400);
    return { licenseFile: file, verified: true };
  }

  private async resolveById(id: string): Promise<ResolvedLicense | null> {
    const [row] = await this.db.select({ license: licenses, plan: plans, product: products })
      .from(licenses)
      .innerJoin(plans, eq(plans.id, licenses.planId))
      .innerJoin(products, eq(products.id, licenses.productId))
      .where(eq(licenses.id, id))
      .limit(1);
    return row ?? null;
  }

  /* ------------------------------------------------ 管理端：设备审批与解绑 */

  async listActivations(query: { page?: number; pageSize?: number; status?: string }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 20));
    const conditions = query.status
      ? [eq(licenseActivations.status, query.status as 'active')]
      : [];
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const items = await this.db.select({
      id: licenseActivations.id,
      licenseId: licenseActivations.licenseId,
      keyMasked: licenses.keyMasked,
      productName: products.name,
      deviceId: licenseActivations.deviceId,
      status: licenseActivations.status,
      activatedAt: licenseActivations.activatedAt,
      lastSeenAt: licenseActivations.lastSeenAt,
      ip: licenseActivations.ip,
      os: licenseActivations.os,
      appVersion: licenseActivations.appVersion,
    }).from(licenseActivations)
      .innerJoin(licenses, eq(licenses.id, licenseActivations.licenseId))
      .innerJoin(products, eq(products.id, licenses.productId))
      .where(where)
      .orderBy(desc(licenseActivations.lastSeenAt))
      .limit(pageSize).offset((page - 1) * pageSize);

    const [totalRow] = await this.db.select({ value: count() }).from(licenseActivations).where(where);
    return { items, total: Number(totalRow?.value ?? 0), page, pageSize };
  }

  async approveActivation(id: string, actor: { id?: string; email?: string }) {
    const [row] = await this.db.select().from(licenseActivations).where(eq(licenseActivations.id, id)).limit(1);
    if (!row) throw AppError.notFound('设备绑定记录不存在');
    if (row.status !== 'pending') throw AppError.conflict('该记录不是待审批状态');
    await this.db.update(licenseActivations).set({ status: 'active' }).where(eq(licenseActivations.id, id));
    const activeDevices = await this.countActiveDevices(row.licenseId);
    await this.db.update(licenses)
      .set({ activationCount: activeDevices, status: 'active', updatedAt: new Date() })
      .where(eq(licenses.id, row.licenseId));
    await this.recordEvent({
      licenseId: row.licenseId,
      type: 'activation_approved',
      actorType: 'admin',
      actorId: actor.id ?? null,
      actorLabel: actor.email ?? null,
      message: '管理员批准新设备',
      payload: { deviceId: row.deviceId },
    });
    return { ok: true, activeDevices };
  }

  async revokeActivation(id: string, actor: { id?: string; email?: string }, reason?: string) {
    const [row] = await this.db.select().from(licenseActivations).where(eq(licenseActivations.id, id)).limit(1);
    if (!row) throw AppError.notFound('设备绑定记录不存在');
    await this.db.update(licenseActivations)
      .set({ status: 'deactivated', deactivatedAt: new Date(), unbindReason: reason ?? 'admin_revoke' })
      .where(eq(licenseActivations.id, id));
    const activeDevices = await this.countActiveDevices(row.licenseId);
    await this.db.update(licenses).set({ activationCount: activeDevices, updatedAt: new Date() })
      .where(eq(licenses.id, row.licenseId));
    await this.recordEvent({
      licenseId: row.licenseId,
      type: 'deactivated',
      actorType: 'admin',
      actorId: actor.id ?? null,
      actorLabel: actor.email ?? null,
      message: reason ?? '管理员解绑设备',
      payload: { deviceId: row.deviceId },
    });
    return { ok: true, activeDevices };
  }

  async blacklistDevice(deviceId: string, blacklisted: boolean, reason: string | undefined, actor: { id?: string }) {
    const [row] = await this.db.select().from(devices).where(eq(devices.id, deviceId)).limit(1);
    if (!row) throw AppError.notFound('设备不存在');
    await this.db.update(devices)
      .set({ blacklisted, blacklistReason: blacklisted ? (reason ?? '管理员封禁') : null })
      .where(eq(devices.id, deviceId));
    if (blacklisted) {
      // 封禁设备时同步解绑其全部激活记录
      await this.db.update(licenseActivations)
        .set({ status: 'blocked', deactivatedAt: new Date(), unbindReason: 'device_blacklisted' })
        .where(and(eq(licenseActivations.deviceId, deviceId), eq(licenseActivations.status, 'active')));
    }
    if (blacklisted) {
      await this.webhooks.emit('device.blacklisted', {
        deviceId,
        reason: reason ?? '管理员封禁',
      }).catch(() => undefined);
    }
    void actor;
    return { ok: true, blacklisted };
  }

  async listDevices(query: { page?: number; pageSize?: number; q?: string }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 20));
    const where = query.q
      ? or(eq(devices.os, query.q), sql`${devices.name} ilike ${'%' + query.q + '%'}`)
      : undefined;
    const items = await this.db.select().from(devices).where(where)
      .orderBy(desc(devices.lastSeenAt)).limit(pageSize).offset((page - 1) * pageSize);
    const [totalRow] = await this.db.select({ value: count() }).from(devices).where(where);
    return { items, total: Number(totalRow?.value ?? 0), page, pageSize };
  }

  /** 定时任务：把过期授权置为 expired 并触发事件。 */
  async expireOverdue(): Promise<number> {
    const rows = await this.db.update(licenses)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(and(
        sql`${licenses.expiresAt} is not null and ${licenses.expiresAt} < now()`,
        inArray(licenses.status, ['issued', 'active', 'suspended']),
      ))
      .returning({ id: licenses.id });
    for (const row of rows) {
      await this.recordEvent({ licenseId: row.id, type: 'expired', actorType: 'system', message: '授权到期自动失效' });
    }
    return rows.length;
  }

  /** 供门户使用：客户自助解绑前的归属校验。 */
  async findLicenseForCustomer(licenseId: string, customerEmail: string) {
    const [row] = await this.db.select().from(licenses)
      .where(and(eq(licenses.id, licenseId), eq(licenses.customerEmail, customerEmail.toLowerCase())))
      .limit(1);
    if (!row) throw AppError.notFound('授权不存在或不属于当前账号');
    return row;
  }

  /** 保留：清理长期未使用的心跳日志（保留 90 天）。 */
  async cleanupVerificationLogs(days = 90): Promise<number> {
    const rows = await this.db.delete(verificationLogs)
      .where(sql`${verificationLogs.at} < now() - (${days} || ' days')::interval`)
      .returning({ id: verificationLogs.id });
    return rows.length;
  }
}