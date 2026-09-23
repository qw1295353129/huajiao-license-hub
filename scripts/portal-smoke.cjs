/** 用户门户 UI 冒烟：登录 → 遍历门户路由 → 收集 console 错误 + 截图 */
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
const EMAIL = process.env.PORTAL_EMAIL || (isLocal ? 'demo@example.com' : null);
const PASSWORD = process.env.PORTAL_PASSWORD || (isLocal ? 'Demo12345' : null);
if (!EMAIL || !PASSWORD) {
  throw new Error('非本机目标必须设置 PORTAL_EMAIL 与 PORTAL_PASSWORD');
}
const ROUTES = (process.env.ROUTES || '/portal/licenses,/portal/orders,/portal/redeem,/portal/account').split(',');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
  const page = await browser.newPage({ viewport: { width: 1280, height: 950 }, deviceScaleFactor: 2 });
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push('[console] ' + m.text().slice(0, 200)); });
  page.on('pageerror', (e) => problems.push('[pageerror] ' + e.message.slice(0, 200)));

  await page.goto(BASE + '/portal/login', { waitUntil: 'networkidle' });
  await page.fill('input[type=email]', EMAIL);
  await page.fill('input[type=password]', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForTimeout(2500);
  console.log('登录后地址:', page.url());

  const report = [];
  for (const route of ROUTES) {
    problems.length = 0;
    await page.goto(BASE + route, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    const text = ((await page.textContent('body')) || '').replace(/\s+/g, ' ');
    await page.screenshot({ path: '/tmp/lh-portal' + route.replace(/\//g, '_') + '.png' });
    report.push({ route, errors: problems.length, problems: [...problems], snippet: text.slice(0, 150) });
  }
  console.log(JSON.stringify(report, null, 1));
  await browser.close();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });