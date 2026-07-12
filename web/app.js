// 全站单页应用共享状态。这里刻意保持扁平，方便其他智能体定位：
// 配置/缓存数据放 state，DOM 展示由各 load/render 函数重新生成。
const state = {
  config: { warehouses: [], platforms: [], stores: [] },
  skus: [],
  competitorSku: "",
  barcodeCatalog: { items: [], templates: [], categories: [] },
  barcodeSelected: null,
  barcodeTemplate: null,
  barcodeElementId: "",
  barcodeDrag: null,
  barcodePrinters: { printers: [], defaultPrinter: "" },
  orderColumns: [],
  imageManager: { sku: "", name: "", images: [], index: 0 },
  inventorySort: { column: "", direction: "desc" }
};

const API_BASE = window.location.protocol === "file:" ? "http://localhost:3000" : "";
const money = (value) => `￥${Number(value || 0).toFixed(2)}`;
const todayMonth = () => new Date().toISOString().slice(0, 7);
const ORDER_COLUMN_STORAGE_KEY = "erp.orderColumns.v1";
const INVENTORY_COLUMN_WIDTH_STORAGE_KEY = "erp.inventoryColumnWidths.v1";
const INVENTORY_RESIZABLE_COLUMNS = {
  select: { min: 48 },
  seq: { min: 52 },
  image: { min: 56 },
  name: { min: 220 },
  total: { min: 90 },
  warehouse: { min: 110 },
  cost: { min: 90 },
  low: { min: 90 },
  reserved: { min: 100 },
  trend: { min: 140 },
  monthlyOutbound: { min: 118 },
  sellable: { min: 180 },
  sales7: { min: 80 },
  sales15: { min: 88 },
  return7: { min: 98 },
  return15: { min: 98 },
  op: { min: 100 }
};
// 订单管理的“自定义显示列”配置。新增订单可展示字段时，只需要在这里补一项；
// renderOrdersTable 会按用户保存在 localStorage 的选择动态生成表头和单元格。
const ORDER_COLUMNS = [
  { key: "platform", label: "平台", get: (row) => typeName(row.platform), default: true },
  { key: "store", label: "店铺", get: (row) => row.store || "-", default: true },
  { key: "orderId", label: "订单号", get: (row) => row.orderId, default: true, className: "nowrap-cell" },
  { key: "orderDate", label: "时间", get: (row) => row.orderDate, default: true, className: "nowrap-cell" },
  { key: "status", label: "状态", get: (row) => row.status || "-", default: true },
  { key: "barcodeSummary", label: "商品编码/条形码", get: (row) => row.barcodeSummary || row.skuSummary || "-", default: true, className: "order-code-cell" },
  { key: "productSummary", label: "商品明细", get: (row) => row.productSummary || "-", default: true, className: "order-product-cell" },
  { key: "quantity", label: "数量", get: (row) => formatNumber(row.quantity), default: true, align: "right" },
  { key: "totalAmount", label: "金额", get: (row) => money(row.totalAmount), default: true, align: "right" },
  { key: "lineCount", label: "明细数", get: (row) => formatNumber(row.lineCount) },
  { key: "skuSummary", label: "ERP SKU", get: (row) => row.skuSummary || "-" },
  { key: "itemAmount", label: "明细金额", get: (row) => money(row.itemAmount) },
  { key: "refundSummary", label: "退款状态", get: (row) => row.refundSummary || "-" },
  { key: "itemNames", label: "商品名称", get: (row) => orderDisplayItems(row).map((item) => item.name || item.sku).join("；") || "-" },
  { key: "itemQuantities", label: "商品数量明细", get: (row) => orderDisplayItems(row).map((item) => `${item.sku || item.productId || "未匹配"} x${formatNumber(item.quantity)}`).join("；") || "-" },
  { key: "externalProductId", label: "外部商品ID", get: (row) => uniqueOrderItemText(row, "externalProductId") },
  { key: "cainiaoCode", label: "菜鸟编码", get: (row) => uniqueOrderItemText(row, "cainiaoCode") },
  { key: "qianniuCode", label: "千牛编码", get: (row) => uniqueOrderItemText(row, "qianniuCode") },
  { key: "jdCode", label: "京东编码", get: (row) => uniqueOrderItemText(row, "jdCode") },
  { key: "pddCode", label: "拼多多编码", get: (row) => uniqueOrderItemText(row, "pddCode") }
];

document.querySelector("#refreshBtn").addEventListener("click", refreshAll);
document.querySelector("#inventoryWarehouse").addEventListener("change", loadInventory);
document.querySelector("#sendInventoryBtn").addEventListener("click", () => sendDingTalk({ type: "inventory" }));
document.querySelector("#sendMonthlyBtn").addEventListener("click", () =>
  sendDingTalk({ type: "monthly", month: document.querySelector("#businessMonth").value || todayMonth() })
);
document.querySelector("#businessMonth").addEventListener("change", loadSales);
document.querySelector("#importProjectBtn").addEventListener("click", importProjectFolder);
document.querySelector("#snapshotBtn").addEventListener("click", runCompetitorSnapshot);
document.querySelector("#snapshotAllBtn").addEventListener("click", runAllCompetitorSnapshots);
document.querySelector("#refreshBarcodeBtn").addEventListener("click", loadBarcodeCatalog);
document.querySelector("#saveBarcodeTemplateBtn").addEventListener("click", saveBarcodeTemplate);
document.querySelector("#printBarcodeBtn").addEventListener("click", printBarcodeLabels);
document.querySelector("#barcodeCategory").addEventListener("change", renderBarcodeList);
document.querySelector("#barcodeSearch").addEventListener("input", renderBarcodeList);
document.querySelector("#barcodeName").addEventListener("input", updateBarcodeTemplateName);
document.querySelector("#barcodeQty").addEventListener("input", renderBarcodePreview);
document.querySelector("#barcodeSize").addEventListener("change", updateBarcodeTemplateSize);
document.querySelector("#barcodePrinter").addEventListener("change", renderBarcodePrintHint);
document.querySelector("#barcodeDateMode").addEventListener("change", renderBarcodeEditor);
document.querySelectorAll("[data-add-barcode-element]").forEach((button) => {
  button.addEventListener("click", () => addBarcodeElement(button.dataset.addBarcodeElement));
});
document.querySelector("#barcodeDuplicateBtn").addEventListener("click", duplicateBarcodeElement);
document.querySelector("#barcodeDeleteBtn").addEventListener("click", deleteBarcodeElement);
document.querySelector("#barcodeFrontBtn").addEventListener("click", () => moveBarcodeElementLayer(1));
document.querySelector("#barcodeBackBtn").addEventListener("click", () => moveBarcodeElementLayer(-1));
[
  "#barcodeElementText",
  "#barcodeElementX",
  "#barcodeElementY",
  "#barcodeElementW",
  "#barcodeElementH",
  "#barcodeElementRotate",
  "#barcodeElementFontSize",
  "#barcodeElementFontWeight",
  "#barcodeElementAlign",
  "#barcodeElementFill",
  "#barcodeElementStroke",
  "#barcodeElementStrokeWidth"
].forEach((selector) => document.querySelector(selector).addEventListener("input", updateSelectedBarcodeElement));
document.querySelector("#barcodeElementImage").addEventListener("change", updateBarcodeImageElement);
document.querySelector("#competitorSkuSelect").addEventListener("change", () => {
  state.competitorSku = document.querySelector("#competitorSkuSelect").value;
  loadCompetitors();
});
document.querySelector("#quickInventoryFile").addEventListener("change", quickImportInventory);
document.querySelector("#exportInventoryBtn").addEventListener("click", exportInventoryCsv);
document.querySelector("#rematchOrdersBtn").addEventListener("click", rematchUnmatchedOrders);
document.querySelector("#ordersMonth").addEventListener("change", loadOrdersOverview);
document.querySelector("#ordersStore").addEventListener("change", loadOrdersOverview);
document.querySelector("#ordersFilterReset").addEventListener("click", () => {
  document.querySelector("#ordersMonth").value = "";
  document.querySelector("#ordersStore").value = "";
  loadOrdersOverview();
});
document.querySelector("#closeImageManagerBtn").addEventListener("click", closeImageManager);
document.querySelector("#imageManagerUpload").addEventListener("change", () => uploadImageManagerFiles());
document.querySelectorAll("[data-module-tab]").forEach((button) => {
  button.addEventListener("click", () => showModule(button.dataset.moduleTab));
});

bindImportForm("#ordersForm", "/api/import/orders");
bindImportForm("#shippingForm", "/api/import/shipping-fees");

document.querySelector("#syncCainiaoBtn").addEventListener("click", async () => {
  const btn = document.querySelector("#syncCainiaoBtn");
  const status = document.querySelector("#syncCainiaoStatus");
  btn.disabled = true;
  status.textContent = "正在启动同步...";
  try {
    const result = await api("/api/sync/cainiao-inventory", { method: "POST" });
    status.textContent = result.message || "同步已启动，完成后会推送钉钉消息";
  } catch (e) {
    status.textContent = "启动失败: " + e.message;
  } finally {
    btn.disabled = false;
  }
});
document.querySelector("#competitorForm").addEventListener("submit", createCompetitor);

init();

async function init() {
  document.querySelector("#businessMonth").value = todayMonth();
  initOrderColumns();
  initInventoryColumnResize();
  state.config = (await api("/api/config")).data;
  state.skus = (await api("/api/skus")).data;
  state.competitorSku = state.skus[0]?.sku || "";
  fillSelect("#inventoryWarehouse", state.config.warehouses, "id", "name");
  fillSelect("#inventoryWarehouseForm", state.config.warehouses, "id", "name");
  fillSelect("#monthlyOutboundWarehouseForm", state.config.warehouses, "id", "name");
  fillSelect("#ordersPlatform", state.config.platforms, "id", "name");
  fillSelect("#shippingPlatform", state.config.platforms, "id", "name");
  fillStoreInputs(state.config.stores || []);
  fillCompetitorSkuSelect();
  showModule("inventory");
  await refreshAll();
}

