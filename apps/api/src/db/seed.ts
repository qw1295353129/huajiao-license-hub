/* eslint-disable no-console */
/**
 * 演示数据：签名密钥、示例产品/策略/功能点、一个接入方 API Key。
 * 幂等：已存在的数据不会重复创建；API Key 明文只在本次输出中出现一次。
 */
import { eq } from 'drizzle-orm';
import { loadEnvFiles } from '../config/load-env';
import { loadConfig } from '../config/configuration';
import { CryptoService } from '../crypto/crypto.service';
import { createDatabase } from './db.provider';
import { runMigrations } from './migrate';
import { apiKeys, plans, productFeatures, products, signingKeys } from './schema';

async function main(): Promise<void> {
  loadEnvFiles();
  const config = loadConfig();
  await runMigrations(config, (msg) => console.log('[seed] ' + msg));

  const handle = await createDatabase(config);
  const crypto = new CryptoService(config);
  const db = handle.db;

  try {
    /* ---------- 1. 授权文件签名密钥 ---------- */
    const activeKeys = await db.select().from(signingKeys).where(eq(signingKeys.status, 'active')).limit(1);
    if (activeKeys.length === 0) {
      const pair = crypto.generateSigningKeyPair();
      const kid = 'lk-' + new Date().toISOString().slice(0, 7);
      await db.insert(signingKeys).values({
        kid,
        publicKey: pair.publicKey,
        privateKeyEnc: crypto.encrypt(pair.privateKey),
        status: 'active',
      });
      console.log('[seed] 已生成 Ed25519 签名密钥 kid=' + kid);
      console.log('[seed] 公钥（可内置到客户端）：' + pair.publicKey);
    } else {
      console.log('[seed] 已存在有效签名密钥：' + activeKeys[0].kid);
    }

    /* ---------- 2. 示例产品 ---------- */
    let [product] = await db.select().from(products).where(eq(products.slug, 'demo-app')).limit(1);
    if (!product) {
      [product] = await db.insert(products).values({
        slug: 'demo-app',
        name: '示例软件 DemoApp',
        description: '用于演示授权流程的示例产品，可随时删除。',
        status: 'active',
        keyPrefix: 'DEMO',
      }).returning();
      console.log('[seed] 已创建示例产品：' + product.name);
    } else {
      console.log('[seed] 示例产品已存在：' + product.name);
    }

    const featureDefs = [
      { key: 'pro-mode', name: '专业模式', description: '解锁高级编辑能力' },
      { key: 'export-pdf', name: 'PDF 导出', description: '导出为 PDF' },
      { key: 'cloud-sync', name: '云同步', description: '多设备同步数据' },
    ];
    for (const feature of featureDefs) {
      const existing = await db.select().from(productFeatures)
        .where(eq(productFeatures.key, feature.key)).limit(1);
      if (existing.length === 0) {
        await db.insert(productFeatures).values({ productId: product.id, ...feature });
      }
    }

    /* ---------- 3. 示例策略 ---------- */
    const planDefs = [
      {
        code: 'trial-14', name: '14 天试用', licenseType: 'trial' as const,
        durationDays: 14, maxDevices: 1, featureKeys: ['pro-mode'], priceCents: 0,
      },
      {
        code: 'pro-yearly', name: '专业版 · 年付', licenseType: 'subscription' as const,
        durationDays: 365, maxDevices: 3, featureKeys: ['pro-mode', 'export-pdf', 'cloud-sync'], priceCents: 19900,
      },
      {
        code: 'pro-lifetime', name: '专业版 · 买断', licenseType: 'perpetual' as const,
        durationDays: null, maxDevices: 3, featureKeys: ['pro-mode', 'export-pdf', 'cloud-sync'], priceCents: 49900,
      },
    ];
    for (const def of planDefs) {
      const existing = await db.select().from(plans).where(eq(plans.code, def.code)).limit(1);
      if (existing.length === 0) {
        await db.insert(plans).values({ productId: product.id, ...def });
        console.log('[seed] 已创建策略：' + def.name);
      }
    }

    /* ---------- 4. 接入方 API Key ---------- */
    const existingKeys = await db.select().from(apiKeys).where(eq(apiKeys.name, '示例客户端')).limit(1);
    if (existingKeys.length === 0) {
      const raw = 'lh_live_' + crypto.randomToken(24);
      await db.insert(apiKeys).values({
        name: '示例客户端',
        keyLookup: crypto.blindIndex(raw, 'apikey'),
        keyEnc: crypto.encrypt(raw),
        keyMasked: raw.slice(0, 12) + '****' + raw.slice(-4),
        scopes: ['license:read', 'license:activate', 'license:verify', 'license:deactivate', 'license:trial'],
      });
      console.log('');
      console.log('[seed] ✅ 已创建示例 API Key（仅本次显示，请立即保存）：');
      console.log('       ' + raw);
      console.log('');
    } else {
      console.log('[seed] 示例 API Key 已存在（明文不可再查，如需请到后台吊销后重建）');
    }

    console.log('[seed] 完成。下一步：pnpm dev 启动前后端，浏览器打开 http://localhost:5273');
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  console.error('[seed] 失败：', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});