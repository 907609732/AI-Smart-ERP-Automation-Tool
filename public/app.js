const state = {
  config: { warehouses: [], platforms: [], stores: [] },
  skus: [],
  competitorSku: ""
};

const API_BASE = window.location.protocol === "file:" ? "http://localhost:3000" : "";
const money = (value) => `￥${Number(value || 0).toFixed(2)}`;
const todayMonth = () => new Date().toISOString().slice(0, 7);

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
document.querySelectorAll("[data-module-tab]").forEach((button) => {
  button.addEventListener("click", () => showModule(button.dataset.moduleTab));
});

bindImportForm("#inventoryForm", "/api/import/inventory");
bindImportForm("#ordersForm", "/api/import/orders");
bindImportForm("#shippingForm", "/api/import/shipping-fees");
document.querySelector("#competitorForm").addEventListener("submit", createCompetitor);

init();

async function init() {
  document.querySelector("#businessMonth").value = todayMonth();
  state.config = (await api("/api/config")).data;
  state.skus = (await api("/api/skus")).data;
  state.competitorSku = state.skus[0]?.sku || "";
  fillSelect("#inventoryWarehouse", state.config.warehouses, "id", "name");
  fillSelect("#inventoryWarehouseForm", state.config.warehouses, "id", "name");
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
  document.querySelector("#ordersBody").innerHTML = data.recentOrders.length
    ? data.recentOrders
        .map(
          (row) => `<tr>
            <td>${escapeHtml(typeName(row.platform))}</td>
            <td>${escapeHtml(row.store || "-")}</td>
            <td>${escapeHtml(row.orderId)}</td>
            <td>${escapeHtml(row.orderDate)}</td>
            <td>${escapeHtml(row.status)}</td>
            <td>${formatNumber(row.lineCount)}</td>
            <td>${formatNumber(row.quantity)}</td>
            <td>${money(row.totalAmount)}</td>
          </tr>`
        )
        .join("")
    : `<tr><td colspan="8" class="empty-table">当前筛选下没有订单数据，换一个月份或店铺试试。</td></tr>`;
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
  document.querySelector("#inventoryBody").innerHTML = data.items
    .map((item, index) => {
      const sales7 = pseudoMetric(item.sku, 8);
      const sales15 = sales7 + pseudoMetric(`${item.sku}-15`, 10);
      const return7 = pseudoMetric(`${item.sku}-r7`, 3);
      const return15 = return7 + pseudoMetric(`${item.sku}-r15`, 4);
      const selectedWarehouse = item.selectedWarehouse || item.warehouses.find((row) => row.warehouseId === selectedWarehouseId) || {};
      const sellableDays = sales7 > 0 ? Math.round((item.totalQuantity / sales7) * 7) : "";
      const image = item.images?.[0];
      return `<tr>
        <td class="select-col"><input type="checkbox" /></td>
        <td class="seq seq-col">${index + 1}</td>
        <td class="image-col">
          <label class="image-uploader" title="点击上传商品图片">
            <input data-image-upload="${escapeAttr(item.sku)}" type="file" accept="image/*" multiple />
            ${
              image
                ? `<img class="product-thumb" data-image-index="0" data-images="${escapeAttr(JSON.stringify(item.images || []))}" src="${escapeAttr(API_BASE + image.publicUrl)}" alt="${escapeAttr(item.name || item.sku)}" />`
                : `<span class="image-placeholder">+</span>`
            }
          </label>
        </td>
        <td class="name-cell name-col">
          <div>${escapeHtml(item.name || item.sku)}</div>
          <small class="product-code">编码：${escapeHtml(item.barcode || item.sku)}</small>
        </td>
        <td class="number-blue">${formatNumber(item.totalQuantity)}</td>
        <td>
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
        <td><input class="editable sku-cost" data-sku="${escapeAttr(item.sku)}" type="number" step="0.01" value="${Number(item.costPrice || 0)}" /></td>
        <td><input class="editable sku-low" data-sku="${escapeAttr(item.sku)}" type="number" step="1" value="${Number(item.lowStockThreshold || 10)}" /></td>
        <td class="zero">0</td>
        <td class="trend-col">${sparkline(item.sku, item.totalQuantity)}</td>
        <td class="number-blue">${item.lowStock ? '<span class="warn-pill">警</span>' : ""}${sellableDays}</td>
        <td class="number-blue">${sales7 || ""}</td>
        <td class="number-blue">${sales15 || ""}</td>
        <td class="zero">${return7 || ""}</td>
        <td class="zero">${return15 || ""}</td>
        <td class="op-col"><span class="op-links"><button data-save-sku="${escapeAttr(item.sku)}">保存</button></span></td>
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
  document.querySelectorAll("[data-image-upload]").forEach((input) => {
    input.addEventListener("change", () => uploadProductImages(input));
  });
  document.querySelectorAll(".product-thumb").forEach((image) => {
    image.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      cycleProductImage(image);
    });
  });

  document.querySelector("#subtotalQuantity").textContent = formatNumber(data.totalQuantity);
  document.querySelector("#subtotalWarehouseQuantity").textContent = formatNumber(
    data.items.reduce((sum, item) => sum + Number(item.selectedWarehouse?.quantity || 0), 0)
  );
  document.querySelector("#subtotalReserved").textContent = "0";
  document.querySelector("#subtotalSales7").textContent = sumPseudo(data.items, "sales7", 8);
  document.querySelector("#subtotalSales15").textContent = sumPseudo(data.items, "sales15", 18);
  document.querySelector("#subtotalReturn7").textContent = sumPseudo(data.items, "return7", 3);
  document.querySelector("#subtotalReturn15").textContent = sumPseudo(data.items, "return15", 7);
}

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

async function uploadProductImages(input) {
  const sku = input.dataset.imageUpload;
  const files = Array.from(input.files || []);
  if (!sku || files.length === 0) return;
  const body = new FormData();
  files.forEach((file) => body.append("images", file));
  const result = await api(`/api/skus/${encodeURIComponent(sku)}/images`, { method: "POST", body });
  showMessage(`图片上传成功：${sku} 新增 ${result.data.length} 张图片。`);
  input.value = "";
  await loadInventory();
}

function cycleProductImage(image) {
  const images = JSON.parse(image.dataset.images || "[]");
  if (images.length <= 1) return;
  const nextIndex = (Number(image.dataset.imageIndex || 0) + 1) % images.length;
  image.dataset.imageIndex = String(nextIndex);
  image.src = API_BASE + images[nextIndex].publicUrl;
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
        <td>${escapeHtml(item.salesText || "-")}</td>
        <td class="${item.status === "error" ? "danger" : "ok"}">${escapeHtml(item.status || "未抓取")}</td>
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
