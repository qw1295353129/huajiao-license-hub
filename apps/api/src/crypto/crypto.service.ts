import {
  createCipheriv, createDecipheriv, createHmac, createPrivateKey, createPublicKey,
  generateKeyPairSync, randomBytes, randomUUID, scryptSync, sign as edSign, timingSafeEqual, verify as edVerify,
} from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { CONFIG_TOKEN, type AppConfig } from '../config/configuration';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

/**
 * 统一密码学出口：口令哈希、对称加密、盲索引、Ed25519 签名、随机串。
 * 业务代码禁止直接调用 node:crypto，避免密钥散落各处。
 */
@Injectable()
export class CryptoService {
  constructor(@Inject(CONFIG_TOKEN) private readonly config: AppConfig) {}

  /* ---------------- 口令 ---------------- */

  hashPassword(password: string): string {
    const salt = randomBytes(16);
    const hash = scryptSync(password.normalize('NFKC'), salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
    return ['scrypt', SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString('base64'), hash.toString('base64')].join('$');
  }

  verifyPassword(password: string, stored: string | null | undefined): boolean {
    if (!stored) return false;
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, n, r, p, saltB64, hashB64] = parts;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = scryptSync(password.normalize('NFKC'), salt, expected.length, {
      N: Number(n), r: Number(r), p: Number(p),
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  /* ---------------- 对称加密（AES-256-GCM） ---------------- */

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.config.security.dataKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
  }

  decrypt(payload: string): string {
    const parts = payload.split('.');
    if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('密文格式非法');
    const [, ivB64, tagB64, dataB64] = parts;
    const decipher = createDecipheriv('aes-256-gcm', this.config.security.dataKey, Buffer.from(ivB64, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]).toString('utf8');
  }

  /* ---------------- 盲索引 ---------------- */

  /** 授权码/卡密/API Key 的不可逆索引：库中无明文也能精确查询。 */
  blindIndex(value: string, namespace = 'license'): string {
    return createHmac('sha256', this.config.security.licensePepper)
      .update(namespace + ':' + value.trim().toUpperCase())
      .digest('hex');
  }

  /** 设备指纹等隐私数据：单独命名空间，避免与授权码索引混用。 */
  fingerprintHash(fingerprint: string): string {
    return createHmac('sha256', this.config.security.licensePepper)
      .update('device:' + fingerprint.trim())
      .digest('hex');
  }

  sha256(value: string): string {
    return createHmac('sha256', this.config.security.jwtSecret).update(value).digest('hex');
  }

  /* ---------------- Ed25519 授权文件签名 ---------------- */

  generateSigningKeyPair(): { publicKey: string; privateKey: string } {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    return {
      publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
      privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64url'),
    };
  }

  signPayload(payload: unknown, privateKeyB64: string): string {
    const key = createPrivateKey({ key: Buffer.from(privateKeyB64, 'base64url'), format: 'der', type: 'pkcs8' });
    const data = Buffer.from(canonicalJson(payload), 'utf8');
    return edSign(null, data, key).toString('base64url');
  }

  verifyPayload(payload: unknown, signature: string, publicKeyB64: string): boolean {
    try {
      const key = createPublicKey({ key: Buffer.from(publicKeyB64, 'base64url'), format: 'der', type: 'spki' });
      return edVerify(null, Buffer.from(canonicalJson(payload), 'utf8'), key, Buffer.from(signature, 'base64url'));
    } catch {
      return false;
    }
  }

  /* ---------------- 随机串 ---------------- */

  randomToken(bytes = 32): string {
    return randomBytes(bytes).toString('base64url');
  }

  randomHex(bytes = 16): string {
    return randomBytes(bytes).toString('hex');
  }

  newId(): string {
    return randomUUID();
  }

  /** 生成符合 2^60 以上空间、去除易混字符的授权码。 */
  generateCode(length = 16, alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'): string {
    const max = Math.floor(256 / alphabet.length) * alphabet.length;
    let out = '';
    while (out.length < length) {
      for (const byte of randomBytes(length * 2)) {
        if (byte >= max) continue;
        out += alphabet[byte % alphabet.length];
        if (out.length === length) break;
      }
    }
    return out;
  }
}

/** 规范化 JSON：键按字典序、无空白 —— 签名与验签必须使用同一算法。 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([k, v]) => [k, sortDeep(v)]));
  }
  return value;
}
