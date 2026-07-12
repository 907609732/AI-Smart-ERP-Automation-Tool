import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const authFile = path.join(process.cwd(), 'tests', '.auth', 'cainiao.json');
const targetUrl = 'https://b.cainiao.com/business/dsc/oms/inventory/inventoryreport';
const downloadDir = path.join(process.cwd(), 'downloads');

async function exportInventoryFlow() {
  console.log('🚀 启动 Chrome 导出库存流水数据...');

  if (!fs.existsSync(authFile)) {
    throw new Error('未找到登录态，请先运行: npm run test:login');
  }

  fs.mkdirSync(downloadDir, { recursive: true });

  const browser = await chromium.launch({
    headless: false,
    viewport: { width: 1440, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({
    acceptDownloads: true,
  });

  // 加载登录态
  const storage = JSON.parse(fs.readFileSync(authFile, 'utf-8'));
  if (storage.cookies?.length) await context.addCookies(storage.cookies);

  const page = await context.newPage();

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log('📍 当前页面:', page.url());

  if (page.url().includes('login')) {
    await browser.close();
    throw new Error('Cookie 失效，请重新运行 npm run test:login');
  }

  console.log('✅ 已进入库存多维查询页');
  await page.waitForTimeout(3000);

  // 切换到"库存流水"标签
  const flowTab = page.locator('text=库存流水').first();
  if (await flowTab.count() > 0) {
    console.log('🔄 切换到库存流水标签...');
    await flowTab.click({ force: true });
    await page.waitForTimeout(2000);
  }

  // 设置时间粒度为"月"
  const monthRadio = page.locator('span.cn-next-radio-label:has-text("月")').first();
  if (await monthRadio.count() > 0) {
    console.log('📅 设置时间粒度为"月"');
    await monthRadio.click({ force: true });
    await page.waitForTimeout(1000);
  }

  // 设置日期为2026-05（先测试一个月）
  const targetMonth = '2026-05';
  console.log('📅 查询月份:', targetMonth);

  const dateInput = page.locator('input[placeholder*="选择日期"], input.ant-calendar-picker-input').first();
  if (await dateInput.count() > 0) {
    await dateInput.fill(targetMonth);
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

  // 获取总条数
  const totalText = await page.locator('.cn-next-pagination-total, .ant-pagination-total-text').first().textContent().catch(() => '');
  console.log('📊 查询结果:', totalText.trim());

  // 点击导出
  const exportBtn = page.locator('button:has-text("导出"), .ant-btn:has-text("导出")').first();
  let downloadPath = null;
  if (await exportBtn.count() > 0) {
    console.log('📥 点击导出...');

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      exportBtn.click({ force: true }),
    ]);

    downloadPath = path.join(downloadDir, `库存流水_${targetMonth}_${Date.now()}.xlsx`);
    await download.saveAs(downloadPath);
    console.log('✅ 文件已下载:', downloadPath);
  } else {
    console.log('⚠️ 未找到导出按钮');
  }

  await page.waitForTimeout(2000);
  await browser.close();

  return downloadPath;
}

async function main() {
  try {
    const file = await exportInventoryFlow();
    if (file && fs.existsSync(file)) {
      console.log('\n🎉 导出成功:', file);
    } else {
      console.log('\n⚠️ 导出失败');
    }
  } catch (err) {
    console.error('\n❌ 错误:', err.message);
    process.exit(1);
  }
}

main();