function showModule(moduleName) {
  document.querySelectorAll("[data-module-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.moduleTab === moduleName);
  });
  document.querySelectorAll("[data-module]").forEach((section) => {
    section.classList.toggle("active-module", section.dataset.module === moduleName);
  });
  document.querySelectorAll(".drawer-grid").forEach((grid) => {
    const activeChildren = grid.querySelectorAll("[data-module].active-module");
    const hasActiveChild = activeChildren.length > 0;
    grid.classList.toggle("active-module", hasActiveChild);
    grid.classList.toggle("single-module", activeChildren.length === 1);
    grid.hidden = !hasActiveChild;
  });
  const titles = {
    inventory: ["商品库存", "库存、销量、预警统一查看"],
    orders: ["订单管理", "订单台账和订单状态"],
    "store-products": ["店铺商品管理", "平台商品编码、规格和 ERP SKU 映射"],
    import: ["导入中心", "上传数据并管理已保存文件"],
    business: ["经营看板", "销售、采购、售后自动可视化"],
    ops: ["采购售后", "采购记录和售后退货明细"],
    barcodes: ["条码打印", "按产品大类和 SKU 编码生成打印标签"],
    competitor: ["同行分析", "维护同行链接和公开数据快照"]
  };
  const [title, subtitle] = titles[moduleName] || titles.inventory;
  document.querySelector(".page-title h1").textContent = title;
  document.querySelector(".page-title p").textContent = subtitle;
}

async function refreshAll() {
  state.skus = (await api("/api/skus")).data;
  if (!state.competitorSku || !state.skus.some((sku) => sku.sku === state.competitorSku)) {
    state.competitorSku = state.skus[0]?.sku || "";
  }
  fillCompetitorSkuSelect();
  await Promise.all([
    loadDashboard(),
    loadInventory(),
    loadUnmanagedOrderItems(),
    loadSales(),
    loadBusinessOverview(),
    loadOrdersOverview(),
    loadProductCodeMappings(),
    loadSavedFiles(),
    loadBarcodeCatalog(),
    loadBarcodePrinters(),
    loadCompetitors()
  ]);
}

async function loadDashboard() {
  const { data } = await api("/api/dashboard");
  document.querySelector("#metrics").innerHTML = [
    metric("SKU 数", data.inventory.skuCount),
    metric("库存合计", data.inventory.totalQuantity),
    metric("低库存", data.inventory.lowStockCount),
    metric("本月销售额", money(data.monthly.totals.salesAmount)),
    metric("本月预估毛利", money(data.monthly.totals.estimatedGrossProfit))
  ].join("");

  document.querySelector("#importsBody").innerHTML = data.importRecords
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.type)}</td>
        <td>${escapeHtml(row.platform || row.warehouseId)}</td>
        <td>${row.successCount}/${row.rowCount}</td>
        <td>${escapeHtml(row.importedAt)}</td>
      </tr>`
    )
    .join("");
}

async function loadOrdersOverview() {
  const month = document.querySelector("#ordersMonth").value || "";
  const store = document.querySelector("#ordersStore").value || "";
  const { data } = await api(`/api/orders/overview?month=${encodeURIComponent(month)}&store=${encodeURIComponent(store)}`);
  renderOrderFilters(data.filters || {});
  renderOrderMetrics(data.summary || {});
  renderBarChart("#orderStatusChart", data.statusRows || [], "status", "count", (value) => `${formatNumber(value)} 单`);
  renderBarChart("#orderStoreChart", data.storeSummaryRows || [], "store", "totalAmount", money);
  renderOrdersTable(data.recentOrders || []);
  document.querySelector("#unmatchedOrdersBody").innerHTML = data.unmatchedItems.length
    ? data.unmatchedItems
        .map(
          (row) => `<tr>
            <td>${escapeHtml(row.orderId)}</td>
            <td>${escapeHtml(row.productId || "-")}</td>
            <td>${escapeHtml(row.name)}</td>
            <td>${escapeHtml(row.attributes)}</td>
            <td>${formatNumber(row.quantity)}</td>
            <td>${money(row.paidAmount)}</td>
            <td>
              <select class="sku-map-select" data-map-row="${escapeAttr(JSON.stringify({
                platform: row.platform,
                productId: row.productId,
                attributes: row.attributes
              }))}">
                <option value="">选择 SKU</option>
                ${skuOptions()}
              </select>
            </td>
            <td><button data-bind-mapping="${escapeAttr(JSON.stringify({
              platform: row.platform,
              productId: row.productId,
              attributes: row.attributes
            }))}">绑定并补扣</button></td>
          </tr>`
        )
        .join("")
    : `<tr><td colspan="8" class="empty-table">没有待匹配订单，所有可识别订单都已经进入库存扣减流程。</td></tr>`;
  document.querySelectorAll("[data-bind-mapping]").forEach((button) => {
    button.addEventListener("click", () => bindProductCodeMapping(button));
  });
}

function initOrderColumns() {
  const defaults = ORDER_COLUMNS.filter((column) => column.default).map((column) => column.key);
  try {
    const saved = JSON.parse(localStorage.getItem(ORDER_COLUMN_STORAGE_KEY) || "[]");
    state.orderColumns = saved.filter((key) => ORDER_COLUMNS.some((column) => column.key === key));
  } catch {
    state.orderColumns = [];
  }
  if (!state.orderColumns.length) state.orderColumns = defaults;
  renderOrderColumnSettings();
}

function renderOrderColumnSettings() {
  const wrap = document.querySelector("#orderColumnSettings");
  if (!wrap) return;
  wrap.innerHTML = ORDER_COLUMNS.map(
    (column) => `<label>
      <input type="checkbox" value="${escapeAttr(column.key)}" ${state.orderColumns.includes(column.key) ? "checked" : ""} />
      ${escapeHtml(column.label)}
    </label>`
  ).join("");
  wrap.querySelectorAll("input").forEach((input) => {
    input.addEventListener("change", () => {
      const selected = Array.from(wrap.querySelectorAll("input:checked")).map((item) => item.value);
      state.orderColumns = selected.length ? selected : ORDER_COLUMNS.filter((column) => column.default).map((column) => column.key);
      localStorage.setItem(ORDER_COLUMN_STORAGE_KEY, JSON.stringify(state.orderColumns));
      loadOrdersOverview();
    });
  });
}

function renderOrdersTable(rows = []) {
  const columns = state.orderColumns
    .map((key) => ORDER_COLUMNS.find((column) => column.key === key))
    .filter(Boolean);
  document.querySelector("#ordersHead").innerHTML = `<tr>${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}</tr>`;
  document.querySelector("#ordersBody").innerHTML = rows.length
    ? rows
        .map(
          (row) => `<tr>${columns
            .map((column) => {
              const value = column.get(row);
              const className = [column.className || "", column.align === "right" ? "number-cell" : ""].filter(Boolean).join(" ");
              return `<td class="${escapeAttr(className)}">${escapeHtml(value)}</td>`;
            })
            .join("")}</tr>`
        )
        .join("")
    : `<tr><td colspan="${Math.max(columns.length, 1)}" class="empty-table">当前筛选下没有订单数据，换一个月份或店铺试试。</td></tr>`;
}

function uniqueOrderItemText(row, key) {
  const values = [...new Set(orderDisplayItems(row).map((item) => item[key]).filter(Boolean))];
  return values.length ? values.join(" / ") : "-";
}

function orderDisplayItems(row) {
  return row.displayItems?.length ? row.displayItems : row.items || [];
}

function renderOrderFilters(filters = {}) {
  const storeSelect = document.querySelector("#ordersStore");
  const currentStore = storeSelect.value;
  const stores = filters.stores?.length
    ? filters.stores.map((row) => ({ id: row.store || "未分店铺", name: `${row.store || "未分店铺"}（${formatNumber(row.count)}）` }))
    : (state.config.stores || []);
  storeSelect.innerHTML = `<option value="">全部店铺</option>` + stores
    .map((item) => `<option value="${escapeAttr(item.id)}">${escapeHtml(item.name)}</option>`)
    .join("");
  storeSelect.value = filters.store || currentStore || "";
}

function renderOrderMetrics(summary = {}) {
  document.querySelector("#orderMetrics").innerHTML = [
    businessMetric("订单数", formatNumber(summary.orderCount), "当前筛选范围"),
    businessMetric("订单金额", money(summary.totalAmount), "订单主表金额合计"),
    businessMetric("已匹配明细", `${formatNumber(summary.matchedLineCount)} 条`, "已进入订单明细"),
    businessMetric("商品数量", `${formatNumber(summary.matchedQuantity)} 件`, "已匹配订单数量"),
    businessMetric("待匹配", `${formatNumber(summary.unmatchedLineCount)} 条`, "需要绑定 SKU"),
    businessMetric("已扣库存", `${formatNumber(summary.deductedQuantity)} 件`, "订单扣减和映射补扣")
  ].join("");
}

function initInventoryColumnResize() {
  // 库存表列宽是用户强感知配置，保存在 localStorage，不写数据库。
  // 新增库存列时，要同步 INVENTORY_RESIZABLE_COLUMNS、HTML 表头和 CSS 变量。
  const table = document.querySelector("#inventoryTable");
  if (!table) return;
  applyInventoryColumnWidths(readInventoryColumnWidths());
  table.querySelectorAll("thead th[data-inventory-col]").forEach((th) => {
    if (th.querySelector(".column-resizer")) return;
    const handle = document.createElement("span");
    handle.className = "column-resizer";
    handle.title = "拖动调整列宽";
    th.appendChild(handle);
    handle.addEventListener("pointerdown", (event) => startInventoryColumnResize(event, th));
  });
}

function startInventoryColumnResize(event, th) {
  event.preventDefault();
  const column = th.dataset.inventoryCol;
  const startX = event.clientX;
  const startWidth = th.getBoundingClientRect().width;
  const minWidth = INVENTORY_RESIZABLE_COLUMNS[column]?.min || 70;
  const handle = event.currentTarget;
  handle.setPointerCapture?.(event.pointerId);
  document.body.classList.add("resizing-column");

  const move = (moveEvent) => {
    const nextWidth = Math.max(minWidth, Math.round(startWidth + moveEvent.clientX - startX));
    setInventoryColumnWidth(column, nextWidth);
  };
  const stop = () => {
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", stop);
    document.body.classList.remove("resizing-column");
    saveInventoryColumnWidths();
  };
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", stop, { once: true });
}

function setInventoryColumnWidth(column, width) {
  const table = document.querySelector("#inventoryTable");
  if (!table || !column) return;
  table.style.setProperty(`--inventory-col-${column}`, `${Math.round(width)}px`);
}

function readInventoryColumnWidths() {
  try {
    return JSON.parse(localStorage.getItem(INVENTORY_COLUMN_WIDTH_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function applyInventoryColumnWidths(widths = {}) {
  Object.entries(widths).forEach(([column, width]) => {
    if (INVENTORY_RESIZABLE_COLUMNS[column] && Number(width)) {
      setInventoryColumnWidth(column, Number(width));
    }
  });
}

function saveInventoryColumnWidths() {
  const table = document.querySelector("#inventoryTable");
  if (!table) return;
  const widths = {};
  Object.keys(INVENTORY_RESIZABLE_COLUMNS).forEach((column) => {
    const value = table.style.getPropertyValue(`--inventory-col-${column}`);
    if (value) widths[column] = Number.parseInt(value, 10);
  });
  localStorage.setItem(INVENTORY_COLUMN_WIDTH_STORAGE_KEY, JSON.stringify(widths));
}

async function loadProductCodeMappings() {
  const { data } = await api("/api/product-code-mappings");
  document.querySelector("#mappingBody").innerHTML = data.length
    ? data
        .map(
          (row) => `<tr>
            <td>${escapeHtml(typeName(row.platform))}</td>
            <td>${escapeHtml(row.codeValue)}</td>
            <td>${escapeHtml(row.attributes || "全部规格")}</td>
            <td>${escapeHtml(row.sku)}</td>
            <td>${escapeHtml(row.skuName || "")}</td>
            <td>${escapeHtml((row.updatedAt || "").slice(0, 16))}</td>
          </tr>`
        )
        .join("")
    : `<tr><td colspan="6" class="empty-table">还没有商品编码映射。可以在下面“待匹配订单明细”里直接绑定。</td></tr>`;
}

async function bindProductCodeMapping(button) {
  const row = JSON.parse(button.dataset.bindMapping || "{}");
  const select = button.closest("tr").querySelector(".sku-map-select");
  const sku = select.value;
  if (!sku) {
    showMessage("请先选择要绑定的 SKU。");
    return;
  }
  if (!row.productId) {
    showMessage("这条待匹配订单没有商品编码，无法建立编码映射。");
    return;
  }
  await api("/api/product-code-mappings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      platform: row.platform || "qianniu",
      codeType: "product_id",
      codeValue: row.productId,
      attributes: row.attributes || "",
      sku,
      note: "从待匹配订单明细手动绑定"
    })
  });
  const result = await api("/api/orders/rematch-unmatched", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ platform: row.platform || "qianniu" })
  });
  showMessage(`绑定成功，已补扣 ${formatNumber(result.data.deductedQuantity)} 件库存，匹配 ${result.data.matchedCount} 条明细。`);
  await refreshAll();
}

async function rematchUnmatchedOrders() {
  const result = await api("/api/orders/rematch-unmatched", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ platform: "qianniu" })
  });
  showMessage(`重新匹配完成：匹配 ${result.data.matchedCount} 条，补扣 ${formatNumber(result.data.deductedQuantity)} 件，未匹配 ${result.data.skippedCount} 条。`);
  await refreshAll();
}

async function loadBusinessOverview() {
  const { data } = await api("/api/business/overview");
  const orders = await api("/api/orders/overview");
  renderBusinessMetrics(data, orders.data.summary || {});
  renderBarChart("#salesChart", data.salesMonthly || data.monthly || [], "month", "salesAmount", money);
  renderBarChart("#shippingChart", data.shippingMonthly || [], "month", "amount", money);
  renderBarChart("#platformChart", data.platformSales || [], "platform", "salesAmount", money);
  renderOpsChart(data);
  document.querySelector("#purchaseBody").innerHTML = data.latestPurchases
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.purchaseDate)}</td>
        <td>${escapeHtml(row.itemName)}</td>
        <td>${money(row.amount)}</td>
        <td>${escapeHtml(row.platform)}</td>
      </tr>`
    )
    .join("");
  document.querySelector("#returnsBody").innerHTML = data.latestReturns
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.platform || row.store)}</td>
        <td>${escapeHtml(row.productName || row.trackingNo || row.orderId)}</td>
        <td>${money(row.refundAmount)}</td>
        <td>${escapeHtml(row.status)}</td>
      </tr>`
    )
    .join("");
}

async function loadSavedFiles() {
  const { data } = await api("/api/import/files");
  document.querySelector("#savedFilesBody").innerHTML = data
    .map(
      (row) => `<tr>
        <td title="${escapeAttr(row.originalName)}">${escapeHtml(shortFileName(row.originalName))}</td>
        <td>${escapeHtml(typeName(row.importType))}</td>
        <td>${escapeHtml(row.store || "-")}</td>
        <td>${row.rowCount || 0}</td>
        <td>${escapeHtml((row.lastUsedAt || "").slice(0, 16))}</td>
        <td><a href="${API_BASE}/api/import/files/${encodeURIComponent(row.hash)}/download">下载</a></td>
      </tr>`
    )
    .join("");
}

async function loadInventory() {
  const selectedWarehouseId = document.querySelector("#inventoryWarehouse").value || "cainiao";
  const { data } = await api(`/api/reports/inventory?warehouseId=${encodeURIComponent(selectedWarehouseId)}`);

  // 后端返回的是完整业务数据；前端排序只影响当前页面展示，不回写数据库。
  // 注意：sales7/sales15/return7/return15 目前是视觉占位指标，真实出库判断用 monthlyOutbound。
  if (state.inventorySort.column) {
    const col = state.inventorySort.column;
    const dir = state.inventorySort.direction === "asc" ? 1 : -1;
    data.items.forEach(addInventoryDisplayMetrics);
    data.items.sort((a, b) => {
      let av, bv;
      switch (col) {
        case "name": av = a.name || a.sku; bv = b.name || b.sku; break;
        case "total": av = a.totalQuantity; bv = b.totalQuantity; break;
        case "warehouse": av = a.selectedWarehouse?.quantity || 0; bv = b.selectedWarehouse?.quantity || 0; break;
        case "cost": av = a.costPrice || 0; bv = b.costPrice || 0; break;
        case "low": av = a.lowStockThreshold || 0; bv = b.lowStockThreshold || 0; break;
        case "reserved": av = 0; bv = 0; break;
        case "monthlyOutbound": av = a.monthlyOutbound || 0; bv = b.monthlyOutbound || 0; break;
        case "sellable": av = a.sellableDays || Infinity; bv = b.sellableDays || Infinity; break;
        case "sales7": av = a.sales7 || 0; bv = b.sales7 || 0; break;
        case "sales15": av = a.sales15 || 0; bv = b.sales15 || 0; break;
        case "return7": av = a.return7 || 0; bv = b.return7 || 0; break;
        case "return15": av = a.return15 || 0; bv = b.return15 || 0; break;
        default: return 0;
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }

  document.querySelector("#inventoryBody").innerHTML = data.items
    .map((item, index) => {
      addInventoryDisplayMetrics(item);
      const { sales7, sales15, return7, return15 } = item;
      const selectedWarehouse = item.selectedWarehouse || item.warehouses.find((row) => row.warehouseId === selectedWarehouseId) || {};
      const image = item.images?.[0];
      const sellableDaysText = item.sellableDays && item.sellableDays !== Infinity ? `${Math.round(item.sellableDays)}天` : "-";
      return `<tr>
        <td class="select-col" data-inventory-col="select"><input type="checkbox" /></td>
        <td class="seq seq-col" data-inventory-col="seq">${index + 1}</td>
        <td class="image-col" data-inventory-col="image">
          <button class="image-uploader" data-open-images="${escapeAttr(item.sku)}" data-product-name="${escapeAttr(item.name || item.sku)}" data-images="${escapeAttr(JSON.stringify(item.images || []))}" type="button" title="点击查看和管理商品图片">
            ${
              image
                ? `<img class="product-thumb" src="${escapeAttr(API_BASE + image.publicUrl)}" alt="${escapeAttr(item.name || item.sku)}" />`
                : `<span class="image-placeholder">+</span>`
            }
            ${item.images?.length > 1 ? `<em class="image-count">${item.images.length}</em>` : ""}
          </button>
        </td>
        <td class="name-cell name-col" data-inventory-col="name">
          <div>${escapeHtml(item.name || item.sku)}</div>
          <small class="product-code">编码：${escapeHtml(item.barcode || item.sku)}</small>
        </td>
        <td class="number-blue" data-inventory-col="total">${formatNumber(item.totalQuantity)}</td>
        <td data-inventory-col="warehouse">
          <input
            class="editable inventory-quantity"
            data-sku="${escapeAttr(item.sku)}"
            data-warehouse-id="${escapeAttr(selectedWarehouse.warehouseId || selectedWarehouseId)}"
            type="number"
            step="1"
            value="${Number(selectedWarehouse.quantity || 0)}"
            title="回车或离开输入框后自动保存"
          />
        </td>
        <td data-inventory-col="cost"><input class="editable sku-cost" data-sku="${escapeAttr(item.sku)}" type="number" step="0.01" value="${Number(item.costPrice || 0)}" /></td>
        <td data-inventory-col="low"><input class="editable sku-low" data-sku="${escapeAttr(item.sku)}" type="number" step="1" value="${Number(item.lowStockThreshold || 10)}" /></td>
        <td class="zero" data-inventory-col="reserved">0</td>
        <td class="trend-col" data-inventory-col="trend">${sparkline(item.sku, item.totalQuantity)}</td>
        <td class="number-blue" data-inventory-col="monthlyOutbound" title="来自菜鸟云仓月度销量/库存明细导出">${item.monthlyOutbound ? formatNumber(item.monthlyOutbound) : "-"}</td>
        <td class="number-blue" data-inventory-col="sellable">
          ${item.stockAlert?.level !== "ok" ? `<span class="stock-alert-pill ${item.stockAlert.level}">${escapeHtml(item.stockAlert.text)}</span>` : ""}
          <span class="sellable-days">${sellableDaysText}</span>
        </td>
        <td class="number-blue" data-inventory-col="sales7">${sales7 || ""}</td>
        <td class="number-blue" data-inventory-col="sales15">${sales15 || ""}</td>
        <td class="zero" data-inventory-col="return7">${return7 || ""}</td>
        <td class="zero" data-inventory-col="return15">${return15 || ""}</td>
        <td class="op-col" data-inventory-col="op"><span class="op-links"><button data-save-sku="${escapeAttr(item.sku)}">保存</button></span></td>
      </tr>`
    })
    .join("");

  document.querySelectorAll("[data-save-sku]").forEach((button) => {
    button.addEventListener("click", () => saveSku(button.dataset.saveSku));
  });
  document.querySelectorAll(".inventory-quantity").forEach((input) => {
    input.addEventListener("focus", () => {
      input.dataset.originalValue = input.value;
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") input.blur();
      if (event.key === "Escape") {
        input.value = input.dataset.originalValue || input.defaultValue;
        input.blur();
      }
    });
    input.addEventListener("blur", () => saveInventoryQuantity(input));
  });
  document.querySelectorAll("[data-open-images]").forEach((button) => {
    button.addEventListener("click", () => {
      openImageManager({
        sku: button.dataset.openImages,
        name: button.dataset.productName,
        images: JSON.parse(button.dataset.images || "[]")
      });
    });
  });

  document.querySelector("#subtotalQuantity").textContent = formatNumber(data.totalQuantity);
  document.querySelector("#subtotalWarehouseQuantity").textContent = formatNumber(
    data.items.reduce((sum, item) => sum + Number(item.selectedWarehouse?.quantity || 0), 0)
  );
  document.querySelector("#subtotalReserved").textContent = "0";
  document.querySelector("#subtotalMonthlyOutbound").textContent = formatNumber(
    data.items.reduce((sum, item) => sum + Number(item.monthlyOutbound || 0), 0)
  );
  document.querySelector("#subtotalSales7").textContent = sumPseudo(data.items, "sales7", 8);
  document.querySelector("#subtotalSales15").textContent = sumPseudo(data.items, "sales15", 18);
  document.querySelector("#subtotalReturn7").textContent = sumPseudo(data.items, "return7", 3);
  document.querySelector("#subtotalReturn15").textContent = sumPseudo(data.items, "return15", 7);

  renderInventorySortHeaders();
}

function addInventoryDisplayMetrics(item) {
  // 旧版界面需要 7/15 天销量和退货列，但目前没有稳定真实来源。
  // 这里用固定伪指标保持界面可读；不要把这些字段用于补货或经营决策。
  if (item._displayMetricsReady) return item;
  item.sales7 = pseudoMetric(item.sku, 8);
  item.sales15 = item.sales7 + pseudoMetric(`${item.sku}-15`, 10);
  item.return7 = pseudoMetric(`${item.sku}-r7`, 3);
  item.return15 = item.return7 + pseudoMetric(`${item.sku}-r15`, 4);
  item._displayMetricsReady = true;
  return item;
}

function renderInventorySortHeaders() {
  // 排序表头与点击事件共享同一组列名。改列名时务必两处一起改，
  // 否则会出现箭头显示了但点击无效，或点击有效但没有箭头。
  const table = document.querySelector("#inventoryTable");
  if (!table) return;
  const sortableColumns = ["name", "total", "warehouse", "cost", "low", "reserved", "monthlyOutbound", "sellable", "sales7", "sales15", "return7", "return15"];
  table.querySelectorAll("thead th[data-inventory-col]").forEach((th) => {
    const col = th.dataset.inventoryCol;
    if (!sortableColumns.includes(col)) {
      th.classList.remove("sortable");
      const indicator = th.querySelector(".sort-indicator");
      if (indicator) indicator.remove();
      return;
    }
    th.classList.add("sortable");
    let indicator = th.querySelector(".sort-indicator");
    if (!indicator) {
      indicator = document.createElement("span");
      indicator.className = "sort-indicator";
      th.appendChild(indicator);
    }
    if (state.inventorySort.column === col) {
      indicator.textContent = state.inventorySort.direction === "asc" ? "↑" : "↓";
      indicator.classList.remove("inactive");
    } else {
      indicator.textContent = "↕";
      indicator.classList.add("inactive");
    }
  });
}

document.querySelector("#inventoryTable").addEventListener("click", (event) => {
  const th = event.target.closest("th[data-inventory-col]");
  if (!th) return;
  const col = th.dataset.inventoryCol;
  const sortableColumns = ["name", "total", "warehouse", "cost", "low", "reserved", "monthlyOutbound", "sellable", "sales7", "sales15", "return7", "return15"];
  if (!sortableColumns.includes(col)) return;
  if (state.inventorySort.column === col) {
    state.inventorySort.direction = state.inventorySort.direction === "asc" ? "desc" : "asc";
  } else {
    state.inventorySort = { column: col, direction: "desc" };
  }
  loadInventory();
});

async function loadUnmanagedOrderItems() {
  const { data } = await api("/api/inventory/unmanaged-order-items");
  const countText = `${formatNumber(data.count || 0)} 条 / ${formatNumber(data.quantity || 0)} 件`;
  document.querySelector("#unmanagedCount").textContent = countText;
  document.querySelector("#unmanagedInventoryBody").innerHTML = data.items.length
    ? data.items
        .map(
          (row) => `<tr>
            <td>${escapeHtml(typeName(row.platform))}</td>
            <td>
              <strong>${escapeHtml(row.productId || row.skuText || "-")}</strong>
              <small>${escapeHtml(row.rowSource === "legacy_order_sku" ? "历史临时SKU" : row.skuText || "")}</small>
            </td>
            <td>${escapeHtml(row.name || "-")}</td>
            <td>${escapeHtml(row.attributes || "全部规格")}</td>
            <td>${formatNumber(row.quantity)}</td>
            <td>${money(row.paidAmount)}</td>
            <td>${escapeHtml(row.status || row.refundStatus || "-")}</td>
            <td>
              <select class="unmanaged-sku-select">
                <option value="">选择正式 SKU</option>
                ${skuOptions()}
              </select>
            </td>
            <td>
              <button data-match-unmanaged="${escapeAttr(JSON.stringify({
                platform: row.platform,
                productId: row.productId,
                skuText: row.skuText,
                attributes: row.attributes,
                rowSource: row.rowSource
              }))}">绑定并补扣</button>
            </td>
          </tr>`
        )
        .join("")
    : `<tr><td colspan="9" class="empty-table">暂无待维护订单商品。订单导入后未匹配到正式 SKU 的商品会出现在这里。</td></tr>`;

  document.querySelectorAll("[data-match-unmanaged]").forEach((button) => {
    button.addEventListener("click", () => matchUnmanagedOrderItem(button));
  });
}

async function loadBarcodeCatalog() {
  const { data } = await api("/api/barcodes/catalog");
  state.barcodeCatalog = data;
  const categorySelect = document.querySelector("#barcodeCategory");
  const currentCategory = categorySelect.value;
  const categories = data.categories || [];
  categorySelect.innerHTML = `<option value="">全部大类</option>` + categories
    .map((category) => `<option value="${escapeAttr(category)}">${escapeHtml(category)}</option>`)
    .join("");
  categorySelect.value = categories.includes(currentCategory) ? currentCategory : "";
  if (!state.barcodeSelected && data.items?.length) {
    state.barcodeSelected = data.items[0];
  } else if (state.barcodeSelected) {
    state.barcodeSelected =
      data.items.find((item) => item.sku === state.barcodeSelected.sku) ||
      data.items.find((item) => item.barcode === state.barcodeSelected.barcode) ||
      data.items[0] ||
      null;
  }
  renderBarcodeList();
  await loadBarcodeTemplateForSelected();
}

async function loadBarcodePrinters() {
  const select = document.querySelector("#barcodePrinter");
  try {
    const { data } = await api("/api/barcodes/printers");
    state.barcodePrinters = data || { printers: [], defaultPrinter: "" };
    const printers = state.barcodePrinters.printers || [];
    select.innerHTML = printers.length
      ? printers
          .map((printer) => `<option value="${escapeAttr(printer.id)}">${escapeHtml(printer.name)}${printer.status === "disabled" ? "（不可用）" : ""}</option>`)
          .join("")
      : `<option value="">系统打印弹窗选择</option>`;
    if (state.barcodePrinters.defaultPrinter) {
      select.value = state.barcodePrinters.defaultPrinter;
    }
  } catch (error) {
    select.innerHTML = `<option value="">系统打印弹窗选择</option>`;
    state.barcodePrinters = { printers: [], defaultPrinter: "" };
  }
  renderBarcodePrintHint();
}

function renderBarcodeList() {
  const category = document.querySelector("#barcodeCategory").value || "";
  const keyword = document.querySelector("#barcodeSearch").value.trim().toLowerCase();
  const items = (state.barcodeCatalog.items || []).filter((item) => {
    const text = `${item.category} ${item.productName} ${item.name} ${item.sku} ${item.barcode}`.toLowerCase();
    return (!category || item.category === category) && (!keyword || text.includes(keyword));
  });
  document.querySelector("#barcodeTemplateInfo").innerHTML = [
    businessMetric("汉码模板", `${formatNumber(state.barcodeCatalog.templates?.length || 0)} 个`, "来自 S商品条形码 文件夹"),
    businessMetric("可打印 SKU", `${formatNumber(state.barcodeCatalog.items?.length || 0)} 个`, "来自正式库存商品")
  ].join("");
  document.querySelector("#barcodeList").innerHTML = items.length
    ? items
        .map((item) => `<button class="barcode-item ${state.barcodeSelected?.sku === item.sku ? "active" : ""}" data-barcode-sku="${escapeAttr(item.sku)}">
          <span>${escapeHtml(item.category)}</span>
          <strong>${escapeHtml(item.productName || item.name)}</strong>
          <small>${escapeHtml(item.barcode || item.sku)}${item.hasHanmaTemplate ? " · 已匹配汉码模板" : ""}</small>
        </button>`)
        .join("")
    : `<p class="empty">没有匹配的条码商品。</p>`;
  document.querySelectorAll("[data-barcode-sku]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.barcodeSelected = state.barcodeCatalog.items.find((item) => item.sku === button.dataset.barcodeSku) || null;
      renderBarcodeList();
      await loadBarcodeTemplateForSelected();
    });
  });
}

async function loadBarcodeTemplateForSelected() {
  if (!state.barcodeSelected?.sku) {
    state.barcodeTemplate = null;
    renderBarcodeEditor();
    return;
  }
  const { data } = await api(`/api/barcodes/template?sku=${encodeURIComponent(state.barcodeSelected.sku)}`);
  state.barcodeTemplate = data;
  state.barcodeElementId = data.elements?.[0]?.id || "";
  document.querySelector("#barcodeName").value = data.name || state.barcodeSelected.productName || state.barcodeSelected.name || "";
  document.querySelector("#barcodeSize").value = `${Number(data.widthMm || 40)}x${Number(data.heightMm || 60)}`;
  renderBarcodeEditor();
}

function updateBarcodeTemplateName() {
  if (!state.barcodeTemplate) return;
  state.barcodeTemplate.name = document.querySelector("#barcodeName").value.trim();
  renderBarcodeEditor();
}

function updateBarcodeTemplateSize() {
  if (!state.barcodeTemplate) return;
  const [width, height] = selectedBarcodeSize();
  state.barcodeTemplate.widthMm = width;
  state.barcodeTemplate.heightMm = height;
  renderBarcodeEditor();
}

function renderBarcodeEditor() {
  renderBarcodeCanvas();
  renderSelectedBarcodeProperties();
  renderBarcodePreview();
  updateBarcodePrintPageSize();
  renderBarcodePrintHint();
}

function renderBarcodeCanvas() {
  const svg = document.querySelector("#barcodeCanvas");
  const template = state.barcodeTemplate;
  if (!template) {
    svg.innerHTML = "";
    return;
  }
  const width = Number(template.widthMm || 40);
  const height = Number(template.heightMm || 60);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.style.width = `${width * 6}px`;
  svg.style.height = `${height * 6}px`;
  document.querySelector("#barcodeCanvasSize").textContent = `${width} × ${height} mm`;
  svg.innerHTML = `
    <rect class="label-background" x="0" y="0" width="${width}" height="${height}" />
    ${(template.elements || []).map((element) => barcodeElementSvg(element, { selectable: true })).join("")}`;
  bindBarcodeCanvasEvents(svg);
}

function bindBarcodeCanvasEvents(svg) {
  svg.querySelectorAll("[data-barcode-element-id]").forEach((node) => {
    node.addEventListener("pointerdown", (event) => {
      const id = node.dataset.barcodeElementId;
      const element = getBarcodeElement(id);
      if (!element) return;
      state.barcodeElementId = id;
      const point = svgPoint(event);
      state.barcodeDrag = { id, startX: point.x, startY: point.y, originX: Number(element.x || 0), originY: Number(element.y || 0) };
      node.setPointerCapture?.(event.pointerId);
      renderBarcodeEditor();
    });
  });
  svg.onpointermove = (event) => {
    if (!state.barcodeDrag) return;
    const element = getBarcodeElement(state.barcodeDrag.id);
    if (!element) return;
    const point = svgPoint(event);
    element.x = roundHalf(state.barcodeDrag.originX + point.x - state.barcodeDrag.startX);
    element.y = roundHalf(state.barcodeDrag.originY + point.y - state.barcodeDrag.startY);
    renderBarcodeEditor();
  };
  svg.onpointerup = () => {
    state.barcodeDrag = null;
  };
  svg.onclick = (event) => {
    if (event.target === svg || event.target.classList.contains("label-background")) {
      state.barcodeElementId = "";
      renderBarcodeEditor();
    }
  };
}

function svgPoint(event) {
  const svg = document.querySelector("#barcodeCanvas");
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  return point.matrixTransform(svg.getScreenCTM().inverse());
}

function barcodeElementSvg(element, { selectable = false } = {}) {
  const selected = selectable && element.id === state.barcodeElementId;
  const attrs = `data-barcode-element-id="${escapeAttr(element.id)}" class="barcode-svg-element ${selected ? "selected" : ""}" transform="rotate(${Number(element.rotate || 0)} ${Number(element.x) + Number(element.w) / 2} ${Number(element.y) + Number(element.h) / 2})"`;
  const text = resolveBarcodeText(element.text || defaultBarcodeElementText(element.type));
  if (element.type === "barcode" || element.type === "qrcode") {
    const src = `${API_BASE}/api/barcodes/code128.svg?value=${encodeURIComponent(text)}&type=${element.type === "qrcode" ? "qrcode" : "code128"}&scale=2&height=${Math.max(8, Number(element.h || 16))}`;
    return `<g ${attrs}>
      <image href="${escapeAttr(src)}" x="${element.x}" y="${element.y}" width="${element.w}" height="${element.h}" preserveAspectRatio="none" />
      ${selected ? selectionRect(element) : ""}
    </g>`;
  }
  if (element.type === "rect") {
    return `<g ${attrs}><rect x="${element.x}" y="${element.y}" width="${element.w}" height="${element.h}" fill="${escapeAttr(element.fill)}" stroke="${escapeAttr(element.stroke)}" stroke-width="${element.strokeWidth}" />${selected ? selectionRect(element) : ""}</g>`;
  }
  if (element.type === "circle") {
    return `<g ${attrs}><ellipse cx="${Number(element.x) + Number(element.w) / 2}" cy="${Number(element.y) + Number(element.h) / 2}" rx="${Number(element.w) / 2}" ry="${Number(element.h) / 2}" fill="${escapeAttr(element.fill)}" stroke="${escapeAttr(element.stroke)}" stroke-width="${element.strokeWidth}" />${selected ? selectionRect(element) : ""}</g>`;
  }
  if (element.type === "line") {
    return `<g ${attrs}><line x1="${element.x}" y1="${element.y}" x2="${Number(element.x) + Number(element.w)}" y2="${Number(element.y) + Number(element.h)}" stroke="${escapeAttr(element.stroke)}" stroke-width="${element.strokeWidth || 0.4}" />${selected ? selectionRect(element) : ""}</g>`;
  }
  if (element.type === "image") {
    const image = element.src
      ? `<image href="${escapeAttr(element.src)}" x="${element.x}" y="${element.y}" width="${element.w}" height="${element.h}" preserveAspectRatio="xMidYMid meet" />`
      : `<rect x="${element.x}" y="${element.y}" width="${element.w}" height="${element.h}" fill="#f1f5f9" stroke="#94a3b8" stroke-dasharray="1 1" />`;
    return `<g ${attrs}>${image}${selected ? selectionRect(element) : ""}</g>`;
  }
  const anchor = element.align === "center" ? "middle" : element.align === "end" ? "end" : "start";
  const x = element.align === "center" ? Number(element.x) + Number(element.w) / 2 : element.align === "end" ? Number(element.x) + Number(element.w) : Number(element.x);
  return `<g ${attrs}>
    <text x="${x}" y="${Number(element.y) + Number(element.fontSize || 3)}" text-anchor="${anchor}" font-size="${element.fontSize}" font-weight="${element.fontWeight}" fill="${escapeAttr(element.stroke || "#111827")}">${escapeHtml(text)}</text>
    ${selected ? selectionRect(element) : ""}
  </g>`;
}

function selectionRect(element) {
  return `<rect class="selection-box" x="${element.x}" y="${element.y}" width="${element.w}" height="${element.h}" />`;
}

function renderSelectedBarcodeProperties() {
  const element = getBarcodeElement(state.barcodeElementId);
  const disabled = !element;
  const fields = [
    "#barcodeElementText",
    "#barcodeElementX",
    "#barcodeElementY",
    "#barcodeElementW",
    "#barcodeElementH",
    "#barcodeElementRotate",
    "#barcodeElementFontSize",
    "#barcodeElementFontWeight",
    "#barcodeElementAlign",
    "#barcodeElementFill",
    "#barcodeElementStroke",
    "#barcodeElementStrokeWidth",
    "#barcodeElementImage"
  ];
  fields.forEach((selector) => (document.querySelector(selector).disabled = disabled));
  document.querySelector("#barcodeElementType").value = element ? typeNameForBarcodeElement(element.type) : "未选择";
  if (!element) return;
  document.querySelector("#barcodeElementText").value = element.text || "";
  document.querySelector("#barcodeElementX").value = element.x;
  document.querySelector("#barcodeElementY").value = element.y;
  document.querySelector("#barcodeElementW").value = element.w;
  document.querySelector("#barcodeElementH").value = element.h;
  document.querySelector("#barcodeElementRotate").value = element.rotate || 0;
  document.querySelector("#barcodeElementFontSize").value = element.fontSize || 3;
  document.querySelector("#barcodeElementFontWeight").value = element.fontWeight || 400;
  document.querySelector("#barcodeElementAlign").value = element.align || "start";
  document.querySelector("#barcodeElementFill").value = normalizeColor(element.fill || "#ffffff");
  document.querySelector("#barcodeElementStroke").value = normalizeColor(element.stroke || "#111827");
  document.querySelector("#barcodeElementStrokeWidth").value = element.strokeWidth ?? 0.2;
}

function updateSelectedBarcodeElement() {
  const element = getBarcodeElement(state.barcodeElementId);
  if (!element) return;
  element.text = document.querySelector("#barcodeElementText").value;
  element.x = Number(document.querySelector("#barcodeElementX").value || 0);
  element.y = Number(document.querySelector("#barcodeElementY").value || 0);
  element.w = Math.max(1, Number(document.querySelector("#barcodeElementW").value || 1));
  element.h = Math.max(1, Number(document.querySelector("#barcodeElementH").value || 1));
  element.rotate = Number(document.querySelector("#barcodeElementRotate").value || 0);
  element.fontSize = Math.max(1, Number(document.querySelector("#barcodeElementFontSize").value || 3));
  element.fontWeight = Number(document.querySelector("#barcodeElementFontWeight").value || 400);
  element.align = document.querySelector("#barcodeElementAlign").value;
  element.fill = document.querySelector("#barcodeElementFill").value;
  element.stroke = document.querySelector("#barcodeElementStroke").value;
  element.strokeWidth = Math.max(0, Number(document.querySelector("#barcodeElementStrokeWidth").value || 0));
  renderBarcodeEditor();
}

function updateBarcodeImageElement(event) {
  const element = getBarcodeElement(state.barcodeElementId);
  const file = event.target.files?.[0];
  if (!element || !file) return;
  const reader = new FileReader();
  reader.onload = () => {
    element.type = "image";
    element.src = reader.result;
    renderBarcodeEditor();
  };
  reader.readAsDataURL(file);
}

function addBarcodeElement(type) {
  if (!state.barcodeTemplate) return;
  const element = {
    id: `el_${Date.now()}`,
    type,
    text: defaultBarcodeElementText(type),
    x: 4,
    y: 4,
    w: type === "qrcode" ? 14 : type === "line" ? 22 : 28,
    h: type === "barcode" ? 18 : type === "qrcode" ? 14 : type === "line" ? 0 : 8,
    rotate: 0,
    fontSize: 3,
    fontWeight: 400,
    align: "start",
    fill: type === "rect" || type === "circle" ? "#ffffff" : "#000000",
    stroke: "#111827",
    strokeWidth: type === "text" || type === "time" || type === "barcode" || type === "qrcode" ? 0 : 0.3
  };
  state.barcodeTemplate.elements.push(element);
  state.barcodeElementId = element.id;
  renderBarcodeEditor();
}

function duplicateBarcodeElement() {
  const element = getBarcodeElement(state.barcodeElementId);
  if (!element || !state.barcodeTemplate) return;
  const copy = { ...element, id: `el_${Date.now()}`, x: Number(element.x) + 2, y: Number(element.y) + 2 };
  state.barcodeTemplate.elements.push(copy);
  state.barcodeElementId = copy.id;
  renderBarcodeEditor();
}

function deleteBarcodeElement() {
  if (!state.barcodeTemplate || !state.barcodeElementId) return;
  state.barcodeTemplate.elements = state.barcodeTemplate.elements.filter((element) => element.id !== state.barcodeElementId);
  state.barcodeElementId = state.barcodeTemplate.elements[0]?.id || "";
  renderBarcodeEditor();
}

function moveBarcodeElementLayer(direction) {
  const elements = state.barcodeTemplate?.elements || [];
  const index = elements.findIndex((element) => element.id === state.barcodeElementId);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= elements.length) return;
  [elements[index], elements[nextIndex]] = [elements[nextIndex], elements[index]];
  renderBarcodeEditor();
}

async function saveBarcodeTemplate() {
  if (!state.barcodeTemplate || !state.barcodeSelected?.sku) return;
  const { data } = await api("/api/barcodes/template", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sku: state.barcodeSelected.sku,
      name: document.querySelector("#barcodeName").value.trim() || state.barcodeTemplate.name,
      widthMm: state.barcodeTemplate.widthMm,
      heightMm: state.barcodeTemplate.heightMm,
      elements: state.barcodeTemplate.elements
    })
  });
  state.barcodeTemplate = data;
  showMessage("条码模板已保存。");
  renderBarcodeEditor();
}

function renderBarcodePreview() {
  const sheet = document.querySelector("#barcodePrintSheet");
  const template = state.barcodeTemplate;
  if (!template) {
    sheet.innerHTML = "";
    return;
  }
  const qty = Math.max(1, Math.min(500, Number(document.querySelector("#barcodeQty").value || 1)));
  const labelHtml = barcodeLabelHtml(template);
  sheet.innerHTML = Array.from({ length: qty }, () => labelHtml).join("");
}

function barcodeLabelHtml(template) {
  return `<article class="barcode-label" style="--label-w:${template.widthMm}mm;--label-h:${template.heightMm}mm">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${template.widthMm} ${template.heightMm}" width="${template.widthMm}mm" height="${template.heightMm}mm">
      <rect x="0" y="0" width="${template.widthMm}" height="${template.heightMm}" fill="#fff" />
      ${(template.elements || []).map((element) => barcodeElementSvg(element, { selectable: false })).join("")}
    </svg>
  </article>`;
}

function resolveBarcodeText(value) {
  const item = state.barcodeSelected || {};
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, ".");
  const datetime = `${date} ${now.toTimeString().slice(0, 5)}`;
  return String(value || "")
    .replaceAll("{sku}", item.sku || "")
    .replaceAll("{name}", item.productName || item.name || "")
    .replaceAll("{barcode}", item.barcode || item.sku || "")
    .replaceAll("{date}", date)
    .replaceAll("{datetime}", datetime);
}

function defaultBarcodeElementText(type) {
  if (type === "barcode" || type === "qrcode") return "{barcode}";
  if (type === "time") return "{datetime}";
  if (type === "text") return "{name}";
  return "";
}

function getBarcodeElement(id) {
  return (state.barcodeTemplate?.elements || []).find((element) => element.id === id) || null;
}

function typeNameForBarcodeElement(type) {
  return {
    text: "文本",
    time: "时间",
    barcode: "条形码",
    qrcode: "二维码",
    image: "图片",
    rect: "矩形",
    circle: "圆形",
    line: "线条"
  }[type] || type;
}

function selectedBarcodeSize() {
  return String(document.querySelector("#barcodeSize").value || "40x60")
    .split("x")
    .map((value) => Number(value));
}

function roundHalf(value) {
  return Math.round(Number(value || 0) * 2) / 2;
}

function normalizeColor(value) {
  return /^#[0-9a-f]{6}$/i.test(value || "") ? value : "#111827";
}

function updateBarcodePrintPageSize() {
  const [width, height] = state.barcodeTemplate ? [state.barcodeTemplate.widthMm, state.barcodeTemplate.heightMm] : selectedBarcodeSize();
  const styleId = "barcodePrintPageSize";
  let style = document.querySelector(`#${styleId}`);
  if (!style) {
    style = document.createElement("style");
    style.id = styleId;
    document.head.appendChild(style);
  }
  style.textContent = `@page { size: ${width}mm ${height}mm; margin: 0; }`;
}

