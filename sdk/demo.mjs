/**
 * 端到端演示：模拟一个接入方软件完成 激活 → 心跳 → 离线验签 → 解绑。
 *
 * 运行：node sdk/demo.mjs <API_KEY> [LICENSE_KEY] [BASE_URL]
 * 其中 API_KEY 在后台「API Key」页面创建，LICENSE_KEY 在「授权管理」里创建。
 */
import { createHash } from 'node:crypto';

const BASE_URL = process.argv[4] ?? 'http://localhost:3000';
const API_KEY = process.argv[2];
const LICENSE_KEY = process.argv[3];

if (!API_KEY) {
  console.error('用法：node sdk/demo.mjs <API_KEY> [LICENSE_KEY] [BASE_URL]');
  process.exit(1);
}

async function call(path, body, method = 'POST') {
  const res = await fetch(BASE_URL + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': API_KEY },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** 客户端视角的规范化 JSON（与服务端一致） */
function canonicalize(value) {
  const sort = (input) => {
    if (Array.isArray(input)) return input.map(sort);
    if (input && typeof input === 'object') {
      return Object.fromEntries(
        Object.entries(input).filter(([, v]) => v !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, v]) => [k, sort(v)]),
      );
    }
    return input;
  };
  return JSON.stringify(sort(value));
}

function b64urlToBytes(input) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized + '='.repeat((4 - (normalized.length % 4)) % 4), 'base64');
}

const device = {
  fingerprint: createHash('sha256').update('demo-machine-serial-001').digest('hex').slice(0, 32),
  name: '演示工作站',
  os: process.platform,
  appVersion: '1.0.0',
};

console.log('== 1. 获取验签公钥 ==');
const pk = await call('/api/v1/public-key', undefined, 'GET');
console.log('   kid:', pk.body?.current?.kid, '| 状态', pk.status);
const publicKey = pk.body?.current?.publicKey;

if (LICENSE_KEY) {
  console.log('== 2. 激活授权 ==');
  const activated = await call('/api/v1/activate', { licenseKey: LICENSE_KEY, product: 'demo-app', device });
  console.log('   status:', activated.status);
  if (activated.status === 201) {
    console.log('   权益:', JSON.stringify(activated.body.entitlements));
    const file = activated.body.licenseFile;

    console.log('== 3. 客户端本地验签（离线可判定）==');
    const { sig, ...payload } = file;
    const key = await crypto.subtle.importKey('spki', b64urlToBytes(publicKey), { name: 'Ed25519' }, false, ['verify']);
    const ok = await crypto.subtle.verify(
      { name: 'Ed25519' }, key, b64urlToBytes(sig), new TextEncoder().encode(canonicalize(payload)),
    );
    console.log('   验签结果:', ok ? '✅ 通过' : '❌ 失败');

    const tampered = { ...payload, maxDevices: 999 };
    const bad = await crypto.subtle.verify(
      { name: 'Ed25519' }, key, b64urlToBytes(sig), new TextEncoder().encode(canonicalize(tampered)),
    );
    console.log('   篡改后验签:', bad ? '❌ 竟然通过（严重问题）' : '✅ 正确拒绝');

    console.log('== 4. 心跳校验（令牌快路径）==');
    const heartbeat = await call('/api/v1/verify', { accessToken: activated.body.accessToken, device });
    console.log('   status:', heartbeat.status, '| valid:', heartbeat.body.valid, '| 剩余天数:',
      heartbeat.body.expiresAt ? Math.ceil((new Date(heartbeat.body.expiresAt) - Date.now()) / 86400000) : '永久');

    console.log('== 5. 解绑设备 ==');
    const off = await call('/api/v1/deactivate', { licenseKey: LICENSE_KEY, device, reason: 'demo 结束' });
    console.log('   status:', off.status, '| 释放设备数:', off.body?.releasedDevices, '| 当前设备:', off.body?.activeDevices);
  } else {
    console.log('   错误:', JSON.stringify(activated.body));
  }
} else {
  console.log('（未提供 LICENSE_KEY，跳过激活流程）');
}

console.log('== 6. 无 Key / 错 Key 的拒绝行为 ==');
const noKey = await fetch(BASE_URL + '/api/v1/public-key');
console.log('   不带 X-Api-Key:', noKey.status, JSON.stringify(await noKey.json()).slice(0, 80));
