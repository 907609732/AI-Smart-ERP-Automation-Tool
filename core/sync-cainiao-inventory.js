import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { importInventoryFile } from './erp/importers.js';
import { getInventoryReport, buildInventoryMarkdown } from './erp/reports.js';
import { sendDingTalkMarkdown } from './dingtalk.js';

const authFile = path.join(process.cwd(), 'tests', '.auth', 'cainiao.json');
const targetUrl = 'https://b.cainiao.com/business/dsc/oms/inventory/inventoryreport';
const downloadDir = path.join(process.cwd(), 'downloads');
const businessTimeZone = process.env.BUSINESS_TIME_ZONE || 'Asia/Shanghai';

function businessDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: businessTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function copyDirSync(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    entry.isDirectory() ? copyDirSync(s, d) : (() => { try { fs.copyFileSync(s, d); } catch {} })();
  }
}

function getLatestFile(dir, ext = '.xlsx') {
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith(ext))
    .map(f => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtime }))
    .sort((a, b) => b.mtime - a.mtime);
  return files.length > 0 ? path.join(dir, files[0].name) : null;
}

async function exportFromCainiao() {
  console.log('🚀 启动 Chrome 导出库存明细...');

  if (!fs.existsSync(authFile)) {
    throw new Error('未找到登录态，请先运行: npm run test:login');
  }

  fs.mkdirSync(downloadDir, { recursive: true });

  const realDir = path.join(os.homedir(), 'Library/Application Support/Google/Chrome');
  const tempDir = path.join(os.tmpdir(), `cainiao-sync-${Date.now()}`);
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
    await browser.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw new Error('Cookie 失效，请重新运行 npm run test:login');
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

  // 设置日期为当天
  const dateStr = businessDate();
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

  // 点击导出并等待下载
  let exportBtn = page.locator('button:has-text("导出明细"), .ant-btn:has-text("导出明细")').first();
  if (await exportBtn.count() === 0) {
    exportBtn = page.locator('text=导出明细').first();
  }
  let downloadPath = null;
  if (await exportBtn.count() > 0) {
    console.log('📥 点击导出明细...');
    try {
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 30000 }),
        exportBtn.click({ force: true }),
      ]);
      downloadPath = path.join(downloadDir, `库存明细_${dateStr}_${Date.now()}.xlsx`);
      await download.saveAs(downloadPath);
      console.log('✅ 文件已下载:', downloadPath);
    } catch (e) {
      console.log('⚠️ 未检测到下载:', e.message);
    }
  } else {
    console.log('⚠️ 未找到导出明细按钮');
  }

  await page.waitForTimeout(2000);
  await browser.close();
  fs.rmSync(tempDir, { recursive: true, force: true });

  return downloadPath;
}

async function main() {
  // 1. 从菜鸟导出
  const file = await exportFromCainiao();
  if (!file || !fs.existsSync(file)) {
    throw new Error('没有下载到新的库存文件，已停止后续导入、钉钉通知和云端同步。');
  }

  // 2. 导入到本地系统
  console.log('\n📥 正在导入本地系统...');
  const snapshotDate = businessDate();

  const result = importInventoryFile({
    file,
    warehouseId: 'cainiao',
    snapshotDate,
  });
  console.log('✅ 导入完成:', result);

  // 清理旧缓存：删除该仓库的旧快照，停用不在当前快照中的 SKU
  console.log('\n🧹 清理旧库存缓存...');
  const { getDb } = await import('./erp/db.js');
  const db = getDb();

  const deletedSnapshots = db.prepare("DELETE FROM inventory_snapshots WHERE warehouse_id = ? AND snapshot_date != ?").run('cainiao', snapshotDate);
  console.log(`   删除旧快照: ${deletedSnapshots.changes} 条`);

  const inactiveResult = db.prepare("UPDATE skus SET status = 'inactive' WHERE source = 'inventory' AND status = 'active' AND sku NOT IN (SELECT sku FROM inventory_snapshots WHERE warehouse_id = 'cainiao' AND snapshot_date = ?)").run(snapshotDate);
  console.log(`   清理旧 SKU: ${inactiveResult.changes} 个`);

  // 3. 生成库存报告
  console.log('\n📊 生成库存报告...');
  const report = getInventoryReport();
  console.log(`   SKU 总数: ${report.skuCount}`);
  console.log(`   库存总量: ${report.totalQuantity}`);
  console.log(`   预警 SKU: ${report.lowStockItems?.length || 0}`);

  // 4. 发送钉钉
  console.log('\n📤 发送钉钉消息...');
  const markdown = buildInventoryMarkdown('table');
  const dingResult = await sendDingTalkMarkdown({
    title: markdown.title,
    text: markdown.text,
  });
  console.log('✅ 钉钉发送结果:', dingResult);

  console.log('\n🎉 全流程完成');
}

main().catch((err) => {
  console.error('\n❌ 错误:', err.message);
  process.exit(1);
});
