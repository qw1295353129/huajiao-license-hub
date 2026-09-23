/**
 * UI 冒烟：登录 → 遍历管理后台路由 → 收集 console 错误 + 截图。
 * 用法：CHROME_PATH=... WEB_URL=http://localhost:5273 node scripts/ui-smoke.cjs
 */
function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_PATH, 'playwright', '/Users/l21/Documents/novelcraft/node_modules/playwright'];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try { return require(candidate); } catch { /* next */ }
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
const ROUTES = (process.env.ROUTES || '/admin,/admin/products,/admin/licenses').split(',');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 2 });
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push('[console] ' + m.text().slice(0, 220)); });
  page.on('pageerror', (e) => problems.push('[pageerror] ' + e.message.slice(0, 220)));

  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.fill('input[type=email]', EMAIL);
  await page.fill('input[type=password]', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL('**/admin', { timeout: 15000 });

  const report = [];
  for (const route of ROUTES) {
    problems.length = 0;
    await page.goto(BASE + route, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1400);
    const text = ((await page.textContent('body')) || '').replace(/\s+/g, ' ');
    const name = route.replace(/\//g, '_') || '_root';
    await page.screenshot({ path: '/tmp/lh-view' + name + '.png', fullPage: false });
    report.push({ route, problems: [...problems], snippet: text.slice(0, 180) });
  }
  console.log(JSON.stringify(report, null, 1));
  await browser.close();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });