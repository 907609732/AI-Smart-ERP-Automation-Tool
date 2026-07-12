# ERP 交互与智能体接手指南

这份文档给用户、开发者和其他智能体使用。它解释每个页面模块怎么交互、数据从哪里来、改功能时应该先看哪些代码。

## 快速启动与验证

```bash
npm run erp
curl http://localhost:3000/api/health
```

启动后访问 `http://localhost:3000/`。健康接口返回 `{"ok":true}` 表示服务、静态页面和 SQLite 初始化都正常。

## 页面总览

ERP 是一个单页应用，主页面在 `web/index.html`，交互逻辑集中在 `web/app.js`，样式集中在 `web/styles.css`。顶部 Tab 切换不会刷新页面，只是切换不同 `data-module` 区块。

| 页面模块 | 用户目标 | 主要前端函数 | 主要后端接口 |
| --- | --- | --- | --- |
| 库存总览 | 查看正式 SKU、三仓库存、成本、图片、月出库量和补货预警 | `loadInventory`、`saveSku`、`saveInventoryQuantity`、`openImageManager` | `GET /api/reports/inventory`、`PUT /api/skus/:sku`、`PUT /api/inventory/:sku/quantity` |
| 订单管理 | 按月份/店铺看订单，查看商品编码和待匹配明细 | `loadOrdersOverview`、`renderOrdersTable` | `GET /api/orders/overview` |
| 店铺商品管理 | 维护平台商品编码到 ERP SKU 的映射 | `loadProductCodeMappings`、`bindProductCodeMapping` | `GET/POST /api/product-code-mappings`、`POST /api/orders/rematch-unmatched` |
| 导入中心 | 导入库存、月度出库、订单、邮费，查看文件档案 | `bindImportForm`、`loadSavedFiles` | `POST /api/import/*`、`GET /api/import/files` |
| 经营看板 | 查看销售额、邮费、毛利和经营概览 | `loadBusinessOverview`、`loadSales` | `GET /api/business/overview`、`GET /api/reports/monthly-sales` |
| 采购售后 | 查看项目文件扫描出的采购、售后等记录 | `loadBusinessOverview` | `GET /api/business/overview` |
| 条码打印 | 按 SKU 设计 40×60mm 标签，保存模板并打印 | `loadBarcodeCatalog`、`renderBarcodeEditor`、`saveBarcodeTemplate`、`printBarcodeLabels` | `GET/POST /api/barcodes/*` |
| 同行分析 | 按正式 SKU 维护淘宝/拼多多/京东链接和价格销量快照 | `loadCompetitors`、`runCompetitorSnapshot` | `GET/POST/PUT /api/competitors*` |

## 核心交互流程

### 1. 导入菜鸟库存

用户在“导入中心”上传菜鸟库存表，或在库存总览用快捷导入。系统会：

1. 保存原始文件到 `data/imported-files/`，按 SHA-256 去重。
2. 用 `core/erp/importers.js` 的 `importInventoryFile` 解析 SKU、商品名、条码、库存、成本、预警线。
3. 写入 `skus`、`inventory_snapshots`。
4. 前端 `refreshAll()` 重新加载库存总览、看板、文件档案。

注意：正式 SKU 只能由人工维护或库存导入创建。订单导入不能自动创建正式 SKU。

### 2. 导入菜鸟月度出库

用户上传菜鸟“库存明细/月度销量”导出表。系统会：

1. 用 `importMonthlyOutboundFile` 识别 `货品条码`、`货品名称`、`出库汇总`、`toC销售出`、`toB销售出`、`近30天销量`。
2. 写入 `monthly_outbound`，主键是 `sku + warehouse_id + month`，重复导入会更新同月数据。
3. 库存总览新增 `菜鸟月出库量` 列，并用月出库量估算可售天数。
4. 钉钉库存预警会同步显示月出库量、近 30 天销量和补货等级。

补货等级：

| 可售天数 | 页面提示 | 钉钉提示 |
| --- | --- | --- |
| 小于 7 天 | 严重缺货无法发货 | 不够卖一星期，严重缺货无法发货 |
| 小于 15 天 | 急需补货 | 不够卖半个月，急需补货 |
| 小于 30 天 | 需要补货 | 不够卖一个月，需要补货 |

