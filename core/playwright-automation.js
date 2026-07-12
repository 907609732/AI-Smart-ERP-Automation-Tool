import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import os from 'os';

const authFile = path.join(process.cwd(), 'tests', '.auth', 'cainiao.json');
const targetUrl = 'https://b.cainiao.com/business/dsc/oms/erp/osmain/ordermanage';

function copyDirSync(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    entry.isDirectory() ? copyDirSync(s, d) : (() => { try { fs.copyFileSync(s, d); } catch {} })();
  }
}

async function main() {
  if (!fs.existsSync(authFile)) {
    console.log('❌ 未找到登录态，请先运行: npm run test:login');
    process.exit(1);
  }

  // 1. 复制真实 Chrome 数据到临时目录
  const realDir = path.join(os.homedir(), 'Library/Application Support/Google/Chrome');
  const tempDir = path.join(os.tmpdir(), `cainiao-auto-${Date.now()}`);
  fs.existsSync(realDir) ? copyDirSync(realDir, tempDir) : fs.mkdirSync(tempDir, { recursive: true });

  // 2. 启动持久化浏览器（带你的真实指纹）
  const browser = await chromium.launchPersistentContext(tempDir, {
    headless: false,
    viewport: { width: 1440, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });

  // 3. 注入已保存的 Cookie
  const storage = JSON.parse(fs.readFileSync(authFile, 'utf-8'));
  if (storage.cookies?.length) await browser.addCookies(storage.cookies);

  const pages = browser.pages();
  const page = pages.length > 0 ? pages[0] : await browser.newPage();

  // 4. 进入目标页面
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log('📍 当前页面:', page.url());

  if (page.url().includes('login')) {
    console.log('❌ Cookie 失效，请重新运行 npm run test:login');
    await browser.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
    process.exit(1);
  }

  console.log('✅ 已成功进入订单管理页');

  // ========== 在这里写你的自动化操作 ==========
  // 示例：截图
  await page.screenshot({ path: 'tests/.auth/automation-screenshot.png', fullPage: true });

  // 示例：点击筛选条件
  // await page.click('text=筛选');

  // 示例：导出订单
  // await page.click('text=导出订单');

  // 示例：等待列表加载
  // await page.waitForSelector('table tbody tr', { timeout: 10000 });

  // 示例：获取订单数据
  // const rows = await page.locator('table tbody tr').all();
  // console.log('订单数:', rows.length);
  // =============================================

  await page.waitForTimeout(3000);
  await browser.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log('🎉 完成');
}

main().catch((err) => {
  console.error('❌ 错误:', err.message);
  process.exit(1);
});
