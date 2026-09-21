/** 线上冒烟：真实服务端 → 本地接收器 的 Webhook 投递与验签 */
const { createServer } = require('node:http');
const { createHmac } = require('node:crypto');

const BASE = process.env.BASE || 'http://localhost:3000';
const hits = [];

async function call(path, body, token, method = 'POST') {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

(async () => {
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => { hits.push({ headers: req.headers, raw }); res.writeHead(200); res.end('{"ok":true}'); });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const login = await call('/api/admin/auth/login', { email: 'admin@licensehub.local', password: 'Admin@12345' });
  const token = login.body.tokens.accessToken;

  const created = await call('/api/admin/webhooks', {
    url: 'http://127.0.0.1:' + port + '/receiver',
    description: '线上冒烟接收端',
    events: ['license.created', 'order.paid'],
  }, token);
  console.log('创建端点:', created.status, '密钥前缀:', created.body.secret.slice(0, 12) + '…');
  const secret = created.body.secret;
  const endpointId = created.body.endpoint.id;

  const products = await call('/api/admin/products', undefined, token, 'GET');
  const productId = products.body.items[0].id;
  const plans = await call('/api/admin/products/' + productId + '/plans', undefined, token, 'GET');
  const planId = plans.body.find((p) => p.code === 'pro-yearly').id;

  const issued = await call('/api/admin/licenses', { productId, planId, customerEmail: 'live-hook@example.com' }, token);
  console.log('发放授权:', issued.status, issued.body.license.keyMasked);

  const run = await call('/api/admin/tasks/run', { task: 'webhook-deliveries' }, token);
  console.log('触发投递任务:', run.status, JSON.stringify(run.body.detail));

  const hit = hits.find((h) => h.headers['x-lh-event'] === 'license.created');
  if (!hit) { console.log('❌ 未收到投递'); process.exit(1); }
  const ts = String(hit.headers['x-lh-timestamp']);
  const expected = 'sha256=' + createHmac('sha256', secret).update(ts + '.' + hit.raw).digest('hex');
  console.log('接收端验签:', hit.headers['x-lh-signature'] === expected ? '✅ 通过' : '❌ 不匹配');
  console.log('事件负载:', JSON.stringify(JSON.parse(hit.raw)).slice(0, 160));

  const test = await call('/api/admin/webhooks/' + endpointId + '/test', {}, token);
  console.log('测试投递:', test.status, 'ok=' + test.body.ok, 'HTTP ' + test.body.status);

  await call('/api/admin/webhooks/' + endpointId, undefined, token, 'DELETE');
  console.log('已清理测试端点');
  server.close();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });