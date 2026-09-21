import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../config/configuration';
import { CryptoService, canonicalJson } from './crypto.service';
import { generateTotpSecret, totpCode, verifyTotp } from './totp';

process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-jwt-secret-0123456789abcdefghijklmn';
process.env.LICENSE_PEPPER = process.env.LICENSE_PEPPER ?? 'test-license-pepper-0123456789abcdef';
process.env.DATA_KEY = process.env.DATA_KEY ?? Buffer.alloc(32, 3).toString('base64');

const crypto = new CryptoService(loadConfig());

describe('CryptoService', () => {
  it('口令哈希可验证且不同盐产生不同结果', () => {
    const a = crypto.hashPassword('S3cret-pass');
    const b = crypto.hashPassword('S3cret-pass');
    assert.notEqual(a, b);
    assert.ok(a.startsWith('scrypt$'));
    assert.equal(crypto.verifyPassword('S3cret-pass', a), true);
    assert.equal(crypto.verifyPassword('wrong', a), false);
    assert.equal(crypto.verifyPassword('S3cret-pass', null), false);
  });

  it('AES-256-GCM 加解密可往返，篡改密文会失败', () => {
    const plain = 'LHAB-9F3K-7M2P-XQ4T';
    const enc = crypto.encrypt(plain);
    assert.notEqual(enc, plain);
    assert.equal(crypto.decrypt(enc), plain);

    const parts = enc.split('.');
    const tampered = [parts[0], parts[1], parts[2], Buffer.from('evil').toString('base64url')].join('.');
    assert.throws(() => crypto.decrypt(tampered));
  });

  it('盲索引稳定、区分命名空间、不可逆', () => {
    assert.equal(crypto.blindIndex('LHAB-9F3K-7M2P-XQ4T'), crypto.blindIndex('lhab-9f3k-7m2p-xq4t'));
    assert.notEqual(crypto.blindIndex('AAA', 'license'), crypto.blindIndex('AAA', 'redeem'));
    assert.equal(crypto.blindIndex('AAA').length, 64);
    assert.ok(!crypto.blindIndex('AAA').includes('AAA'));
  });

  it('Ed25519 签名可被验签，改一个字节即失败', () => {
    const { publicKey, privateKey } = crypto.generateSigningKeyPair();
    const payload = { licenseId: 'x', features: ['a', 'b'], expiresAt: null };
    const sig = crypto.signPayload(payload, privateKey);
    assert.equal(crypto.verifyPayload(payload, sig, publicKey), true);
    assert.equal(crypto.verifyPayload({ ...payload, licenseId: 'y' }, sig, publicKey), false);
    assert.equal(crypto.verifyPayload(payload, 'AAAA', publicKey), false);
  });

  it('规范化 JSON 与键顺序无关', () => {
    assert.equal(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } }),
      canonicalJson({ a: { c: [3, { e: 5, f: 4 }], d: 2 }, b: 1 }));
  });

  it('生成的授权码长度正确且不含易混字符', () => {
    const code = crypto.generateCode(16);
    assert.equal(code.length, 16);
    assert.ok(!/[ILOU]/.test(code));
  });

  it('TOTP 动态码可验证，窗口外失败', () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const code = totpCode(secret, now);
    assert.equal(verifyTotp(secret, code, 1, now), true);
    assert.equal(verifyTotp(secret, code, 0, now + 120_000), false);
    assert.equal(verifyTotp(secret, 'abcdef', 1, now), false);
  });
});
