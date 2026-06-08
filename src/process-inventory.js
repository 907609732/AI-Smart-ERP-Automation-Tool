import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";
import { loadConfig } from "./config.js";

function newestFile(dir) {
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .map((name) => path.join(dir, name))
    .filter((file) => fs.statSync(file).isFile())
    .filter((file) => /\.(xlsx|xls|csv)$/i.test(file))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0] || null;
}

function readRows(file) {
  const workbook = XLSX.readFile(file, { cellDates: true });
  const firstSheet = workbook.SheetNames[0];
  return XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], {
    defval: "",
    raw: false
  });
}

function findColumn(headers, candidates) {
  return candidates.find((candidate) => headers.includes(candidate));
}

function toNumber(value) {
  if (typeof value === "number") return value;
  const normalized = String(value).replace(/,/g, "").trim();
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

export function buildInventoryReport(file = null) {
  const config = loadConfig();
  const inventoryFile = file || newestFile(config.downloadDir);
  if (!inventoryFile) {
    throw new Error(`没有在 ${config.downloadDir} 找到 xlsx/xls/csv 库存文件。`);
  }

  const rows = readRows(inventoryFile);
  if (rows.length === 0) {
    throw new Error(`库存文件为空：${inventoryFile}`);
  }

  const headers = Object.keys(rows[0]);
  const skuColumn = findColumn(headers, config.inventoryColumns.sku);
  const nameColumn = findColumn(headers, config.inventoryColumns.name);
  const quantityColumn = findColumn(headers, config.inventoryColumns.quantity);

  if (!quantityColumn) {
    throw new Error(
      `没有识别到库存数量列。当前列名：${headers.join("、")}。请在 config.json 的 inventoryColumns.quantity 中补充。`
    );
  }

  const lowStockThreshold = Number(process.env.LOW_STOCK_THRESHOLD || 5);
  const items = rows
    .map((row) => ({
      sku: skuColumn ? String(row[skuColumn]).trim() : "",
      name: nameColumn ? String(row[nameColumn]).trim() : "",
      quantity: toNumber(row[quantityColumn])
    }))
    .filter((item) => item.sku || item.name);

  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const lowStockItems = items
    .filter((item) => item.quantity <= lowStockThreshold)
    .sort((a, b) => a.quantity - b.quantity)
    .slice(0, 20);

  const now = new Date();
  const title = `菜鸟云仓库存日报 ${now.toLocaleDateString("zh-CN")}`;
  const lowStockText =
    lowStockItems.length === 0
      ? "无"
      : lowStockItems
          .map((item) => `- ${item.sku || item.name}：${item.quantity}`)
          .join("\n");

  const markdown = [
    `## ${title}`,
    "",
    `- 文件：${path.basename(inventoryFile)}`,
    `- 商品行数：${items.length}`,
    `- 库存合计：${totalQuantity}`,
    `- 低库存阈值：${lowStockThreshold}`,
    `- 低库存数量：${lowStockItems.length}`,
    "",
    "### 低库存明细",
    lowStockText
  ].join("\n");

  fs.mkdirSync(config.reportDir, { recursive: true });
  const reportPath = path.join(
    config.reportDir,
    `inventory-report-${now.toISOString().slice(0, 10)}.md`
  );
  fs.writeFileSync(reportPath, markdown, "utf8");

  return {
    file: inventoryFile,
    reportPath,
    title,
    markdown,
    summary: {
      rows: items.length,
      totalQuantity,
      lowStockCount: lowStockItems.length
    }
  };
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  const report = buildInventoryReport(process.argv[2]);
  console.log(report.markdown);
}
