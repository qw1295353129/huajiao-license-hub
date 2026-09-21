import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { CONFIG_TOKEN, type AppConfig } from '../../config/configuration';
import { CryptoService } from '../../crypto/crypto.service';
import { DB } from '../../db/db.module';
import type { DatabaseHandle } from '../../db/db.provider';
import { settings } from '../../db/schema';

export interface SiteSettings {
  siteName: string;
  allowRegistration: boolean;
  defaultCurrency: string;
  trialDays: number;
  selfUnbindPer30d: number;
  expireReminderDays: number[];
}

export const DEFAULT_SETTINGS: SiteSettings = {
  siteName: 'LicenseHub',
  allowRegistration: true,
  defaultCurrency: 'CNY',
  trialDays: 14,
  selfUnbindPer30d: 3,
  expireReminderDays: [7, 3, 1],
};

/** 站点设置：键值表 + 代码内默认值，读到就合并，缺项不会导致崩溃。 */
@Injectable()
export class SettingsService {
  constructor(
    @Inject(DB) private readonly handle: DatabaseHandle,
    @Inject(CONFIG_TOKEN) private readonly config: AppConfig,
    private readonly crypto: CryptoService,
  ) {}

  private get db() {
    return this.handle.db;
  }

  async get(): Promise<SiteSettings> {
    const rows = await this.db.select().from(settings).where(eq(settings.key, 'site'));
    if (rows.length === 0) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(rows[0].value as Partial<SiteSettings>) };
  }

  async update(patch: Partial<SiteSettings>): Promise<SiteSettings> {
    const current = await this.get();
    const next = { ...current, ...patch };
    const existing = await this.db.select().from(settings).where(eq(settings.key, 'site'));
    if (existing.length === 0) {
      await this.db.insert(settings).values({ key: 'site', value: next });
    } else {
      await this.db.update(settings).set({ value: next, updatedAt: new Date() }).where(eq(settings.key, 'site'));
    }
    return next;
  }

  /** 读取加密存储的第三方密钥（如支付回调签名密钥），不存在则返回 null。 */
  async getSecret(key: string): Promise<string | null> {
    const rows = await this.db.select().from(settings).where(eq(settings.key, 'secret:' + key));
    if (rows.length === 0) return null;
    const value = rows[0].value as { enc?: string };
    if (!value?.enc) return null;
    try {
      return this.crypto.decrypt(value.enc);
    } catch {
      return null;
    }
  }

  async setSecret(key: string, plain: string): Promise<{ masked: string }> {
    const payload = { enc: this.crypto.encrypt(plain) };
    const existing = await this.db.select().from(settings).where(eq(settings.key, 'secret:' + key));
    if (existing.length === 0) {
      await this.db.insert(settings).values({ key: 'secret:' + key, value: payload });
    } else {
      await this.db.update(settings).set({ value: payload, updatedAt: new Date() }).where(eq(settings.key, 'secret:' + key));
    }
    return { masked: plain.slice(0, 4) + '****' + plain.slice(-4) };
  }

  async listSecrets(): Promise<{ key: string; configured: boolean }[]> {
    const keys = ['payments.generic.secret', 'payments.stripe.secret'];
    const rows = await this.db.select().from(settings);
    const configured = new Set(rows.filter((row) => row.key.startsWith('secret:')).map((row) => row.key.slice(7)));
    return keys.map((key) => ({ key, configured: configured.has(key) }));
  }

  /** 首次启动时若站点名为空则写入默认值，便于前端直接展示。 */
  async ensureInitialized(): Promise<void> {
    const rows = await this.db.select().from(settings).where(eq(settings.key, 'site'));
    if (rows.length === 0) {
      await this.db.insert(settings).values({ key: 'site', value: DEFAULT_SETTINGS });
    }
  }

  get origin(): string {
    return this.config.appOrigin;
  }
}