function renderBarcodePrintHint() {
  const hint = document.querySelector("#barcodePrintHint");
  if (!hint) return;
  const [width, height] = state.barcodeTemplate ? [state.barcodeTemplate.widthMm, state.barcodeTemplate.heightMm] : selectedBarcodeSize();
  const sizeText = `${width} × ${height}`;
  const printer = document.querySelector("#barcodePrinter").value || "系统打印弹窗里选择";
  hint.innerHTML = `
    <strong>打印设置：</strong>
    标签纸 ${escapeHtml(sizeText)} mm，打印机 ${escapeHtml(printer)}。
    打印弹窗里请确认纸张/介质也是 ${escapeHtml(sizeText)} mm，缩放选择 100% 或“实际大小”。`;
}

function printBarcodeLabels() {
  renderBarcodeEditor();
  window.print();
}

async function matchUnmanagedOrderItem(button) {
  const row = JSON.parse(button.dataset.matchUnmanaged || "{}");
  const select = button.closest("tr").querySelector(".unmanaged-sku-select");
  const sku = select.value;
  if (!sku) {
    showMessage("请先选择要绑定的正式 SKU。");
    return;
  }
  button.disabled = true;
  try {
    const result = await api("/api/inventory/unmanaged-order-items/match", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...row, sku })
    });
    showMessage(
      `绑定成功：匹配 ${formatNumber(result.data.matchedCount)} 条，补扣 ${formatNumber(result.data.deductedQuantity)} 件库存。`
    );
    await refreshAll();
  } finally {
    button.disabled = false;
  }
}

