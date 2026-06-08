import { currentMonth, getDb, nowDate } from "./db.js";

export function getWarehouses() {
  return getDb().prepare("SELECT id, name FROM warehouses ORDER BY rowid").all();
}

export function getSkus() {
  return getDb()
    .prepare(
      `SELECT sku, name, barcode, external_product_id AS externalProductId,
              cost_price AS costPrice, low_stock_threshold AS lowStockThreshold,
              cainiao_code AS cainiaoCode, qianniu_code AS qianniuCode,
              jd_code AS jdCode, pdd_code AS pddCode
       FROM skus
       WHERE status = 'active' AND source IN ('manual', 'inventory')
       ORDER BY sku`
    )
    .all();
}

export function updateSku(sku, payload) {
  getDb()
    .prepare(
      `UPDATE skus SET
         name = COALESCE(@name, name),
         barcode = COALESCE(@barcode, barcode),
         cost_price = COALESCE(@costPrice, cost_price),
         low_stock_threshold = COALESCE(@lowStockThreshold, low_stock_threshold),
         cainiao_code = COALESCE(@cainiaoCode, cainiao_code),
         qianniu_code = COALESCE(@qianniuCode, qianniu_code),
         jd_code = COALESCE(@jdCode, jd_code),
         pdd_code = COALESCE(@pddCode, pdd_code),
         updated_at = CURRENT_TIMESTAMP
       WHERE sku = @sku`
    )
    .run({
      sku,
      name: payload.name ?? null,
      barcode: payload.barcode ?? null,
      costPrice: payload.costPrice ?? null,
      lowStockThreshold: payload.lowStockThreshold ?? null,
      cainiaoCode: payload.cainiaoCode ?? null,
      qianniuCode: payload.qianniuCode ?? null,
      jdCode: payload.jdCode ?? null,
      pddCode: payload.pddCode ?? null
    });
  return getDb().prepare("SELECT * FROM skus WHERE sku = ?").get(sku);
}

export function updateInventoryQuantity(sku, payload) {
  const db = getDb();
  const warehouseId = payload.warehouseId || "cainiao";
  const targetQuantity = Number(payload.quantity);
  if (!sku) throw new Error("缺少 SKU。");
  if (!Number.isFinite(targetQuantity)) throw new Error("库存数量不正确。");

  const report = getInventoryReport({ warehouseId });
  const item = report.items.find((row) => row.sku === sku);
  const warehouse =
    item?.warehouses.find((row) => row.warehouseId === warehouseId) ||
    item?.warehouses[0] ||
    {
      warehouseId,
      warehouseName: warehouseName(warehouseId),
      snapshotDate: nowDate(),
      snapshotQuantity: 0,
      movementQuantity: 0,
      quantity: 0
    };
  const beforeQuantity = Number(warehouse.quantity || 0);
  const totalBeforeQuantity = Number(item?.totalQuantity || 0);
  const diff = targetQuantity - beforeQuantity;
  const newSnapshotQuantity = Number(warehouse.snapshotQuantity || 0) + diff;
  const snapshotDate = warehouse.snapshotDate || nowDate();

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO inventory_snapshots (sku, warehouse_id, snapshot_date, quantity, source)
       VALUES (@sku, @warehouseId, @snapshotDate, @quantity, 'manual')
       ON CONFLICT(sku, warehouse_id, snapshot_date) DO UPDATE SET
         quantity = excluded.quantity,
         source = 'manual',
         imported_at = CURRENT_TIMESTAMP`
    ).run({
      sku,
      warehouseId: warehouse.warehouseId || warehouseId,
      snapshotDate,
      quantity: newSnapshotQuantity
    });
    db.prepare(
      `INSERT INTO operation_logs
         (entity_type, entity_id, action, before_value, after_value, note)
       VALUES
         ('inventory', @sku, 'update_quantity', @beforeValue, @afterValue, @note)`
    ).run({
      sku,
      beforeValue: JSON.stringify({
        totalQuantity: totalBeforeQuantity,
        warehouseQuantity: beforeQuantity,
        warehouseId: warehouse.warehouseId || warehouseId,
        snapshotQuantity: warehouse.snapshotQuantity || 0,
        movementQuantity: warehouse.movementQuantity || 0
      }),
      afterValue: JSON.stringify({
        totalQuantity: totalBeforeQuantity + diff,
        warehouseQuantity: targetQuantity,
        warehouseId: warehouse.warehouseId || warehouseId,
        snapshotDate,
        snapshotQuantity: newSnapshotQuantity
      }),
      note: `手动编辑${warehouseName(warehouse.warehouseId || warehouseId)}库存：${beforeQuantity} -> ${targetQuantity}`
    });
  });
  tx();

  return {
    sku,
    warehouseId: warehouse.warehouseId || warehouseId,
    beforeQuantity,
    afterQuantity: targetQuantity,
    beforeTotalQuantity: totalBeforeQuantity,
    afterTotalQuantity: totalBeforeQuantity + diff,
    snapshotDate,
    snapshotQuantity: newSnapshotQuantity
  };
}

export function getOperationLogs({ entityType = "", limit = 80 } = {}) {
  const db = getDb();
  const safeLimit = Math.min(Math.max(Number(limit) || 80, 1), 200);
  if (entityType) {
    return db
      .prepare(
        `SELECT id, entity_type AS entityType, entity_id AS entityId,
                action, before_value AS beforeValue, after_value AS afterValue,
                note, operator, created_at AS createdAt
         FROM operation_logs
         WHERE entity_type = ?
         ORDER BY id DESC
         LIMIT ?`
      )
      .all(entityType, safeLimit);
  }
  return db
    .prepare(
      `SELECT id, entity_type AS entityType, entity_id AS entityId,
              action, before_value AS beforeValue, after_value AS afterValue,
              note, operator, created_at AS createdAt
       FROM operation_logs
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(safeLimit);
}

