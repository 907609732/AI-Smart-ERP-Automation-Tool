import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import os from 'os';

const authFile = path.join(process.cwd(), 'tests', '.auth', 'cainiao.json');
const targetUrl = 'https://b.cainiao.com/business/dsc/oms/inventory/inventoryreport';
const downloadDir = path.join(process.cwd(), 'downloads');

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

  fs.mkdirSync(downloadDir, { recursive: true });

  const realDir = path.join(os.homedir(), 'Library/Application Support/Google/Chrome');
  const tempDir = path.join(os.tmpdir(), `cainiao-inventory-${Date.now()}`);
  fs.existsSync(realDir) ? copyDirSync(realDir, tempDir) : fs.mkdirSync(tempDir, { recursive: true });

  const browser = await chromium.launchPersistentContext(tempDir, {
    headless: false,
    viewport: { width: 1440, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
    acceptDownloads: true,
  });

  const storage = JSON.parse(fs.readFileSync(authFile, 'utf-8'));
  if (storage.cookies?.length) await browser.addCookies(storage.cookies);

  const pages = browser.pages();
  const page = pages.length > 0 ? pages[0] : await browser.newPage();

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log('📍 当前页面:', page.url());

  if (page.url().includes('login')) {
    console.log('❌ Cookie 失效，请重新运行 npm run test:login');
    await browser.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
    process.exit(1);
  }

  console.log('✅ 已进入库存多维查询页');
  await page.waitForTimeout(3000);

  // 切换到"库存明细"标签
  const detailTab = page.locator('text=库存明细');
  if (await detailTab.count() > 0) {
    const isActive = await detailTab.evaluate(el => el.classList.contains('active') || el.getAttribute('aria-selected') === 'true');
    if (!isActive) {
      console.log('🔄 切换到库存明细标签...');
      await detailTab.click({ force: true });
      await page.waitForTimeout(2000);
    }
  }

  // 设置时间粒度为"日"
  const dayRadio = page.locator('span.cn-next-radio-label:has-text("日")').first();
  if (await dayRadio.count() > 0) {
    console.log('📅 设置时间粒度为"日"');
    await dayRadio.click({ force: true });
    await page.waitForTimeout(1000);
  }

  // 设置日期为昨天
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().split('T')[0];
  console.log('📅 查询日期:', dateStr);

  const dateInputs = page.locator('input[placeholder*="选择日期"], input.ant-calendar-picker-input');
  if (await dateInputs.count() >= 2) {
    await dateInputs.nth(0).fill(dateStr);
    await dateInputs.nth(1).fill(dateStr);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500);
  }

  // 点击查询
  const queryBtn = page.locator('button:has-text("查询"), .ant-btn-primary:has-text("查询")').first();
  if (await queryBtn.count() > 0) {
    console.log('🔍 点击查询...');
    await queryBtn.click({ force: true });
    await page.waitForTimeout(3000);
  }

  console.log('⏳ 等待表格加载...');
  await page.waitForTimeout(2000);

  let downloadPath = null;

  // 点击导出并等待下载
  const exportBtn = page.locator('text=导出明细').first();
  if (await exportBtn.count() > 0) {
    console.log('📥 点击导出明细并等待下载...');

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 120000 }),
      exportBtn.click({ force: true }),
    ]);

    downloadPath = path.join(downloadDir, `库存明细_${dateStr}_${Date.now()}.xlsx`);
    await download.saveAs(downloadPath);
    console.log('✅ 文件已下载:', downloadPath);
  } else {
    console.log('⚠️ 未找到导出明细按钮');
  }

  await page.waitForTimeout(3000);
  await browser.close();
  fs.rmSync(tempDir, { recursive: true, force: true });

  return downloadPath;
}

main().then((file) => {
  console.log('🎉 下载完成:', file);
}).catch((err) => {
  console.error('❌ 错误:', err.message);
  process.exit(1);
});