async function openImageManager({ sku, name, images = [] }) {
  state.imageManager = { sku, name, images, index: 0 };
  document.querySelector("#imageManagerTitle").textContent = name || sku;
  document.querySelector("#imageManagerSubtitle").textContent = `SKU：${sku} · ${formatNumber(images.length)} 张图片`;
  renderImageManager();
  const dialog = document.querySelector("#imageManagerDialog");
  if (!dialog.open) dialog.showModal();
  await refreshImageManagerImages();
}

function closeImageManager() {
  document.querySelector("#imageManagerDialog").close();
}

async function refreshImageManagerImages() {
  const sku = state.imageManager.sku;
  if (!sku) return;
  const { data } = await api(`/api/skus/${encodeURIComponent(sku)}/images`);
  state.imageManager.images = data || [];
  if (state.imageManager.index >= state.imageManager.images.length) {
    state.imageManager.index = Math.max(0, state.imageManager.images.length - 1);
  }
  document.querySelector("#imageManagerSubtitle").textContent = `SKU：${sku} · ${formatNumber(state.imageManager.images.length)} 张图片`;
  renderImageManager();
}

function renderImageManager() {
  const images = state.imageManager.images || [];
  const current = images[state.imageManager.index];
  document.querySelector("#imageMainPreview").innerHTML = current
    ? `<img src="${escapeAttr(API_BASE + current.publicUrl)}" alt="${escapeAttr(current.originalName || state.imageManager.name)}" />
       <span>${escapeHtml(current.originalName || `图片 ${state.imageManager.index + 1}`)}</span>`
    : `<div class="empty-image-preview">暂无图片<br />点击右侧上传多张图片</div>`;
  document.querySelector("#imageManagerList").innerHTML = images.length
    ? images
        .map(
          (image, index) => `<button class="${index === state.imageManager.index ? "active" : ""}" data-image-manager-index="${index}" type="button">
            <img src="${escapeAttr(API_BASE + image.publicUrl)}" alt="${escapeAttr(image.originalName || "")}" />
            <span>${escapeHtml(image.originalName || `图片 ${index + 1}`)}</span>
          </button>`
        )
        .join("")
    : `<p class="empty">还没有图片。</p>`;
  document.querySelectorAll("[data-image-manager-index]").forEach((button) => {
    button.addEventListener("click", () => {
      state.imageManager.index = Number(button.dataset.imageManagerIndex || 0);
      renderImageManager();
    });
  });
}

