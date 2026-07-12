import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import os from 'os';

const authFile = path.join(process.cwd(), 'tests', '.auth', 'cainiao.json');
const targetUrl = 'https://b.cainiao.com/business/dsc/oms/erp/osmain/ordermanage';

function copyDirSync(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      try {
        fs.copyFileSync(srcPath, destPath);
      } catch {
        // 跳过被锁定的文件
      }
    }
  }
}

async function main() {
  console.log('🔍 验证登录态（使用持久化 Context）...');

  if (!fs.existsSync(authFile)) {
    console.log('❌ 未找到登录态文件，请先运行 npm run test:login');
    process.exit(1);
  }

  // 复制一份用户数据，并把登录态合并进去
  const realUserDataDir = path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome');
  const tempUserDataDir = path.join(os.tmpdir(), `cainiao-verify-${Date.now()}`);

  if (fs.existsSync(realUserDataDir)) {
    console.log('📂 复制用户数据...');
    copyDirSync(realUserDataDir, tempUserDataDir);
  } else {
    fs.mkdirSync(tempUserDataDir, { recursive: true });
  }

  // 将保存的 cookies 写入 Default/Cookies（SQLite）太复杂，不如直接通过 addCookies 注入
  const browser = await chromium.launchPersistentContext(tempUserDataDir, {
    headless: false,
    viewport: { width: 1440, height: 900 },
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  const storage = JSON.parse(fs.readFileSync(authFile, 'utf-8'));
  if (storage.cookies?.length) {
    console.log(`🍪 注入 ${storage.cookies.length} 个 Cookie...`);
    await browser.addCookies(storage.cookies);
  }

  const pages = browser.pages();
  const page = pages.length > 0 ? pages[0] : await browser.newPage();

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log('📍 当前页面:', page.url());

  if (page.url().includes('login')) {
    console.log('❌ Cookie 已失效或无法复用，需要重新登录');
  } else {
    console.log('✅ 登录态有效，已成功进入订单管理页');
    await page.screenshot({ path: 'tests/.auth/verify-success.png', fullPage: true });
    console.log('📸 截图已保存到 tests/.auth/verify-success.png');
  }

  await page.waitForTimeout(3000);
  await browser.close();

  try {
    fs.rmSync(tempUserDataDir, { recursive: true, force: true });
  } catch {}
}

main().catch((err) => {
  console.error('❌ 错误:', err.message);
  process.exit(1);
});
