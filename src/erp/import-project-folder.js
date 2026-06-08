import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";
import { getDb } from "./db.js";
import { archiveImportedFile } from "./file-archive.js";
import { toNumber, toText } from "./sheets.js";

const defaultRoot = "/Users/chenyuecai/店口五金";

function readRows(file, sheetName) {
  const workbook = XLSX.readFile(file, { cellDates: true });
  const sheet = sheetName || workbook.SheetNames[0];
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheet], {
    defval: "",
    raw: false
  });
}

function readMatrix(file, sheetName) {
  const workbook = XLSX.readFile(file, { cellDates: true });
  const sheet = sheetName || workbook.SheetNames[0];
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheet], {
    defval: "",
    header: 1,
    raw: false
  });
}

function listExcelFiles(root) {
  const files = [];
  function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name);
      const stat = fs.statSync(file);
      if (stat.isDirectory()) {
        if (name.startsWith(".")) continue;
        walk(file);
      } else if (/\.(xlsx|xls|csv|tsv)$/i.test(name) && !name.startsWith("~$")) {
        files.push(file);
      }
    }
  }
  walk(root);
  return files;
}

function normalizeMonth(value) {
  const text = toText(value);
  if (!text) return "";
  const yyyymm = text.match(/(20\d{2})[-年/]?0?(\d{1,2})/);
  if (yyyymm) return `${yyyymm[1]}-${String(yyyymm[2]).padStart(2, "0")}`;
  const date = new Date(text.replace(/\//g, "-"));
  if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 7);
  return text.slice(0, 7);
}

function normalizeDate(value, defaultYear = "2026") {
  const text = toText(value);
  if (!text) return "";
  const cn = text.match(/(?:(20\d{2})年)?\s*(\d{1,2})月\s*(\d{1,2})/);
  if (cn) {
    return `${cn[1] || defaultYear}-${String(cn[2]).padStart(2, "0")}-${String(cn[3]).padStart(2, "0")}`;
  }
  const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (slash) {
    const year = slash[3].length === 2 ? `20${slash[3]}` : slash[3];
    return `${year}-${String(slash[1]).padStart(2, "0")}-${String(slash[2]).padStart(2, "0")}`;
  }
  const date = new Date(text.replace(/\//g, "-"));
  if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  return text;
}

function isDataRow(row) {
  return Object.values(row).some((value) => toText(value) !== "");
}

function insertMonthly(row) {
  getDb()
    .prepare(
      `INSERT INTO monthly_financials
       (source_file, month, platform, store, sales_amount, refund_amount,
        purchase_cost, shipping_fee, labor_cost, gross_profit, note)
       VALUES (@sourceFile, @month, @platform, @store, @salesAmount, @refundAmount,
        @purchaseCost, @shippingFee, @laborCost, @grossProfit, @note)
       ON CONFLICT(source_file, month, platform, store) DO UPDATE SET
        sales_amount = excluded.sales_amount,
        refund_amount = excluded.refund_amount,
        purchase_cost = excluded.purchase_cost,
        shipping_fee = excluded.shipping_fee,
        labor_cost = excluded.labor_cost,
        gross_profit = excluded.gross_profit,
        note = excluded.note,
        imported_at = CURRENT_TIMESTAMP`
    )
    .run(row);
}

function insertPurchase(row) {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO purchase_records
       (source_file, purchase_date, item_name, amount, platform, note)
       VALUES (@sourceFile, @purchaseDate, @itemName, @amount, @platform, @note)`
    )
    .run(row);
}

function insertReturn(row) {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO return_records
       (source_file, platform, store, order_id, refund_id, tracking_no, sku,
        product_name, refund_amount, quantity, reason, status, apply_time, note)
       VALUES (@sourceFile, @platform, @store, @orderId, @refundId, @trackingNo,
        @sku, @productName, @refundAmount, @quantity, @reason, @status, @applyTime, @note)`
    )
    .run(row);
}

function insertAsset(row) {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO fixed_assets
       (source_file, asset_code, asset_name, model, quantity, category, department,
        start_month, original_value, depreciation_months, note)
       VALUES (@sourceFile, @assetCode, @assetName, @model, @quantity, @category,
        @department, @startMonth, @originalValue, @depreciationMonths, @note)`
    )
    .run(row);
}

function importIncomeBill(file) {
  const rows = readRows(file, "账单").filter(isDataRow);
  let count = 0;
  const store = path.basename(file).replace(/收入账单.*$/, "").replace(/^淘宝-/, "");
  for (const row of rows) {
    const month = normalizeMonth(row["月份"]);
    if (!month) continue;
    insertMonthly({
      sourceFile: file,
      month,
      platform: "taobao",
      store,
      salesAmount: toNumber(row["收入金额合计（元）"]),
      refundAmount: toNumber(row["退款金额合计（元）"]),
      purchaseCost: 0,
      shippingFee: 0,
      laborCost: 0,
      grossProfit: 0,
      note: toText(row["业务大类"])
    });
    count += 1;
  }
  return count;
}

function importProfitSummary(file) {
  const rows = readRows(file, "2026店铺利润表").filter(isDataRow);
  let count = 0;
  for (const row of rows) {
    const month = normalizeMonth(row["月份"]);
    if (!month) continue;
    const platformMap = [
      ["taobao", "店口五金店", "淘宝实收-店口五金店"],
      ["pdd", "店口五金店", "拼多多实收-店口五金店"],
      ["taobao", "西施五金", "淘宝实收-西施五金"],
      ["jd", "店口五金工作室", "京东实收-店口五金工作室"],
      ["offline", "客户代发+其他微信客户", "客户代发+其他微信客户"]
    ];
    for (const [platform, store, column] of platformMap) {
      const salesAmount = toNumber(row[column]);
      if (!salesAmount) continue;
      insertMonthly({
        sourceFile: file,
        month,
        platform,
        store,
        salesAmount,
        refundAmount: 0,
        purchaseCost: platform === "summary" ? toNumber(row["总采购成本"]) : 0,
        shippingFee: 0,
        laborCost: 0,
        grossProfit: 0,
        note: "利润表平台实收"
      });
      count += 1;
    }
    insertMonthly({
      sourceFile: file,
      month,
      platform: "summary",
      store: "全平台",
      salesAmount: toNumber(row["全平台总销售额"]),
      refundAmount: 0,
      purchaseCost: toNumber(row["总采购成本"]),
      shippingFee: toNumber(row["快递费"]),
      laborCost: 0,
      grossProfit: toNumber(row["月度净利润"]),
      note: "利润表汇总"
    });
    count += 1;
  }
  return count;
}

function importPurchase2025(file) {
  const rows = readRows(file, "2025采购信息").filter(isDataRow);
  let count = 0;
  for (const row of rows) {
    const itemName = toText(row["采购物品"]);
    const amount = toNumber(row["金额"]);
    if (!itemName || !amount) continue;
    insertPurchase({
      sourceFile: file,
      purchaseDate: normalizeDate(row["日期"], "2025"),
      itemName,
      amount,
      platform: toText(row["购买平台"]),
      note: ""
    });
    count += 1;
  }
  return count;
}

function importPurchase2026(file) {
  const workbook = XLSX.readFile(file, { cellDates: true });
  let count = 0;
  for (const sheet of workbook.SheetNames.filter((name) => /^\d+月$/.test(name))) {
    const matrix = readMatrix(file, sheet);
    const headerIndex = matrix.findIndex((row) => row.some((cell) => toText(cell).includes("采购") && toText(cell).includes("单号")));
    if (headerIndex < 0) continue;
    const headers = matrix[headerIndex].map((header) => toText(header).replace(/\s+/g, ""));
    for (const row of matrix.slice(headerIndex + 1)) {
      const value = (name) => row[headers.indexOf(name)] ?? "";
      const itemName = toText(value("名称")) || toText(value("型号"));
      const amount = toNumber(value("采购金额"));
      if (!itemName || !amount) continue;
      insertPurchase({
        sourceFile: file,
        purchaseDate: normalizeDate(value("订单日期")) || `2026-${sheet.replace("月", "").padStart(2, "0")}`,
        itemName,
        amount,
        platform: toText(value("购买平台")),
        note: [toText(value("采购类型")), toText(value("名称")), toText(value("备注"))].filter(Boolean).join(" / ")
      });
      count += 1;
    }
  }
  return count;
}

function import1688Purchase(file) {
  const rows = readRows(file, "sheet1").filter(isDataRow);
  let count = 0;
  for (const row of rows) {
    const itemName = toText(row["货品标题"]);
    const amount = toNumber(row["实付款(元)"]) || toNumber(row["货品总价(元)"]);
    if (!itemName || !amount) continue;
    insertPurchase({
      sourceFile: file,
      purchaseDate: normalizeDate(row["订单付款时间"] || row["订单创建时间"]),
      itemName,
      amount,
      platform: "1688",
      note: [
        toText(row["订单编号"]),
        toText(row["卖家公司名"]),
        toText(row["型号"]),
        toText(row["运单号"])
      ].filter(Boolean).join(" / ")
    });
    count += 1;
  }
  return count;
}

function importSalesData2026(file) {
  const matrix = readMatrix(file, "2026店铺销售额月报");
  const headerIndex = matrix.findIndex((row) => row.some((cell) => toText(cell) === "淘宝总支付金额"));
  if (headerIndex < 0) return 0;
  const headers = matrix[headerIndex].map((header) => toText(header));
  let count = 0;
  for (const row of matrix.slice(headerIndex + 1)) {
    const value = (name) => row[headers.indexOf(name)] ?? "";
    const month = normalizeMonth(value("日期"));
    if (!month) continue;
    const salesAmount = toNumber(value("淘宝净支付金额")) || toNumber(value("淘宝总支付金额"));
    if (!salesAmount) continue;
    insertMonthly({
      sourceFile: file,
      month,
      platform: "taobao",
      store: "店口五金店",
      salesAmount,
      refundAmount: toNumber(value("淘宝退款金额")) + toNumber(value("退货退款金额")),
      purchaseCost: 0,
      shippingFee: 0,
      laborCost: 0,
      grossProfit: toNumber(value("毛利润")),
      note: `销量 ${toText(value("销量(支付子订单数)"))}`
    });
    count += 1;
  }
  return count;
}

function importReturns(file) {
  const workbook = XLSX.readFile(file, { cellDates: true });
  let count = 0;
  for (const sheet of workbook.SheetNames) {
    const rows = readRows(file, sheet).filter(isDataRow);
    for (const row of rows) {
      const platform = /拼多多/.test(file + sheet) ? "pdd" : /淘宝/.test(file + sheet) ? "taobao" : /京东/.test(file + sheet) ? "jd" : "";
      const trackingNo = toText(row["退货快递单号"] || row["退货物流单号"] || row["退货运单号"] || row["扫码枪单号"] || row["单号"]);
      const orderId = toText(row["平台订单号"] || row["订单编号"] || row["订单号"]);
      const refundId = toText(row["售后单号"] || row["退款编号"]);
      if (!trackingNo && !orderId && !refundId) continue;
      insertReturn({
        sourceFile: file,
        platform,
        store: toText(row["店铺名称"] || sheet),
        orderId,
        refundId,
        trackingNo,
        sku: toText(row["商品sku信息"] || row["商家编码"]),
        productName: toText(row["宝贝标题"] || row["sku信息"]),
        refundAmount: toNumber(row["申请退款金额"] || row["退款总额"] || row["退给买家金额"]),
        quantity: toNumber(row["申请退货数量"] || row["实退数量"]),
        reason: toText(row["售后原因"] || row["买家退款原因"] || row["原因:"]),
        status: toText(row["售后状态"] || row["退款状态"] || row["货物状态"]),
        applyTime: normalizeDate(row["申请时间"] || row["退款申请时间"] || row["扫码日期"] || row["时间"]),
        note: toText(row["售后描述"] || row["买家退款说明"] || row["__EMPTY"] || row["__EMPTY_1"])
      });
      count += 1;
    }
  }
  return count;
}

function importAssetTemplate(file) {
  const rows = readRows(file, "固定资产导入模板").filter(isDataRow);
  let count = 0;
  for (const row of rows) {
    const assetName = toText(row["资产名称*"]);
    if (!assetName || assetName.includes("资产名称")) continue;
    insertAsset({
      sourceFile: file,
      assetCode: toText(row["编码*"]),
      assetName,
      model: toText(row["规格型号"]),
      quantity: toNumber(row["数量"]),
      category: toText(row["资产类别（下拉选择）*"]),
      department: toText(row["使用部门（下拉或手动输入）"]),
      startMonth: normalizeMonth(row["开始使用月份（格式YYYYMM）*"]),
      originalValue: toNumber(row["原值*"]),
      depreciationMonths: toNumber(row["预计使用月数*"]),
      note: toText(row["备注"])
    });
    count += 1;
  }
  return count;
}

function importAssetLedger(file) {
  const matrix = readMatrix(file, "店口五金固定资产");
  let count = 0;
  for (const row of matrix) {
    const codeIndex = row.findIndex((cell) => /^DKWJ-\d+/.test(toText(cell)));
    if (codeIndex < 0) continue;
    insertAsset({
      sourceFile: file,
      assetCode: toText(row[codeIndex]),
      assetName: toText(row[codeIndex + 2]),
      model: toText(row[codeIndex + 3]),
      quantity: toNumber(row[codeIndex + 4]) || 1,
      category: toText(row[codeIndex + 1]),
      department: "",
      startMonth: normalizeMonth(row[codeIndex + 7]),
      originalValue: toNumber(row[codeIndex + 5]),
      depreciationMonths: toNumber(row[codeIndex + 10]),
      note: [toText(row[codeIndex + 15]), toText(row[codeIndex + 16]), toText(row[codeIndex + 17])].filter(Boolean).join(" / ")
    });
    count += 1;
  }
  return count;
}

function importFile(file) {
  const name = path.basename(file);
  try {
    if (/收入账单/.test(name)) return { file, type: "monthly_financials", rows: importIncomeBill(file) };
    if (/总利润表/.test(name)) return { file, type: "monthly_financials", rows: importProfitSummary(file) };
    if (/销售数据表-2026/.test(name)) return { file, type: "monthly_financials", rows: importSalesData2026(file) };
    if (/采购进货明细表-2026/.test(name)) return { file, type: "purchase_records", rows: importPurchase2026(file) };
    if (/采购1688/.test(name)) return { file, type: "purchase_records", rows: import1688Purchase(file) };
    if (/2025年店口五金销售数据/.test(name)) return { file, type: "purchase_records", rows: importPurchase2025(file) };
    if (/售后|退货/.test(file)) return { file, type: "return_records", rows: importReturns(file) };
    if (/固定资产导入模板/.test(name)) return { file, type: "fixed_assets", rows: importAssetTemplate(file) };
    if (/固定资产管理台账/.test(name)) return { file, type: "fixed_assets", rows: importAssetLedger(file) };
    return { file, type: "skipped", rows: 0 };
  } catch (error) {
    return { file, type: "error", rows: 0, error: error.message };
  }
}

export function importProjectFolder(root = defaultRoot) {
  getDb();
  const files = listExcelFiles(root);
  const results = files.map((file) => {
    const result = importFile(file);
    if (result.type !== "skipped" && result.type !== "error") {
      archiveImportedFile({
        file,
        importType: result.type,
        period: "",
        rowCount: result.rows
      });
    }
    return result;
  });
  return {
    root,
    totalFiles: files.length,
    importedFiles: results.filter((result) => result.rows > 0).length,
    results
  };
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  console.log(JSON.stringify(importProjectFolder(process.argv[2] || defaultRoot), null, 2));
}