async function uploadImageManagerFiles() {
  const input = document.querySelector("#imageManagerUpload");
  const sku = state.imageManager.sku;
  const files = Array.from(input.files || []);
  if (!sku || files.length === 0) return;
  const body = new FormData();
  files.forEach((file) => body.append("images", file));
  const result = await api(`/api/skus/${encodeURIComponent(sku)}/images`, { method: "POST", body });
  showMessage(`图片上传成功：${sku} 新增 ${result.data.length} 张图片。`);
  input.value = "";
  await refreshImageManagerImages();
  await loadInventory();
}

async function saveInventoryQuantity(input) {
  const original = Number(input.dataset.originalValue ?? input.defaultValue ?? 0);
  const quantity = Number(input.value || 0);
  if (!Number.isFinite(quantity)) {
    input.value = original;
    showMessage("库存数量格式不正确。");
    return;
  }
  if (quantity === original) return;
  input.disabled = true;
  const sku = input.dataset.sku;
  try {
    const result = await api(`/api/inventory/${encodeURIComponent(sku)}/quantity`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        quantity,
        warehouseId: input.dataset.warehouseId || document.querySelector("#inventoryWarehouse").value || "cainiao"
      })
    });
    showMessage(`库存编辑成功：${sku} ${formatNumber(result.data.beforeQuantity)} -> ${formatNumber(result.data.afterQuantity)}，已记录操作日志。`);
    await refreshAll();
  } catch (error) {
    input.value = original;
    showMessage(`库存编辑失败：${error.message}`);
  } finally {
    input.disabled = false;
  }
}