export function getInventoryReport({ warehouseId = "" } = {}) {
  const rows = getDb()
    .prepare(
      `WITH latest AS (
         SELECT sku, warehouse_id, MAX(snapshot_date) AS snapshot_date
         FROM inventory_snapshots
         GROUP BY sku, warehouse_id
       )
       SELECT s.sku, s.name, s.barcode, s.external_product_id AS externalProductId,
              s.cost_price AS costPrice,
              s.low_stock_threshold AS lowStockThreshold,
              w.id AS warehouseId, w.name AS warehouseName,
              i.snapshot_date AS snapshotDate, i.quantity
       FROM latest l
       JOIN inventory_snapshots i
         ON i.sku = l.sku AND i.warehouse_id = l.warehouse_id AND i.snapshot_date = l.snapshot_date
       JOIN skus s ON s.sku = i.sku
       JOIN warehouses w ON w.id = i.warehouse_id
       WHERE s.status = 'active' AND s.source IN ('manual', 'inventory')
       ORDER BY s.sku, w.rowid`
    )
    .all();

  const movementRows = getDb()
    .prepare(
      `WITH latest AS (
         SELECT sku, warehouse_id, MAX(snapshot_date) AS snapshot_date
         FROM inventory_snapshots
         GROUP BY sku, warehouse_id
       )
       SELECT m.sku, m.warehouse_id AS warehouseId,
              SUM(m.quantity) AS movementQuantity
       FROM inventory_movements m
       LEFT JOIN latest l ON l.sku = m.sku AND l.warehouse_id = m.warehouse_id
       WHERE l.snapshot_date IS NULL OR m.movement_date >= l.snapshot_date
       GROUP BY m.sku, m.warehouse_id`
    )
    .all();
  const movementsBySkuWarehouse = new Map(
    movementRows.map((row) => [`${row.sku}\u0000${row.warehouseId}`, Number(row.movementQuantity || 0)])
  );

  const bySku = new Map();
  const seenSkuWarehouse = new Set();
  for (const row of rows) {
    if (!bySku.has(row.sku)) {
      bySku.set(row.sku, {
        sku: row.sku,
        name: row.name,
        barcode: row.barcode,
        externalProductId: row.externalProductId,
        costPrice: row.costPrice,
        lowStockThreshold: row.lowStockThreshold,
        snapshotQuantity: 0,
        movementQuantity: 0,
        totalQuantity: 0,
        warehouses: []
      });
    }
    const item = bySku.get(row.sku);
    seenSkuWarehouse.add(`${row.sku}\u0000${row.warehouseId}`);
    const snapshotQuantity = Number(row.quantity || 0);
    const movementQuantity = movementsBySkuWarehouse.get(`${row.sku}\u0000${row.warehouseId}`) || 0;
    const currentQuantity = snapshotQuantity + movementQuantity;
    item.snapshotQuantity += snapshotQuantity;
    item.movementQuantity += movementQuantity;
    item.totalQuantity += currentQuantity;
    item.warehouses.push({
      warehouseId: row.warehouseId,
      warehouseName: row.warehouseName,
      snapshotDate: row.snapshotDate,
      snapshotQuantity,
      movementQuantity,
      quantity: currentQuantity
    });
  }

  const skuRows = getDb()
    .prepare(
      `SELECT sku, name, cost_price AS costPrice,
              barcode, external_product_id AS externalProductId,
              low_stock_threshold AS lowStockThreshold
       FROM skus
       WHERE status = 'active' AND source IN ('manual', 'inventory')`
    )
    .all();
  const skuInfo = new Map(skuRows.map((row) => [row.sku, row]));
  for (const row of movementRows) {
    const key = `${row.sku}\u0000${row.warehouseId}`;
    if (seenSkuWarehouse.has(key)) continue;
    const info = skuInfo.get(row.sku);
    if (!info) continue;
    if (!bySku.has(row.sku)) {
      bySku.set(row.sku, {
        sku: row.sku,
        name: info.name,
        barcode: info.barcode || "",
        externalProductId: info.externalProductId || "",
        costPrice: info.costPrice,
        lowStockThreshold: info.lowStockThreshold,
        snapshotQuantity: 0,
        movementQuantity: 0,
        totalQuantity: 0,
        warehouses: []
      });
    }
    const item = bySku.get(row.sku);
    const movementQuantity = Number(row.movementQuantity || 0);
    item.movementQuantity += movementQuantity;
    item.totalQuantity += movementQuantity;
    item.warehouses.push({
      warehouseId: row.warehouseId,
      warehouseName: warehouseName(row.warehouseId),
      snapshotDate: "",
      snapshotQuantity: 0,
      movementQuantity,
      quantity: movementQuantity
    });
  }

  const imagesBySku = getImagesBySku();
  const items = Array.from(bySku.values()).map((item) => {
    const normalizedWarehouses = getWarehouses().map((warehouse) => {
      const current = item.warehouses.find((row) => row.warehouseId === warehouse.id);
      return (
        current || {
          warehouseId: warehouse.id,
          warehouseName: warehouse.name,
          snapshotDate: "",
          snapshotQuantity: 0,
          movementQuantity: 0,
          quantity: 0
        }
      );
    });
    const selectedWarehouse =
      normalizedWarehouses.find((row) => row.warehouseId === warehouseId) ||
      normalizedWarehouses.find((row) => row.warehouseId === "cainiao") ||
      normalizedWarehouses[0];
    return {
      ...item,
      warehouses: normalizedWarehouses,
      selectedWarehouse,
      images: imagesBySku.get(item.sku) || [],
      lowStock: item.totalQuantity <= item.lowStockThreshold
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    totalQuantity: items.reduce((sum, item) => sum + item.totalQuantity, 0),
    skuCount: items.length,
    lowStockItems: items.filter((item) => item.lowStock).sort((a, b) => a.totalQuantity - b.totalQuantity),
    items
  };
}

export function getUnmanagedOrderItems() {
  const db = getDb();
  const unmatchedRows = db
    .prepare(
      `SELECT MIN(id) AS id, platform, product_id AS productId,
              sku_text AS skuText, name, attributes, status,
              refund_status AS refundStatus,
              COUNT(*) AS lineCount,
              COALESCE(SUM(quantity), 0) AS quantity,
              COALESCE(SUM(paid_amount), 0) AS paidAmount,
              MIN(order_date) AS firstOrderDate,
              MAX(order_date) AS lastOrderDate,
              'unmatched_order' AS rowSource
       FROM order_unmatched_items
       GROUP BY platform, product_id, sku_text, name, attributes, status, refund_status
       ORDER BY lastOrderDate DESC, id DESC
       LIMIT 200`
    )
    .all();

  const legacySkuRows = db
    .prepare(
      `SELECT MIN(oi.id) AS id, oi.platform, '' AS productId,
              s.sku AS skuText, COALESCE(NULLIF(oi.name, ''), s.name) AS name,
              '' AS attributes, COALESCE(o.status, '') AS status,
              oi.refund_status AS refundStatus,
              COUNT(*) AS lineCount,
              COALESCE(SUM(oi.quantity), 0) AS quantity,
              COALESCE(SUM(oi.paid_amount), 0) AS paidAmount,
              MIN(o.order_date) AS firstOrderDate,
              MAX(o.order_date) AS lastOrderDate,
              'legacy_order_sku' AS rowSource
       FROM skus s
       JOIN order_items oi ON oi.sku = s.sku
       LEFT JOIN orders o ON o.platform = oi.platform AND o.order_id = oi.order_id
       WHERE s.status = 'unmanaged' OR s.source = 'order'
       GROUP BY oi.platform, s.sku, COALESCE(NULLIF(oi.name, ''), s.name), oi.refund_status, COALESCE(o.status, '')
       ORDER BY lastOrderDate DESC, id DESC
       LIMIT 200`
    )
    .all();

  const movementOnlyRows = db
    .prepare(
      `SELECT MIN(m.id) AS id, m.platform, '' AS productId,
              s.sku AS skuText, s.name AS name, '' AS attributes,
              '' AS status, '' AS refundStatus,
              COUNT(*) AS lineCount,
              ABS(COALESCE(SUM(CASE WHEN m.quantity < 0 THEN m.quantity ELSE 0 END), 0)) AS quantity,
              0 AS paidAmount,
              MIN(m.movement_date) AS firstOrderDate,
              MAX(m.movement_date) AS lastOrderDate,
              'legacy_movement_sku' AS rowSource
       FROM skus s
       JOIN inventory_movements m ON m.sku = s.sku
       WHERE (s.status = 'unmanaged' OR s.source = 'order')
         AND NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.sku = s.sku)
       GROUP BY m.platform, s.sku, s.name
       ORDER BY lastOrderDate DESC, id DESC
       LIMIT 200`
    )
    .all();

  const rows = [...unmatchedRows, ...legacySkuRows, ...movementOnlyRows]
    .filter((row) => Number(row.quantity || 0) !== 0 || Number(row.lineCount || 0) !== 0)
    .sort((a, b) => String(b.lastOrderDate || "").localeCompare(String(a.lastOrderDate || "")));

  return {
    count: rows.length,
    quantity: rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0),
    paidAmount: rows.reduce((sum, row) => sum + Number(row.paidAmount || 0), 0),
    items: rows
  };
}

function getImagesBySku() {
  const rows = getDb()
    .prepare(
      `SELECT id, sku, original_name AS originalName, public_url AS publicUrl,
              sort_order AS sortOrder
       FROM product_images
       ORDER BY sku, sort_order, id`
    )
    .all();
  const bySku = new Map();
  for (const row of rows) {
    if (!bySku.has(row.sku)) bySku.set(row.sku, []);
    bySku.get(row.sku).push(row);
  }
  return bySku;
}

function warehouseName(id) {
  return {
    cainiao: "菜鸟云仓",
    shanghai: "上海仓库",
    zhuji: "诸暨仓库"
  }[id] || id;
}

export function getOrdersOverview({ month = "", store = "" } = {}) {
  const db = getDb();
  const cleanMonth = String(month || "").trim();
  const cleanStore = String(store || "").trim();
  const where = [];
  const params = {};
  if (cleanMonth) {
    where.push("substr(o.order_date, 1, 7) = @month");
    params.month = cleanMonth;
  }
  if (cleanStore) {
    where.push("o.store = @store");
    params.store = cleanStore;
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const unmatchedWhere = [];
  const unmatchedParams = {};
  if (cleanMonth) {
    unmatchedWhere.push("substr(order_date, 1, 7) = @month");
    unmatchedParams.month = cleanMonth;
  }
  if (cleanStore) {
    unmatchedWhere.push("store = @store");
    unmatchedParams.store = cleanStore;
  }
  const unmatchedWhereSql = unmatchedWhere.length ? `WHERE ${unmatchedWhere.join(" AND ")}` : "";

  const monthRows = db
    .prepare(
      `SELECT substr(order_date, 1, 7) AS month, COUNT(*) AS count
       FROM orders
       WHERE order_date != ''
       GROUP BY substr(order_date, 1, 7)
       ORDER BY month DESC`
    )
    .all();
  const storeRows = db
    .prepare(
      `SELECT store, COUNT(*) AS count
       FROM orders
       GROUP BY store
       ORDER BY count DESC, store`
    )
    .all();
  const summary = db
    .prepare(
      `SELECT COUNT(*) AS orderCount,
              COALESCE(SUM(total_amount), 0) AS totalAmount
       FROM orders o
       ${whereSql}`
    )
    .get(params);
  const itemSummary = db
    .prepare(
      `SELECT COUNT(*) AS matchedLineCount,
              COALESCE(SUM(quantity), 0) AS matchedQuantity,
              COALESCE(SUM(paid_amount), 0) AS matchedAmount
       FROM order_items oi
       JOIN orders o ON o.platform = oi.platform AND o.order_id = oi.order_id
       ${whereSql}`
    )
    .get(params);
  const unmatched = db
    .prepare(
      `SELECT COUNT(*) AS unmatchedLineCount,
              COALESCE(SUM(quantity), 0) AS unmatchedQuantity
       FROM order_unmatched_items
       ${unmatchedWhereSql}`
    )
    .get(unmatchedParams);
  const movements = db
    .prepare(
      `SELECT COUNT(*) AS movementCount,
              COALESCE(SUM(CASE WHEN quantity < 0 THEN -quantity ELSE 0 END), 0) AS deductedQuantity
       FROM inventory_movements m
       LEFT JOIN orders o ON o.platform = m.platform AND o.order_id = m.order_id
       WHERE m.source_type IN ('order', 'order_mapping') AND m.quantity < 0
         ${cleanMonth ? "AND substr(o.order_date, 1, 7) = @month" : ""}
         ${cleanStore ? "AND o.store = @store" : ""}`
    )
    .get(params);
  const statusRows = db
    .prepare(
      `SELECT status, COUNT(*) AS count, COALESCE(SUM(total_amount), 0) AS amount
       FROM orders o
       ${whereSql}
       GROUP BY status
       ORDER BY count DESC
       LIMIT 12`
    )
    .all(params);
  const storeSummaryRows = db
    .prepare(
      `SELECT o.store, COUNT(*) AS orderCount,
              COALESCE(SUM(o.total_amount), 0) AS totalAmount,
              COALESCE(SUM(items.quantity), 0) AS quantity
       FROM orders o
       LEFT JOIN (
         SELECT platform, order_id, SUM(quantity) AS quantity
         FROM order_items
         GROUP BY platform, order_id
       ) items ON items.platform = o.platform AND items.order_id = o.order_id
       ${cleanMonth ? "WHERE substr(o.order_date, 1, 7) = @month" : ""}
       GROUP BY o.store
       ORDER BY totalAmount DESC, orderCount DESC`
    )
    .all(cleanMonth ? { month: cleanMonth } : {});
  const recentOrders = db
    .prepare(
      `SELECT o.platform, o.store, o.order_id AS orderId, o.order_date AS orderDate,
              o.status, o.total_amount AS totalAmount,
              COUNT(oi.id) AS lineCount,
              COALESCE(SUM(oi.quantity), 0) AS quantity
       FROM orders o
       LEFT JOIN order_items oi ON oi.platform = o.platform AND oi.order_id = o.order_id
       ${whereSql}
       GROUP BY o.platform, o.order_id
       ORDER BY o.order_date DESC, o.id DESC
       LIMIT 80`
    )
    .all(params);
  const unmatchedItems = db
    .prepare(
      `SELECT platform, store, order_id AS orderId, sub_order_id AS subOrderId,
              product_id AS productId, name, attributes, quantity,
              paid_amount AS paidAmount, status, refund_status AS refundStatus,
              order_date AS orderDate
       FROM order_unmatched_items
       ${unmatchedWhereSql}
       ORDER BY order_date DESC, id DESC
       LIMIT 80`
    )
    .all(unmatchedParams);

  return {
    filters: {
      month: cleanMonth,
      store: cleanStore,
      months: monthRows,
      stores: storeRows
    },
    summary: {
      ...summary,
      ...itemSummary,
      ...unmatched,
      ...movements
    },
    statusRows,
    storeSummaryRows,
    recentOrders,
    unmatchedItems
  };
}

export function getMonthlySalesReport(month = currentMonth()) {
  const db = getDb();
  const sales = db
    .prepare(
      `SELECT oi.sku, COALESCE(NULLIF(oi.name, ''), s.name) AS name,
              SUM(oi.quantity) AS quantity,
              SUM(oi.paid_amount) AS salesAmount,
              SUM(oi.quantity * s.cost_price) AS productCost
       FROM order_items oi
       JOIN orders o ON o.platform = oi.platform AND o.order_id = oi.order_id
       LEFT JOIN skus s ON s.sku = oi.sku
       WHERE substr(o.order_date, 1, 7) = ?
       GROUP BY oi.sku
       ORDER BY salesAmount DESC`
    )
    .all(month);

  const shippingByPlatform = db
    .prepare(
      `SELECT platform, SUM(amount) AS amount
       FROM shipping_fees
       WHERE fee_month = ?
       GROUP BY platform
       ORDER BY platform`
    )
    .all(month);

  const totals = {
    quantity: sales.reduce((sum, row) => sum + Number(row.quantity || 0), 0),
    salesAmount: sales.reduce((sum, row) => sum + Number(row.salesAmount || 0), 0),
    productCost: sales.reduce((sum, row) => sum + Number(row.productCost || 0), 0),
    shippingFee: shippingByPlatform.reduce((sum, row) => sum + Number(row.amount || 0), 0)
  };
  totals.estimatedGrossProfit = totals.salesAmount - totals.productCost - totals.shippingFee;

  return {
    month,
    totals,
    shippingByPlatform,
    items: sales.map((row) => ({
      ...row,
      estimatedGrossProfit: Number(row.salesAmount || 0) - Number(row.productCost || 0)
    }))
  };
}

export function getDashboard() {
  const inventory = getInventoryReport();
  const monthly = getMonthlySalesReport(currentMonth());
  const db = getDb();
  const importRecords = db
    .prepare(
      `SELECT type, platform, warehouse_id AS warehouseId, file_name AS fileName,
              row_count AS rowCount, success_count AS successCount,
              error_count AS errorCount, imported_at AS importedAt
       FROM import_records
       ORDER BY id DESC
       LIMIT 8`
    )
    .all();
  const competitorCount = db.prepare("SELECT COUNT(*) AS count FROM competitors").get().count;

  return {
    date: nowDate(),
    month: currentMonth(),
    inventory: {
      skuCount: inventory.skuCount,
      totalQuantity: inventory.totalQuantity,
      lowStockCount: inventory.lowStockItems.length,
      lowStockItems: inventory.lowStockItems.slice(0, 10)
    },
    monthly,
    competitorCount,
    importRecords
  };
}

export function getBusinessOverview() {
  const db = getDb();
  const monthly = db
    .prepare(
      `SELECT month,
              SUM(sales_amount) AS salesAmount,
              SUM(refund_amount) AS refundAmount,
              SUM(purchase_cost) AS purchaseCost,
              SUM(shipping_fee) AS shippingFee,
              SUM(labor_cost) AS laborCost,
              SUM(gross_profit) AS grossProfit
       FROM monthly_financials
       GROUP BY month
       ORDER BY month`
    )
    .all();

  const orderMonthly = db
    .prepare(
      `SELECT substr(o.order_date, 1, 7) AS month,
              SUM(oi.quantity) AS quantity,
              SUM(oi.paid_amount) AS salesAmount
       FROM order_items oi
       JOIN orders o ON o.platform = oi.platform AND o.order_id = oi.order_id
       WHERE o.order_date != ''
       GROUP BY substr(o.order_date, 1, 7)
       ORDER BY month`
    )
    .all();

  const platformSales = db
    .prepare(
      `SELECT platform, store, SUM(sales_amount) AS salesAmount,
              SUM(refund_amount) AS refundAmount
       FROM monthly_financials
       GROUP BY platform, store
       HAVING salesAmount != 0 OR refundAmount != 0
       ORDER BY salesAmount DESC
       LIMIT 20`
    )
    .all();

  const purchaseMonthly = db
    .prepare(
      `SELECT substr(purchase_date, 1, 7) AS month,
              COUNT(*) AS count,
              SUM(amount) AS amount
       FROM purchase_records
       WHERE purchase_date != ''
       GROUP BY substr(purchase_date, 1, 7)
       ORDER BY month`
    )
    .all();

  const returnMonthly = db
    .prepare(
      `SELECT substr(apply_time, 1, 7) AS month,
              COUNT(*) AS count,
              SUM(refund_amount) AS refundAmount
       FROM return_records
       WHERE apply_time != ''
       GROUP BY substr(apply_time, 1, 7)
       ORDER BY month`
    )
    .all();

  const shippingMonthly = db
    .prepare(
      `SELECT fee_month AS month,
              COUNT(*) AS count,
              SUM(amount) AS amount
       FROM shipping_fees
       GROUP BY fee_month
       ORDER BY month`
    )
    .all();

  const monthlyByMonth = new Map();
  for (const row of monthly) {
    monthlyByMonth.set(row.month, {
      month: row.month,
      financeSalesAmount: Number(row.salesAmount || 0),
      orderSalesAmount: 0,
      salesAmount: Number(row.salesAmount || 0),
      refundAmount: Number(row.refundAmount || 0),
      purchaseCost: Number(row.purchaseCost || 0),
      shippingFee: Number(row.shippingFee || 0),
      laborCost: Number(row.laborCost || 0),
      grossProfit: Number(row.grossProfit || 0),
      quantity: 0
    });
  }
  for (const row of orderMonthly) {
    const current =
      monthlyByMonth.get(row.month) ||
      {
        month: row.month,
        financeSalesAmount: 0,
        orderSalesAmount: 0,
        salesAmount: 0,
        refundAmount: 0,
        purchaseCost: 0,
        shippingFee: 0,
        laborCost: 0,
        grossProfit: 0,
        quantity: 0
      };
    current.orderSalesAmount = Number(row.salesAmount || 0);
    current.quantity = Number(row.quantity || 0);
    current.salesAmount = current.financeSalesAmount || current.orderSalesAmount;
    monthlyByMonth.set(row.month, current);
  }

  const salesMonthly = Array.from(monthlyByMonth.values()).sort((a, b) => a.month.localeCompare(b.month));

  const totals = {
    salesAmount: salesMonthly.reduce((sum, row) => sum + Number(row.salesAmount || 0), 0),
    orderSalesAmount: orderMonthly.reduce((sum, row) => sum + Number(row.salesAmount || 0), 0),
    refundAmount: monthly.reduce((sum, row) => sum + Number(row.refundAmount || 0), 0),
    shippingFee: shippingMonthly.reduce((sum, row) => sum + Number(row.amount || 0), 0),
    purchaseAmount: db.prepare("SELECT COALESCE(SUM(amount), 0) AS value FROM purchase_records").get().value,
    returnCount: db.prepare("SELECT COUNT(*) AS value FROM return_records").get().value,
    assetValue: db.prepare("SELECT COALESCE(SUM(original_value), 0) AS value FROM fixed_assets").get().value,
    savedFileCount: db.prepare("SELECT COUNT(*) AS value FROM imported_files").get().value
  };

  const latestReturns = db
    .prepare(
      `SELECT platform, store, order_id AS orderId, refund_id AS refundId,
              tracking_no AS trackingNo, product_name AS productName,
              refund_amount AS refundAmount, reason, status, apply_time AS applyTime
       FROM return_records
       ORDER BY imported_at DESC, id DESC
       LIMIT 20`
    )
    .all();

  const latestPurchases = db
    .prepare(
      `SELECT purchase_date AS purchaseDate, item_name AS itemName, amount,
              platform, note
       FROM purchase_records
       ORDER BY imported_at DESC, id DESC
       LIMIT 20`
    )
    .all();

  const assets = db
    .prepare(
      `SELECT asset_code AS assetCode, asset_name AS assetName, model,
              quantity, category, original_value AS originalValue, note
       FROM fixed_assets
       ORDER BY original_value DESC
       LIMIT 20`
    )
    .all();

  return {
    totals,
    monthly,
    salesMonthly,
    orderMonthly,
    platformSales,
    purchaseMonthly,
    returnMonthly,
    shippingMonthly,
    latestReturns,
    latestPurchases,
    assets
  };
}

export function buildInventoryMarkdown() {
  const report = getInventoryReport();
  const lowStockText = report.lowStockItems.length
    ? report.lowStockItems
        .slice(0, 30)
        .map((item) => `- ${item.sku} ${item.name || ""}：${item.totalQuantity} / 预警 ${item.lowStockThreshold}`)
        .join("\n")
    : "库存正常，暂无低库存 SKU。";

  return {
    title: `ERP库存预警 ${nowDate()}`,
    text: [
      `## ERP库存预警 ${nowDate()}`,
      "",
      `- SKU 数：${report.skuCount}`,
      `- 库存合计：${report.totalQuantity}`,
      `- 低库存 SKU：${report.lowStockItems.length}`,
      "",
      "### 低库存明细",
      lowStockText
    ].join("\n")
  };
}

export function buildMonthlyMarkdown(month = currentMonth()) {
  const report = getMonthlySalesReport(month);
  const topItems = report.items.length
    ? report.items
        .slice(0, 20)
        .map((item) => `- ${item.sku}：销量 ${item.quantity}，销售额 ${money(item.salesAmount)}`)
        .join("\n")
    : "暂无订单数据。";

  return {
    title: `ERP月度销售报表 ${month}`,
    text: [
      `## ERP月度销售报表 ${month}`,
      "",
      `- 销量：${report.totals.quantity}`,
      `- 销售额：${money(report.totals.salesAmount)}`,
      `- 商品成本：${money(report.totals.productCost)}`,
      `- 邮费：${money(report.totals.shippingFee)}`,
      `- 预估毛利：${money(report.totals.estimatedGrossProfit)}`,
      "",
      "### SKU明细",
      topItems
    ].join("\n")
  };
}

function money(value) {
  return `￥${Number(value || 0).toFixed(2)}`;
}
