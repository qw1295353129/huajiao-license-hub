import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { JwtService } from '@nestjs/jwt';
import type { DomainLicenseFile, LicenseFile } from '@license-hub/shared';
import { CryptoService, canonicalJson } from '../../crypto/crypto.service';
import { DB } from '../../db/db.module';
import type { DatabaseHandle } from '../../db/db.provider';
import { signingKeys } from '../../db/schema';
import { AppError } from '../../common/errors';

export interface LicenseFilePayload {
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
  offlineGraceDays: number;
  remainingUsages: number | null;
  nonce: string;
}

/**
 * 授权文件签名：Ed25519，客户端内置公钥即可离线验签。
 * 私钥以 AES-256-GCM 加密后入库，支持 kid 轮换（旧公钥保留，历史授权仍可验签）。
 */
@Injectable()
export class LicenseSignerService implements OnApplicationBootstrap {
  private readonly logger = new Logger('LicenseSigner');
  private cachedPrivateKey: string | null = null;
  private cachedKid: string | null = null;

  constructor(
    @Inject(DB) private readonly handle: DatabaseHandle,
    private readonly crypto: CryptoService,
    private readonly jwt: JwtService,
  ) {}

  private get db() {
    return this.handle.db;
  }

  async onApplicationBootstrap(): Promise<void> {
    const active = await this.getActiveKey();
    if (!active) {
      const created = await this.createKey();
      this.logger.warn('未找到签名密钥，已自动生成：kid=' + created.kid);
      this.logger.warn('公钥（请内置到客户端）：' + created.publicKey);
    } else {
      this.logger.log('签名密钥就绪：kid=' + active.kid);
    }
  }

  async getActiveKey() {
    const [row] = await this.db.select().from(signingKeys)
      .where(eq(signingKeys.status, 'active'))
      .orderBy(desc(signingKeys.createdAt))
      .limit(1);
    return row ?? null;
  }

  /** 所有公钥（含已轮换的），供客户端按 kid 验签。 */
  async listPublicKeys() {
    const rows = await this.db.select({
      kid: signingKeys.kid,
      algo: signingKeys.algo,
      publicKey: signingKeys.publicKey,
      status: signingKeys.status,
      createdAt: signingKeys.createdAt,
      rotatedAt: signingKeys.rotatedAt,
    }).from(signingKeys).orderBy(desc(signingKeys.createdAt));
    return rows;
  }

  async createKey(actorId?: string) {
    const pair = this.crypto.generateSigningKeyPair();
    const suffix = await this.nextKidSuffix();
    const kid = 'lk-' + new Date().toISOString().slice(0, 7) + '-' + suffix;
    const [row] = await this.db.insert(signingKeys).values({
      kid,
      publicKey: pair.publicKey,
      privateKeyEnc: this.crypto.encrypt(pair.privateKey),
      status: 'active',
      createdBy: actorId ?? null,
    }).returning();
    this.cachedKid = null;
    this.cachedPrivateKey = null;
    return row;
  }

  private async nextKidSuffix(): Promise<string> {
    const rows = await this.db.select({ kid: signingKeys.kid }).from(signingKeys);
    const used = new Set(rows.map((row) => row.kid));
    for (let i = 1; i < 1000; i += 1) {
      const candidate = String(i).padStart(2, '0');
      const kid = 'lk-' + new Date().toISOString().slice(0, 7) + '-' + candidate;
      if (!used.has(kid)) return candidate;
    }
    return String(Date.now()).slice(-4);
  }

  /** 轮换：新密钥置为 active，旧密钥置为 retired（仍可验签，不再签发）。 */
  async rotate(actorId?: string) {
    const previous = await this.getActiveKey();
    if (previous) {
      await this.db.update(signingKeys)
        .set({ status: 'retired', rotatedAt: new Date() })
        .where(eq(signingKeys.id, previous.id));
    }
    const created = await this.createKey(actorId);
    return { previousKid: previous?.kid ?? null, current: created };
  }

  private async loadPrivateKey(): Promise<{ kid: string; privateKey: string }> {
    if (this.cachedPrivateKey && this.cachedKid) {
      return { kid: this.cachedKid, privateKey: this.cachedPrivateKey };
    }
    const active = await this.getActiveKey();
    if (!active) throw AppError.conflict('尚未生成签名密钥，请先在后台创建签名密钥');
    this.cachedKid = active.kid;
    this.cachedPrivateKey = this.crypto.decrypt(active.privateKeyEnc);
    return { kid: this.cachedKid, privateKey: this.cachedPrivateKey };
  }

  /** 生成带签名的授权文件。 */
  async sign(payload: Omit<LicenseFilePayload, 'v' | 'kid' | 'issuedAt' | 'nonce'> & { nonce?: string }): Promise<LicenseFile> {
    const { kid, privateKey } = await this.loadPrivateKey();
    const body: LicenseFilePayload = {
      ...payload,
      v: 1,
      kid,
      issuedAt: new Date().toISOString(),
      nonce: payload.nonce ?? this.crypto.randomHex(8),
    };
    const sig = this.crypto.signPayload(body, privateKey);
    return { ...body, sig } as LicenseFile;
  }

  /**
   * 签发域名授权文件（与设备授权文件不同的类型与字段）。
   * 客户端内置同一把公钥即可验签。
   */
  async signDomain(payload: Omit<DomainLicenseFile, 'v' | 'kid' | 'type' | 'issuedAt' | 'nonce' | 'sig'> & { nonce?: string }): Promise<DomainLicenseFile> {
    const { kid, privateKey } = await this.loadPrivateKey();
    const body: Omit<DomainLicenseFile, 'sig'> = {
      ...payload,
      v: 1,
      kid,
      type: 'domain',
      issuedAt: new Date().toISOString(),
      nonce: payload.nonce ?? this.crypto.randomHex(8),
    };
    const sig = this.crypto.signPayload(body, privateKey);
    return { ...body, sig };
  }

  /** 域名授权的客户端令牌（短期，用于心跳快路径）。 */
  async signDomainClientToken(payload: { sub: string; domain: string; aud: string }, ttlSeconds: number): Promise<string> {
    return this.jwt.signAsync(payload, { expiresIn: ttlSeconds });
  }

  /** 校验域名授权文件（供离线/服务端自检使用）。 */
  async verifyDomainFile(file: DomainLicenseFile): Promise<boolean> {
    const { sig, ...payload } = file;
    const keys = await this.listPublicKeys();
    const key = keys.find((row) => row.kid === file.kid);
    if (!key) return false;
    return this.crypto.verifyPayload(payload, sig, key.publicKey);
  }

  /** 本地自检：用公钥验证刚签发的文件（防止密钥与实现不一致）。 */
  async verifyLicenseFile(file: LicenseFile): Promise<boolean> {
    const { sig, ...payload } = file;
    const keys = await this.listPublicKeys();
    const key = keys.find((row) => row.kid === file.kid);
    if (!key) return false;
    return this.crypto.verifyPayload(payload, sig, key.publicKey);
  }

  /** 供离线包使用：返回规范化 JSON（客户端按同一规则验签）。 */
  canonicalize(file: LicenseFile): string {
    const { sig, ...payload } = file;
    void sig;
    return canonicalJson(payload);
  }
}