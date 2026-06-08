import fs from "node:fs";
import path from "node:path";
import express from "express";
import multer from "multer";
import { fileURLToPath } from "node:url";
import { loadConfig, rootDir } from "../config.js";
import { sendDingTalkMarkdown } from "../dingtalk.js";
import { getDb } from "./db.js";
import { archiveImportedFile, hashFile } from "./file-archive.js";
import {
  createCompetitor,
  getCompetitorSnapshots,
  getCompetitorSkuSummary,
  listCompetitors,
  runCompetitorSnapshots,
  updateCompetitor
} from "./competitors.js";
import { importInventoryFile, importOrdersFile, importShippingFile } from "./importers.js";
import {
  listProductCodeMappings,
  matchUnmanagedOrderItem,
  rematchUnmatchedOrders,
  upsertProductCodeMapping
} from "./order-matching.js";
import {
  buildInventoryMarkdown,
  buildMonthlyMarkdown,
  getBusinessOverview,
  getDashboard,
  getInventoryReport,
  getMonthlySalesReport,
  getOrdersOverview,
  getOperationLogs,
  getSkus,
  getUnmanagedOrderItems,
  getWarehouses,
  updateInventoryQuantity,
  updateSku
} from "./reports.js";
import { importProjectFolder } from "./import-project-folder.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "../../public");
const uploadDir = path.join(rootDir, "uploads");
const productImageDir = path.join(rootDir, "data", "product-images");
fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(productImageDir, { recursive: true });

const upload = multer({ dest: uploadDir });
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  return next();
});
app.use(express.static(publicDir));
app.use("/product-images", express.static(productImageDir));

app.get("/api/health", (_req, res) => {
  getDb();
  res.json({ ok: true });
});

app.get("/api/config", (_req, res) => {
  const config = loadConfig();
  res.json({ ok: true, data: {
    warehouses: config.erp?.warehouses || [],
    platforms: config.erp?.platforms || [],
    stores: config.erp?.stores || [{ id: "店口五金店", name: "店口五金店" }]
  } });
});

app.get("/api/dashboard", (_req, res) => sendJson(res, () => getDashboard()));
app.get("/api/business/overview", (_req, res) => sendJson(res, () => getBusinessOverview()));
app.post("/api/import/project-folder", (req, res) =>
  sendJson(res, () => importProjectFolder(req.body.root || "/Users/chenyuecai/店口五金"))
);
app.get("/api/warehouses", (_req, res) => sendJson(res, () => getWarehouses()));
app.get("/api/skus", (_req, res) => sendJson(res, () => getSkus()));
app.put("/api/skus/:sku", (req, res) => sendJson(res, () => updateSku(req.params.sku, req.body)));
app.get("/api/skus/:sku/images", (req, res) => sendJson(res, () => listProductImages(req.params.sku)));
app.post("/api/skus/:sku/images", upload.array("images", 12), (req, res) =>
  sendJson(res, () => saveProductImages(req.params.sku, req.files || []))
);
app.put("/api/inventory/:sku/quantity", (req, res) =>
  sendJson(res, () => updateInventoryQuantity(req.params.sku, req.body))
);
app.get("/api/operation-logs", (req, res) =>
  sendJson(res, () =>
    getOperationLogs({
      entityType: String(req.query.entityType || ""),
      limit: Number(req.query.limit || 80)
    })
  )
);

app.post("/api/import/inventory", upload.single("file"), (req, res) =>
  sendJson(res, () => {
    const uploadInfo = prepareUploadedFile(req);
    const result = importInventoryFile({
      file: uploadInfo.importPath,
      warehouseId: req.body.warehouseId || "cainiao",
      snapshotDate: req.body.snapshotDate || undefined
    });
    return withStoredImportFile(uploadInfo, {
      result,
      importType: "inventory",
      platform: "",
      warehouseId: req.body.warehouseId || "cainiao",
      period: req.body.snapshotDate || "",
      rowCount: result.rowCount
    });
  })
);

app.post("/api/import/orders", upload.single("file"), (req, res) =>
  sendJson(res, () => {
    const uploadInfo = prepareUploadedFile(req);
    const platform = req.body.platform || "qianniu";
    const store = req.body.store || "店口五金店";
    const result = importOrdersFile({
      file: uploadInfo.importPath,
      platform,
      store
    });
    return withStoredImportFile(uploadInfo, {
      result,
      importType: "orders",
      platform,
      store,
      rowCount: result.rowCount
    });
  })
);