async function loadSales() {
  const month = document.querySelector("#businessMonth").value || todayMonth();
  const { data } = await api(`/api/reports/monthly-sales?month=${encodeURIComponent(month)}`);
  document.querySelector("#salesBody").innerHTML = data.items.length
    ? data.items
    .map(
      (item) => `<tr>
        <td>${escapeHtml(item.sku)}</td>
        <td>${escapeHtml(item.name)}</td>
        <td>${item.quantity || 0}</td>
        <td>${money(item.salesAmount)}</td>
        <td>${money(item.productCost)}</td>
        <td>${money(item.estimatedGrossProfit)}</td>
      </tr>`
    )
    .join("")
    : `<tr><td colspan="6" class="empty-table">这个月份还没有订单明细，导入订单后这里会自动出现 SKU 销售、销售额和毛利。</td></tr>`;
}

async function saveSku(sku) {
  const row = document.querySelector(`[data-save-sku="${cssEscape(sku)}"]`).closest("tr");
  const payload = {
    name: row.querySelector(".name-cell")?.textContent?.trim() || undefined,
    costPrice: Number(row.querySelector(".sku-cost").value || 0),
    lowStockThreshold: Number(row.querySelector(".sku-low").value || 10)
  };
  await api(`/api/skus/${encodeURIComponent(sku)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  showMessage("成本和预警线已保存。");
  await refreshAll();
}

function bindImportForm(selector, url) {
  // 所有 Excel/CSV/ZIP 导入表单走同一套交互：
  // 上传 -> 后端解析 -> 原始文件归档去重 -> 刷新所有模块。
  document.querySelector(selector).addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = new FormData(form);
    const result = await api(url, { method: "POST", body });
    const fileText = result.data.file?.duplicate ? "，文件已存在未重复保存" : "，文件已保存";
    showMessage(`导入成功：${result.data.successCount}/${result.data.rowCount} 行${result.data.file ? fileText : ""}。`);
    form.reset();
    await refreshAll();
  });
}

async function importProjectFolder() {
  const confirmed = window.confirm(
    "这会重新扫描 /Users/chenyuecai/店口五金 并导入销售、采购、售后、资产等项目数据。确定要导入吗？"
  );
  if (!confirmed) return;
  const result = await api("/api/import/project-folder", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ root: "/Users/chenyuecai/店口五金" })
  });
  showMessage(`项目文件扫描完成：${result.data.importedFiles}/${result.data.totalFiles} 个文件有可用数据。`);
  await refreshAll();
}

async function quickImportInventory(event) {
  const file = event.currentTarget.files[0];
  if (!file) return;
  const body = new FormData();
  body.append("warehouseId", document.querySelector("#inventoryWarehouse").value || "cainiao");
  body.append("snapshotDate", new Date().toISOString().slice(0, 10));
  body.append("file", file);
  const result = await api("/api/import/inventory", { method: "POST", body });
  const fileText = result.data.file?.duplicate ? "，文件已存在未重复保存" : "，文件已保存";
  showMessage(`快捷导入成功：${result.data.successCount}/${result.data.rowCount} 行${fileText}。`);
  event.currentTarget.value = "";
  await refreshAll();
}

async function exportInventoryCsv() {
  const selectedWarehouseId = document.querySelector("#inventoryWarehouse").value || "cainiao";
  const selectedWarehouseName =
    state.config.warehouses.find((warehouse) => warehouse.id === selectedWarehouseId)?.name || selectedWarehouseId;
  const { data } = await api(`/api/reports/inventory?warehouseId=${encodeURIComponent(selectedWarehouseId)}`);
  const rows = [[
    "SKU",
    "商品名称",
    "商品编码",
    "外部商品ID",
    "总库存数",
    `${selectedWarehouseName}库存`,
    "菜鸟云仓库存",
    "上海仓库库存",
    "诸暨仓库库存",
    "成本价",
    "预警线",
    "月度出库量",
    "库存预警",
    "图片数量",
    "图片链接",
    "仓库明细"
  ]];
  data.items.forEach((item) => {
    const warehouseQuantity = (warehouseId) =>
      item.warehouses.find((warehouse) => warehouse.warehouseId === warehouseId)?.quantity || 0;
    rows.push([
      item.sku,
      item.name,
      item.barcode || item.sku,
      item.externalProductId || "",
      item.totalQuantity,
      item.selectedWarehouse?.quantity || 0,
      warehouseQuantity("cainiao"),
      warehouseQuantity("shanghai"),
      warehouseQuantity("zhuji"),
      item.costPrice || 0,
      item.lowStockThreshold,
      item.monthlyOutbound || 0,
      item.stockAlert?.text || "",
      item.images?.length || 0,
      (item.images || []).map((image) => `${location.origin}${image.publicUrl}`).join(" / "),
      item.warehouses.map((w) => `${w.warehouseName}:${w.quantity}`).join(" / ")
    ]);
  });
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `商品库存-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

async function sendDingTalk(payload) {
  // 钉钉消息正文由后端 reports.js 生成，前端只传类型和月份。
  // 这样库存预警口径变化时，不需要在页面里重复维护文案。
  const result = await api("/api/dingtalk/send-report", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  showMessage(`钉钉已发送：${result.report?.title || result.data?.title || "完成"}`);
}

async function createCompetitor(event) {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
  payload.sku = state.competitorSku;
  if (!payload.sku) {
    showMessage("请先选择正式库存 SKU。");
    return;
  }
  await api("/api/competitors", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  event.currentTarget.reset();
  await loadCompetitors();
}

async function loadCompetitors() {
  if (!state.competitorSku) {
    document.querySelector("#competitorBody").innerHTML = `<tr><td colspan="8" class="empty-table">请先导入正式库存 SKU，再维护同行链接。</td></tr>`;
    document.querySelector("#competitorSkuCard").innerHTML = "";
    document.querySelector("#competitorPriceChart").innerHTML = '<p class="empty">暂无数据</p>';
    document.querySelector("#competitorSalesChart").innerHTML = '<p class="empty">暂无数据</p>';
    return;
  }
  const { data } = await api(`/api/competitors?sku=${encodeURIComponent(state.competitorSku)}`);
  renderCompetitorSkuCard(data.comparison || {});
  document.querySelector("#competitorBody").innerHTML = data.items.length
    ? data.items
    .map(
      (item) => `<tr>
        <td><a href="${escapeAttr(item.url)}" target="_blank">${escapeHtml(item.label)}</a></td>
        <td>${escapeHtml(item.relation === "own" ? "我的商品" : "同行")}</td>
        <td>${escapeHtml(item.platform)}</td>
        <td>${item.price == null ? "-" : money(item.price)}</td>
        <td title="${escapeAttr(item.error || "")}">${escapeHtml(item.salesText || "-")}</td>
        <td class="${item.status === "error" ? "danger" : item.status === "partial" ? "warning" : "ok"}" title="${escapeAttr(item.error || "")}">
          ${escapeHtml(item.status || "未抓取")}${item.error ? `<small>${escapeHtml(item.error)}</small>` : ""}
        </td>
        <td>
          <select data-competitor-enabled="${item.id}">
            <option value="1" ${Number(item.enabled) ? "selected" : ""}>启用</option>
            <option value="0" ${Number(item.enabled) ? "" : "selected"}>停用</option>
          </select>
        </td>
        <td><button data-competitor-snapshot="${item.id}">抓取</button></td>
      </tr>`
    )
    .join("")
    : `<tr><td colspan="8" class="empty-table">这个 SKU 还没有维护我的/同行商品链接。</td></tr>`;
  renderUnboundCompetitors(data.unboundItems || []);
  await renderCompetitorTrendCharts(data.items || []);
  document.querySelectorAll("[data-competitor-enabled]").forEach((select) => {
    select.addEventListener("change", () => updateCompetitorEnabled(select));
  });
  document.querySelectorAll("[data-competitor-snapshot]").forEach((button) => {
    button.addEventListener("click", () => runOneCompetitorSnapshot(button.dataset.competitorSnapshot));
  });
}

async function runCompetitorSnapshot() {
  const result = await api("/api/competitors/run-snapshot", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sku: state.competitorSku })
  });
  showMessage(`同行数据抓取完成：${result.results?.length || 0} 条。`);
  await loadCompetitors();
}

async function runAllCompetitorSnapshots() {
  const result = await api("/api/competitors/run-snapshot", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({})
  });
  showMessage(`全部同行链接抓取完成：${result.results?.length || 0} 条。`);
  await loadCompetitors();
}

async function runOneCompetitorSnapshot(id) {
  const result = await api("/api/competitors/run-snapshot", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id })
  });
  showMessage(`单条链接抓取完成：${result.results?.length || 0} 条。`);
  await loadCompetitors();
}

async function updateCompetitorEnabled(select) {
  await api(`/api/competitors/${encodeURIComponent(select.dataset.competitorEnabled)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled: select.value })
  });
  showMessage("链接状态已更新。");
  await loadCompetitors();
}

async function bindUnboundCompetitor(button) {
  await api(`/api/competitors/${encodeURIComponent(button.dataset.bindUnboundCompetitor)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sku: state.competitorSku })
  });
  showMessage("未绑定链接已归到当前 SKU。");
  await loadCompetitors();
}

async function api(url, options = {}) {
  // 后端约定返回 { ok, data, error }。统一在这里抛错，
  // 页面函数就可以只写成功路径，失败交给浏览器控制台和 toast 暴露。
  const response = await fetch(`${API_BASE}${url}`, options);
  const payload = await response.json();
  if (!response.ok || payload.ok === false) throw new Error(payload.error || "请求失败");
  return payload;
}