### 3. 导入订单并扣库存

用户导入千牛、京东、拼多多等订单表。系统会：

1. 先识别订单号、子订单号、商品 ID、商家编码、商品名、规格、数量、实付金额、订单状态。
2. 如果订单 SKU 已存在于正式 `skus`，直接进入 `order_items` 并扣减默认仓库库存。
3. 如果没有 SKU，但存在平台商品 ID，则查 `product_code_mappings` 映射。
4. 找不到正式 SKU 或映射时进入 `order_unmatched_items`，显示在待匹配区域，不进入正式库存商品。
5. 用户绑定映射后，系统补扣历史库存并记录 `inventory_movements`。

订单导入是覆盖式导入：同一个平台同一个订单号重新导入时，会先清理该订单旧的明细、未匹配项和订单扣减流水，再写入最新数据。

### 4. 库存图片管理

库存总览点击图片格子，会打开图片管理窗口。用户可以一次上传多张图片，系统保存到 `data/product-images/<SKU>/`，数据库表是 `product_images`。

图片只关联正式 SKU，不跟订单临时商品绑定。导出库存 CSV 时会导出图片数量和图片链接。

### 5. 表格排序与列宽

库存总览的列宽保存在浏览器 `localStorage`，key 是 `erp.inventoryColumnWidths.v1`。可排序列由 `web/app.js` 的 `renderInventorySortHeaders` 和库存表头点击事件共同控制。

如果新增库存列，需要同步修改：

1. `web/index.html` 的表头、表尾小计。
2. `web/app.js` 的 `loadInventory` 行渲染。
3. `INVENTORY_RESIZABLE_COLUMNS` 列宽配置。
4. `renderInventorySortHeaders` 可排序列列表。
5. `web/styles.css` 对应列宽变量。

### 6. 钉钉同步

库存预警按钮调用 `POST /api/dingtalk/send-report`，`type=inventory` 时使用 `buildInventoryMarkdown()`。月报使用 `type=monthly`，可传 `month=YYYY-MM`。

钉钉 webhook 和加签在 `.env.local`，不要提交到 Git。消息发送失败时接口会返回错误，前端会弹出 toast。

## API 返回约定

普通接口统一返回：

```json
{
  "ok": true,
  "data": {}
}
```

失败时：

```json
{
  "ok": false,
  "error": "错误原因"
}
```

`web/app.js` 的 `api()` 会自动检查 `ok` 和 HTTP 状态，失败会抛错。新增接口时尽量复用 `server.js` 里的 `sendJson(res, fn)`。

## 智能体开发注意事项

- 先读 `docs/module-map.md` 找模块，不要一上来全仓库通读。
- 数据库结构集中在 `core/erp/db.js` 的 `migrate()`，新增表或字段要保证老数据库能自动补齐。
- 导入解析不要写死单一列名，优先用 `findColumn` 和别名数组兼容平台导出差异。
- 订单导入不能自动创建正式 SKU；无法匹配的订单商品要进 `order_unmatched_items`。
- 库存数量变化必须写 `inventory_movements`，否则后续查日志和库存扣减会断链。
- 自动化抓平台页面时不绕验证码、不绕登录风控；需要用户登录时记录明确失败原因。
- 修改页面后至少跑：

```bash
node --check web/app.js
node --check core/erp/server.js
curl http://localhost:3000/api/health
```

## 常见任务定位

| 任务 | 先读 |
| --- | --- |
| 新增导入类型 | `core/erp/importers.js`、`core/erp/server.js`、`web/index.html`、`web/app.js` |
| 改库存预警 | `core/erp/db.js` 的库存报表查询、`core/erp/reports.js` 的钉钉文案 |
| 改订单扣库存 | `core/erp/importers.js` 的 `importOrdersFile`、`core/erp/order-matching.js` |
| 改图片上传 | `core/erp/server.js` 的图片接口、`web/app.js` 的图片管理弹窗 |
| 改条码编辑器 | `core/erp/barcodes.js`、`web/app.js` 条码函数段、`web/styles.css` 条码样式段 |
| 改同行抓取 | `core/erp/competitors.js`、`core/pdd-mobile-snapshot.js` |