app.post("/api/import/shipping-fees", upload.single("file"), (req, res) =>
  sendJson(res, () => {
    const uploadInfo = prepareUploadedFile(req);
    const platform = req.body.platform || "cainiao";
    const feeMonth = req.body.feeMonth || "";
    const result = importShippingFile({
      file: uploadInfo.importPath,
      platform,
      feeMonth
    });
    return withStoredImportFile(uploadInfo, {
      result,
      importType: "shipping",
      platform,
      period: feeMonth,
      rowCount: result.rowCount
    });
  })
);

app.get("/api/import/files", (_req, res) =>
  sendJson(res, () =>
    getDb()
      .prepare(
        `SELECT hash, original_name AS originalName, size_bytes AS sizeBytes,
                import_type AS importType, platform, store, warehouse_id AS warehouseId,
                period, row_count AS rowCount, first_imported_at AS firstImportedAt,
                last_used_at AS lastUsedAt
         FROM imported_files
         ORDER BY last_used_at DESC
         LIMIT 80`
      )
      .all()
  )
);

app.get("/api/import/files/:hash/download", (req, res) => {
  const file = getDb()
    .prepare("SELECT original_name AS originalName, stored_path AS storedPath FROM imported_files WHERE hash = ?")
    .get(req.params.hash);
  if (!file || !fs.existsSync(file.storedPath)) {
    return res.status(404).json({ ok: false, error: "文件不存在。" });
  }
  return res.download(file.storedPath, file.originalName);
});

app.get("/api/reports/inventory", (req, res) =>
  sendJson(res, () => getInventoryReport({ warehouseId: String(req.query.warehouseId || "") }))
);
app.get("/api/inventory/unmanaged-order-items", (_req, res) =>
  sendJson(res, () => getUnmanagedOrderItems())
);
app.post("/api/inventory/unmanaged-order-items/match", (req, res) =>
  sendJson(res, () => matchUnmanagedOrderItem(req.body))
);
app.get("/api/reports/monthly-sales", (req, res) =>
  sendJson(res, () => getMonthlySalesReport(String(req.query.month || "").trim() || undefined))
);
app.get("/api/orders/overview", (req, res) =>
  sendJson(res, () =>
    getOrdersOverview({
      month: String(req.query.month || ""),
      store: String(req.query.store || "")
    })
  )
);
app.get("/api/product-code-mappings", (_req, res) => sendJson(res, () => listProductCodeMappings()));
app.post("/api/product-code-mappings", (req, res) => sendJson(res, () => upsertProductCodeMapping(req.body)));
app.post("/api/orders/rematch-unmatched", (req, res) =>
  sendJson(res, () => rematchUnmatchedOrders({ platform: req.body.platform || "" }))
);

