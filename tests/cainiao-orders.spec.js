import { test, expect } from '@playwright/test';
import path from 'path';

const authFile = path.join(process.cwd(), 'tests', '.auth', 'cainiao.json');

/**
 * 复用已保存的登录态，直接访问订单管理页
 * 运行前需先执行 cainiao-login.spec.js 完成登录
 *
 * npx playwright test tests/cainiao-orders.spec.js --project=chromium
 */

test.use({ storageState: authFile });

test('菜鸟订单管理页操作示例', async ({ page }) => {
  const targetUrl = 'https://b.cainiao.com/business/dsc/oms/erp/osmain/ordermanage';

  await page.goto(targetUrl, { waitUntil: 'networkidle' });

  console.log('当前页面:', page.url());

  // 示例：截取页面快照
  await page.screenshot({ path: 'tests/.auth/orders-page.png', fullPage: true });

  // 示例：等待订单列表加载（根据实际页面结构调整选择器）
  // await page.waitForSelector('.order-list, [class*="order"]', { timeout: 10000 });

  // 示例：获取页面标题
  const title = await page.title();
  console.log('页面标题:', title);

  // 在这里添加你的自动化操作……
  // 例如：导出订单、筛选状态、点击分页等
});
