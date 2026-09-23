/**
 * UI 冒烟 + 截图脚本（开发期自查用，不参与构建）。
 * 用法：
 *   CHROME_PATH="<chrome 可执行文件>" WEB_URL=http://localhost:5273 node scripts/screenshot.cjs
 * 需要本机可用的 playwright（可用 PLAYWRIGHT_PATH 指定安装位置）。
 */
function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_PATH, 'playwright', '/Users/l21/Documents/novelcraft/node_modules/playwright'];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try { return require(candidate); } catch { /* 试下一个 */ }
  }
  throw new Error('未找到 playwright，请设置 PLAYWRIGHT_PATH 指向 playwright 安装目录');
}
const { chromium } = loadPlaywright();
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  await page.goto((process.env.WEB_URL || 'http://localhost:5273') + '/login', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: '/tmp/lh-login.png' });
  const base = process.env.WEB_URL || 'http://localhost:5273';
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(base);
  const email = process.env.ADMIN_EMAIL || (isLocal ? 'admin@licensehub.local' : null);
  const password = process.env.ADMIN_PASSWORD || (isLocal ? 'Admin@12345' : null);
  if (!email || !password) {
    throw new Error('非本机目标必须设置 ADMIN_EMAIL 与 ADMIN_PASSWORD');
  }
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', password);
  await page.click('button[type=submit]');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/lh-dashboard.png' });
  const url = page.url();
  const bodyText = (await page.textContent('body')) || '';
  console.log(JSON.stringify({ url, problems: problems.slice(0, 8), hasKpi: bodyText.includes('授权总数'), snippet: bodyText.replace(/\s+/g, ' ').slice(0, 260) }, null, 1));
  await browser.close();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });