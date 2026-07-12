import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const authFile = path.join(process.cwd(), 'tests', '.auth', 'cainiao.json');
const targetUrl = 'https://b.cainiao.com/business/dsc/oms/inventory/inventoryreport';
const downloadDir = path.join(process.cwd(), 'downloads');

async function exportInventoryDetail(month) {
  console.log(`🚀 启动 Chrome 导出库存明细（${month}）...`);

  if (!fs.existsSync(authFile)) {
    throw new Error('未找到登录态，请先运行: npm run test:login');
  }

  fs.mkdirSync(downloadDir, { recursive: true });

  const browser = await chromium.launch({
    headless: false,
    viewport: { width: 1440, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({ acceptDownloads: true });

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

  // 切换到"库存明细"标签
  const detailTab = page.locator('text=库存明细').first();
  if (await detailTab.count() > 0) {
    console.log('🔄 切换到库存明细标签...');
    await detailTab.click({ force: true });
    await page.waitForTimeout(2000);
  }

  // 设置时间粒度为"月"
  const monthRadio = page.locator('.cn-next-radio-group span.cn-next-radio-label:has-text("月")').first();
  if (await monthRadio.count() > 0) {
    console.log('📅 设置时间粒度为"月"');
    await monthRadio.click({ force: true });
    await page.waitForTimeout(1000);
  }

  // 尝试用键盘模拟输入日期
  console.log('📅 查询月份:', month);
  const dateInput = page.locator('input[placeholder*="选择日期"], input.cn-next-date-picker2-input, .cn-ui-date-picker-pro input').first();
  if (await dateInput.count() > 0) {
    await dateInput.click({ force: true });
    await page.waitForTimeout(500);
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(200);
    await page.keyboard.type(month);
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500);
  } else {
    console.log('⚠️ 未找到日期输入框');
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

  // 截图查看当前页面状态
  const screenshotPath = path.join(downloadDir, `screenshot_${month}_${Date.now()}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log('📸 页面截图:', screenshotPath);

  // 获取总条数
  const totalText = await page.locator('.cn-next-pagination-total, .ant-pagination-total-text, text=/共\\s*\\d+/').first().textContent().catch(() => '');
  console.log('📊 查询结果:', totalText.trim());

  // 点击导出明细
  const exportBtn = page.locator('button:has-text("导出明细"), .ant-btn:has-text("导出明细")').first();
  let downloadPath = null;
  if (await exportBtn.count() > 0) {
    console.log('📥 点击导出明细...');

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      exportBtn.click({ force: true }),
    ]);

    downloadPath = path.join(downloadDir, `库存明细汇总_${month}_${Date.now()}.xlsx`);
    await download.saveAs(downloadPath);
    console.log('✅ 文件已下载:', downloadPath);
  } else {
    console.log('⚠️ 未找到导出明细按钮');
  }

  await page.waitForTimeout(2000);
  await browser.close();

  return { downloadPath, screenshotPath };
}

async function main() {
  const month = process.argv[2] || '2026-05';
  try {
    const result = await exportInventoryDetail(month);
    if (result.downloadPath && fs.existsSync(result.downloadPath)) {
      console.log('\n🎉 导出成功:', result.downloadPath);
    } else {
      console.log('\n⚠️ 导出失败');
    }
  } catch (err) {
    console.error('\n❌ 错误:', err.message);
    process.exit(1);
  }
}

main();
