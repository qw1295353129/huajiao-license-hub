/**
 * UI 冒烟：登录 → 授权管理 → 新建单个授权 → 校验列表与授权码。
 * 每次运行会真实创建 1 条授权（备注标注为冒烟测试）。
 * 用法：CHROME_PATH=... WEB_URL=http://localhost:5273 node scripts/license-create-smoke.cjs
 */
function loadPlaywright() {
  for (const c of [process.env.PLAYWRIGHT_PATH, 'playwright', '/Users/l21/Documents/novelcraft/node_modules/playwright']) {
    if (!c) continue;
    try { return require(c); } catch {}
  }
  throw new Error('未找到 playwright');
}
const { chromium } = loadPlaywright();
const BASE = process.env.WEB_URL || 'http://localhost:5273';
const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(BASE);
const EMAIL = process.env.ADMIN_EMAIL || (isLocal ? 'admin@licensehub.local' : null);
const PASSWORD = process.env.ADMIN_PASSWORD || (isLocal ? 'Admin@12345' : null);
if (!EMAIL || !PASSWORD) {
  throw new Error('非本机目标必须设置 ADMIN_EMAIL 与 ADMIN_PASSWORD（禁止默认口令打生产）');
}
const PRODUCT_NAME = process.env.PRODUCT_NAME || '示例软件 DemoApp';
const PLAN_NAME = process.env.PLAN_NAME || '专业版 · 年付';

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 950 },
    deviceScaleFactor: 2,
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push('[console] ' + m.text().slice(0, 200)); });
  page.on('pageerror', (e) => problems.push('[pageerror] ' + e.message.slice(0, 200)));

  const steps = [];

  // 登录
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.fill('input[type=email]', EMAIL);
  await page.fill('input[type=password]', PASSWORD);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 }),
    page.click('button[type=submit]'),
  ]);
  steps.push({ name: '登录', ok: true, detail: page.url() });

  // 打开授权列表
  await page.goto(BASE + '/admin/licenses', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  // 新建授权弹窗
  await page.getByRole('button', { name: '新建授权' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ state: 'visible', timeout: 5000 });

  const triggers = dialog.locator('button[aria-haspopup="listbox"]');
  await triggers.nth(0).click();
  await page.getByRole('option', { name: new RegExp(PRODUCT_NAME) }).click();
  await triggers.nth(1).click();
  await page.getByRole('option', { name: new RegExp(PLAN_NAME) }).click();

  const note = 'UI 冒烟测试 ' + new Date().toISOString();
  await dialog.getByPlaceholder('buyer@example.com').fill('ui-smoke@example.com');
  await dialog.locator('textarea').fill(note);
  await page.screenshot({ path: '/tmp/lh-license-create-form.png' });

  // 提交并拿到明文授权码（响应体只在此刻出现）
  const [resp] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/api/admin/licenses') && r.request().method() === 'POST',
      { timeout: 15000 },
    ),
    dialog.getByRole('button', { name: '创建并复制授权码' }).click(),
  ]);
  const body = await resp.json();
  steps.push({ name: '创建请求', ok: resp.ok(), detail: resp.status() + ' ' + resp.statusText() });

  const key = body.keyFormatted || '';
  const masked = key ? key.slice(0, 4) + '-****-****-' + key.slice(-4) : '';
  steps.push({ name: '返回明文授权码', ok: /^[A-Z0-9]+(-[A-Z0-9]+){3}$/.test(key), detail: key });

  // 成功提示 + 授权码进剪贴板
  await page.getByText(/授权已创建|复制失败/).first().waitFor({ state: 'visible', timeout: 8000 });
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  steps.push({ name: '剪贴板授权码', ok: clip === key, detail: clip });

  // 列表刷新后出现该授权的掩码行
  await page.waitForTimeout(1200);
  const rowVisible = await page.getByText(masked).first().isVisible().catch(() => false);
  steps.push({ name: '列表出现新授权', ok: rowVisible, detail: masked });
  await page.screenshot({ path: '/tmp/lh-license-created.png' });

  steps.push({ name: '无 JS 运行时错误', ok: problems.length === 0, detail: problems.join('; ') });

  console.log(JSON.stringify(steps, null, 1));
  const failed = steps.filter((s) => !s.ok);
  await browser.close();
  if (failed.length) {
    console.error('FAILED', failed.length + ' 项未通过');
    process.exit(1);
  }
  console.log('PASS 全部通过');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