app.post("/api/dingtalk/send-report", async (req, res) => {
  try {
    const type = req.body.type || "inventory";
    const report =
      type === "monthly"
        ? buildMonthlyMarkdown(req.body.month)
        : buildInventoryMarkdown();
    const result = await sendDingTalkMarkdown({
      title: report.title,
      text: report.text
    });
    res.json({ ok: true, report, result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/competitors/sku-summary", (_req, res) => sendJson(res, () => getCompetitorSkuSummary()));
app.get("/api/competitors", (req, res) =>
  sendJson(res, () => listCompetitors({ sku: String(req.query.sku || "") }))
);
app.post("/api/competitors", (req, res) => sendJson(res, () => createCompetitor(req.body)));
app.put("/api/competitors/:id", (req, res) =>
  sendJson(res, () => updateCompetitor(req.params.id, req.body))
);
app.get("/api/competitors/:id/snapshots", (req, res) =>
  sendJson(res, () => getCompetitorSnapshots(req.params.id, { range: req.query.range || 90 }))
);
app.post("/api/competitors/run-snapshot", async (req, res) => {
  try {
    res.json({ ok: true, results: await runCompetitorSnapshots({ sku: req.body?.sku || "", id: req.body?.id || "" }) });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

function sendJson(res, fn) {
  try {
    res.json({ ok: true, data: fn() });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
}

function prepareUploadedFile(req) {
  if (!req.file?.path) throw new Error("请上传 Excel/CSV 文件。");
  const originalName = decodeUploadName(req.file.originalname || "");
  const ext = path.extname(originalName || req.file.originalname || "");
  const hash = hashFile(req.file.path);
  const existing = getDb().prepare("SELECT stored_path AS storedPath FROM imported_files WHERE hash = ?").get(hash);

  if (ext && !req.file.path.endsWith(ext)) {
    const renamed = `${req.file.path}${ext}`;
    fs.renameSync(req.file.path, renamed);
    req.file.path = renamed;
  }

  if (existing?.storedPath && fs.existsSync(existing.storedPath)) {
    fs.rmSync(req.file.path, { force: true });
    getDb()
      .prepare("UPDATE imported_files SET last_used_at = CURRENT_TIMESTAMP WHERE hash = ?")
      .run(hash);
    return {
      duplicate: true,
      hash,
      importPath: existing.storedPath,
      originalName: originalName || path.basename(existing.storedPath),
      mimeType: req.file.mimetype || "",
      sizeBytes: req.file.size || fs.statSync(existing.storedPath).size
    };
  }

  return {
    duplicate: false,
    hash,
    importPath: req.file.path,
    originalName: originalName || path.basename(req.file.path),
    mimeType: req.file.mimetype || "",
    sizeBytes: req.file.size || fs.statSync(req.file.path).size
  };
}

function decodeUploadName(name) {
  if (!name) return "";
  const decoded = Buffer.from(name, "latin1").toString("utf8");
  return decoded.includes("�") ? name : decoded;
}

function withStoredImportFile(uploadInfo, meta) {
  if (uploadInfo.duplicate) {
    getDb()
      .prepare(
        `UPDATE imported_files
         SET import_type = @importType,
             platform = @platform,
             store = @store,
             warehouse_id = @warehouseId,
             period = @period,
             row_count = @rowCount,
             last_used_at = CURRENT_TIMESTAMP
         WHERE hash = @hash`
      )
      .run({
        hash: uploadInfo.hash,
        importType: meta.importType,
        platform: meta.platform || "",
        store: meta.store || "",
        warehouseId: meta.warehouseId || "",
        period: meta.period || "",
        rowCount: meta.rowCount || 0
      });
  }
  const archived = uploadInfo.duplicate
    ? { hash: uploadInfo.hash, originalName: uploadInfo.originalName, duplicate: true }
    : archiveImportedFile({
        file: uploadInfo.importPath,
        originalName: uploadInfo.originalName,
        importType: meta.importType,
        platform: meta.platform || "",
        store: meta.store || "",
        warehouseId: meta.warehouseId || "",
        period: meta.period || "",
        rowCount: meta.rowCount || 0
      });

  if (!uploadInfo.duplicate && uploadInfo.importPath.startsWith(uploadDir)) {
    fs.rmSync(uploadInfo.importPath, { force: true });
  }

  return {
    ...meta.result,
    file: {
      hash: archived.hash,
      originalName: uploadInfo.originalName,
      duplicate: uploadInfo.duplicate || archived.duplicate
    }
  };
}

function listProductImages(sku) {
  return getDb()
    .prepare(
      `SELECT id, sku, original_name AS originalName, public_url AS publicUrl,
              sort_order AS sortOrder, created_at AS createdAt
       FROM product_images
       WHERE sku = ?
       ORDER BY sort_order, id`
    )
    .all(sku);
}

function saveProductImages(sku, files) {
  if (!sku) throw new Error("缺少 SKU。");
  if (!files.length) throw new Error("请选择图片。");
  const db = getDb();
  const skuDir = path.join(productImageDir, safePathPart(sku));
  fs.mkdirSync(skuDir, { recursive: true });
  db.prepare("INSERT OR IGNORE INTO skus (sku, name) VALUES (?, ?)").run(sku, sku);
  const currentMax =
    db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS value FROM product_images WHERE sku = ?").get(sku).value || -1;
  const insert = db.prepare(
    `INSERT INTO product_images (sku, original_name, stored_path, public_url, sort_order)
     VALUES (@sku, @originalName, @storedPath, @publicUrl, @sortOrder)`
  );
  const saved = [];
  files.forEach((file, index) => {
    const originalName = decodeUploadName(file.originalname || "");
    const ext = imageExtension(originalName || file.path);
    const filename = `${Date.now()}-${index + 1}-${safePathPart(path.basename(originalName, ext) || "image")}${ext}`;
    const storedPath = path.join(skuDir, filename);
    fs.renameSync(file.path, storedPath);
    const publicUrl = `/product-images/${encodeURIComponent(safePathPart(sku))}/${encodeURIComponent(filename)}`;
    const row = {
      sku,
      originalName,
      storedPath,
      publicUrl,
      sortOrder: currentMax + index + 1
    };
    const result = insert.run(row);
    saved.push({ id: result.lastInsertRowid, sku, originalName, publicUrl, sortOrder: row.sortOrder });
  });
  return saved;
}

function imageExtension(name) {
  const ext = path.extname(name || "").toLowerCase();
  return [".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext) ? ext : ".jpg";
}

function safePathPart(value) {
  return String(value || "sku").replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 120) || "sku";
}

const port = Number(process.env.ERP_PORT || 3000);
app.listen(port, () => {
  getDb();
  console.log(`ERP 本地后台已启动：http://localhost:${port}`);
});
