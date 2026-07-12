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

  // 切换到"库存明细"标签 - 使用更精确的选择器
  const detailTab = page.locator('.cn-next-tabs-tab-inner:has-text("库存明细"), .cn-ui-tab-item:has-text("库存明细")').first();
  if (await detailTab.count() > 0) {
    console.log('🔄 切换到库存明细标签...');
    await detailTab.click();
    await page.waitForTimeout(3000);
  } else {
    console.log('⚠️ 未找到库存明细标签，尝试文本匹配...');
    const altTab = page.getByText('库存明细').first();
    if (await altTab.count() > 0) {
      await altTab.click();
      await page.waitForTimeout(3000);
    }
  }

  // 验证当前是否在库存明细标签
  const activeTab = await page.locator('.cn-next-tabs-tab.active .cn-next-tabs-tab-inner, .cn-ui-tab-item.active').first().textContent().catch(() => '');
  console.log('当前活跃标签:', activeTab.trim());

  // 等待库存明细的内容加载
  await page.waitForSelector('th:has-text("货品编码"), th:has-text("货品名称")', { timeout: 10000 }).catch(() => {
    console.log('⚠️ 未检测到库存明细表格，可能标签切换失败');
  });

  // 设置时间粒度为"月" - 在库存明细的上下文中查找
  const monthRadio = page.locator('.cn-next-tabs-tabpane.active span.cn-next-radio-label:has-text("月"), .cn-ui-tab-panel.active span.cn-next-radio-label:has-text("月")').first();
  if (await monthRadio.count() > 0) {
    const isChecked = await monthRadio.evaluate(el => {
      const radio = el.closest('label')?.querySelector('input[type="radio"]');
      return radio?.checked || el.parentElement?.classList.contains('checked');
    });
    if (!isChecked) {
      console.log('📅 设置时间粒度为"月"');
      await monthRadio.click();
      await page.waitForTimeout(1500);
    } else {
      console.log('✅ 时间粒度已经是"月"');
    }
  } else {
    // 尝试在页面范围内查找
    const fallbackRadio = page.locator('span.cn-next-radio-label:has-text("月")').first();
    if (await fallbackRadio.count() > 0) {
      console.log('📅 设置时间粒度为"月"（fallback）');
      await fallbackRadio.click();
      await page.waitForTimeout(1500);
    }
  }

  // 设置日期 - 查找日期输入框
  console.log('📅 查询月份:', month);
  const dateInputs = page.locator('input[placeholder*="选择日期"], input[placeholder*="起始日期"]');
  const inputCount = await dateInputs.count();
  console.log('找到日期输入框数量:', inputCount);

  if (inputCount > 0) {
    const firstInput = dateInputs.nth(0);
    // 滚动到视图并点击
    await firstInput.evaluate(el => el.scrollIntoView({ behavior: 'instant', block: 'center' }));
    await page.waitForTimeout(300);
    await firstInput.click({ force: true });
    await page.waitForTimeout(500);
    // 全选清空并输入
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(100);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(100);
    await page.keyboard.type(month);
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500);
  }

  // 点击查询
  const queryBtn = page.locator('.cn-next-tabs-tabpane.active button:has-text("查询"), .cn-ui-tab-panel.active button:has-text("查询")').first();
  if (await queryBtn.count() > 0) {
    console.log('🔍 点击查询...');
    await queryBtn.click();
  } else {
    const fallbackQuery = page.locator('button:has-text("查询"), .ant-btn-primary:has-text("查询")').first();
    if (await fallbackQuery.count() > 0) {
      console.log('🔍 点击查询（fallback）...');
      await fallbackQuery.click();
    }
  }
  await page.waitForTimeout(4000);

  // 截图查看当前状态
  const screenshotPath = path.join(downloadDir, `screenshot_${month}_${Date.now()}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log('📸 页面截图:', screenshotPath);

  // 获取总条数
  const totalText = await page.locator('text=/共\\s*\\d+\\s*项/').first().textContent().catch(() => '');
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