function fillSelect(selector, items, valueKey, labelKey) {
  document.querySelector(selector).innerHTML = items
    .map((item) => `<option value="${escapeAttr(item[valueKey])}">${escapeHtml(item[labelKey])}</option>`)
    .join("");
}

function fillStoreInputs(stores) {
  const options = (stores || []).map((store) => `<option value="${escapeAttr(store.id || store.name)}">${escapeHtml(store.name || store.id)}</option>`).join("");
  document.querySelector("#storeOptions").innerHTML = options;
  document.querySelector("#ordersStore").innerHTML = `<option value="">全部店铺</option>${options}`;
  if (!document.querySelector("#ordersStoreForm").value) {
    document.querySelector("#ordersStoreForm").value = stores?.[0]?.id || "店口五金店";
  }
}

function fillCompetitorSkuSelect() {
  const select = document.querySelector("#competitorSkuSelect");
  if (!select) return;
  select.innerHTML = state.skus
    .map((sku) => `<option value="${escapeAttr(sku.sku)}">${escapeHtml(`${sku.sku} ${sku.name || ""}`)}</option>`)
    .join("");
  select.value = state.competitorSku || state.skus[0]?.sku || "";
}

function renderCompetitorSkuCard(comparison = {}) {
  const sku = state.skus.find((item) => item.sku === state.competitorSku);
  document.querySelector("#competitorSkuCard").innerHTML = [
    businessMetric("当前 SKU", state.competitorSku || "-", sku?.name || "正式库存商品"),
    businessMetric("成本价", money(sku?.costPrice), "来自库存总览 SKU 成本"),
    businessMetric("链接数", formatNumber(comparison.linkCount), "我的商品和同行链接"),
    businessMetric("我的最低价", comparison.ownPrice == null ? "-" : money(comparison.ownPrice), "公开页面识别价格"),
    businessMetric("同行最低价", comparison.minCompetitorPrice == null ? "-" : money(comparison.minCompetitorPrice), "公开页面识别价格"),
    businessMetric("价差", comparison.priceGap == null ? "-" : money(comparison.priceGap), "我的价格 - 同行最低价")
  ].join("");
}

function renderUnboundCompetitors(items) {
  document.querySelector("#unboundCompetitorCount").textContent = `${formatNumber(items.length)} 条`;
  document.querySelector("#unboundCompetitorBody").innerHTML = items.length
    ? items
        .map((item) => `<tr>
          <td>${escapeHtml(item.label)}</td>
          <td>${escapeHtml(item.platform)}</td>
          <td><a href="${escapeAttr(item.url)}" target="_blank">${escapeHtml(shortFileName(item.url))}</a></td>
          <td><button data-bind-unbound-competitor="${item.id}">绑定</button></td>
        </tr>`)
        .join("")
    : `<tr><td colspan="4" class="empty-table">没有未绑定链接。</td></tr>`;
  document.querySelectorAll("[data-bind-unbound-competitor]").forEach((button) => {
    button.addEventListener("click", () => bindUnboundCompetitor(button));
  });
}

async function renderCompetitorTrendCharts(items) {
  const enabledItems = items.slice(0, 6);
  const snapshotGroups = await Promise.all(
    enabledItems.map(async (item) => ({
      item,
      rows: (await api(`/api/competitors/${encodeURIComponent(item.id)}/snapshots?range=90`)).data
    }))
  );
  const priceRows = snapshotGroups.flatMap((group) =>
    group.rows
      .filter((row) => row.price != null)
      .slice(-12)
      .map((row) => ({ label: `${row.snapshotDate.slice(5)} ${group.item.label}`.slice(0, 18), value: Number(row.price) }))
  );
  const salesRows = snapshotGroups.flatMap((group) =>
    group.rows
      .filter((row) => row.salesValue != null)
      .slice(-12)
      .map((row) => ({ label: `${row.snapshotDate.slice(5)} ${group.item.label}`.slice(0, 18), value: Number(row.salesValue) }))
  );
  renderSimpleRows("#competitorPriceChart", priceRows, money);
  renderSimpleRows("#competitorSalesChart", salesRows, (value) => `${formatNumber(value)}`);
}

function metric(label, value) {
  return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${value}</strong></div>`;
}

function renderBusinessMetrics(data, orderSummary = {}) {
  const totals = data.totals || {};
  document.querySelector("#businessMetrics").innerHTML = [
    businessMetric("销售额", money(totals.salesAmount), "财务汇总优先，没有财务表时使用订单销售额"),
    businessMetric("订单数", formatNumber(orderSummary.orderCount), "已导入的主订单"),
    businessMetric("订单销售", money(totals.orderSalesAmount), "来自已导入订单"),
    businessMetric("已扣库存", `${formatNumber(orderSummary.deductedQuantity)} 件`, "订单导入和映射补扣"),
    businessMetric("待匹配", `${formatNumber(orderSummary.unmatchedLineCount)} 条`, "需要到店铺商品管理绑定 SKU"),
    businessMetric("邮费", money(totals.shippingFee), "来自菜鸟或平台邮费账单"),
    businessMetric("采购金额", money(totals.purchaseAmount), "来自采购记录"),
    businessMetric("售后单数", formatNumber(totals.returnCount), "来自售后退货记录"),
    businessMetric("导入文件", `${formatNumber(totals.savedFileCount)} 个`, "已保存且去重的原始文件")
  ].join("");
}

function businessMetric(label, value, hint) {
  return `<div class="business-card">
    <span>${escapeHtml(label)}</span>
    <strong>${escapeHtml(value)}</strong>
    <small>${escapeHtml(hint)}</small>
  </div>`;
}

function skuOptions() {
  return state.skus
    .map((sku) => `<option value="${escapeAttr(sku.sku)}">${escapeHtml(`${sku.sku} ${sku.name || ""}`)}</option>`)
    .join("");
}

function renderBarChart(selector, rows, labelKey, valueKey, format = (value) => value) {
  const cleanRows = (rows || []).filter((row) => Number(row[valueKey] || 0) !== 0);
  const max = Math.max(1, ...cleanRows.map((row) => Number(row[valueKey] || 0)));
  document.querySelector(selector).innerHTML = cleanRows
    .slice(-12)
    .map((row) => {
      const value = Number(row[valueKey] || 0);
      const width = Math.max(3, Math.round((value / max) * 100));
      return `<div class="bar-row">
        <span>${escapeHtml(row[labelKey])}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div>
        <strong>${format(value)}</strong>
      </div>`;
    })
    .join("") || '<p class="empty">暂无数据</p>';
}

function renderSimpleRows(selector, rows, format = (value) => value) {
  const cleanRows = (rows || []).filter((row) => Number(row.value || 0) !== 0);
  const max = Math.max(1, ...cleanRows.map((row) => Number(row.value || 0)));
  document.querySelector(selector).innerHTML = cleanRows
    .slice(-18)
    .map((row) => {
      const value = Number(row.value || 0);
      const width = Math.max(3, Math.round((value / max) * 100));
      return `<div class="bar-row">
        <span>${escapeHtml(row.label)}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div>
        <strong>${format(value)}</strong>
      </div>`;
    })
    .join("") || '<p class="empty">暂无历史快照</p>';
}

function renderOpsChart(data) {
  const purchase = data.purchaseMonthly.map((row) => ({
    label: row.month,
    value: Number(row.amount || 0),
    text: `${row.count}笔 ${money(row.amount)}`
  }));
  const returns = data.returnMonthly.map((row) => ({
    label: row.month,
    value: Number(row.count || 0),
    text: `${row.count}单`
  }));
  const shipping = (data.shippingMonthly || []).map((row) => ({
    label: `${row.month}邮`,
    value: Number(row.amount || 0),
    text: money(row.amount)
  }));
  const rows = [
    ...shipping.slice(-6),
    ...purchase.slice(-6),
    ...returns.slice(-6).map((row) => ({ ...row, label: `${row.label}退` }))
  ];
  const max = Math.max(1, ...rows.map((row) => row.value));
  document.querySelector("#opsChart").innerHTML = rows
    .map((row) => `<div class="bar-row">
      <span>${escapeHtml(row.label)}</span>
      <div class="bar-track"><div class="bar-fill alt" style="width:${Math.max(3, Math.round((row.value / max) * 100))}%"></div></div>
      <strong>${escapeHtml(row.text)}</strong>
    </div>`)
    .join("") || '<p class="empty">暂无数据</p>';
}

function shortFileName(name) {
  const text = String(name || "");
  return text.length > 26 ? `${text.slice(0, 12)}...${text.slice(-10)}` : text;
}

function typeName(type) {
  return {
    cainiao: "菜鸟云仓",
    qianniu: "千牛/淘宝",
    jd: "京东",
    pdd: "拼多多",
    inventory: "库存",
    orders: "订单",
    shipping: "邮费",
    monthly_outbound: "月度出库",
    monthly_financials: "经营月报",
    purchase_records: "采购",
    return_records: "售后退货",
    fixed_assets: "固定资产"
  }[type] || type;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

function pseudoMetric(seed, max) {
  let hash = 0;
  for (const char of String(seed)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % max;
}

function sumPseudo(items, suffix, max) {
  return items.reduce((sum, item) => sum + pseudoMetric(`${item.sku}-${suffix}`, max), 0);
}

function sparkline(seed, quantity) {
  const points = [];
  let hash = 0;
  for (const char of String(seed)) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  for (let index = 0; index < 18; index += 1) {
    hash = (hash * 1664525 + 1013904223) >>> 0;
    const spike = hash % 9 === 0 ? 34 : hash % 4 === 0 ? 22 : 4;
    const y = Math.max(4, 38 - spike - (Number(quantity || 0) % 7));
    points.push(`${index * 8},${y}`);
  }
  return `<svg class="spark" viewBox="0 0 144 42" preserveAspectRatio="none"><polyline points="${points.join(" ")}" /></svg>`;
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function showMessage(message) {
  const importMessage = document.querySelector("#importMessage");
  if (importMessage) importMessage.textContent = message;
  const toast = document.querySelector("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showMessage.timer);
  showMessage.timer = window.setTimeout(() => toast.classList.remove("show"), 3200);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

function cssEscape(value) {
  return String(value).replace(/["\\]/g, "\\$&");
}
