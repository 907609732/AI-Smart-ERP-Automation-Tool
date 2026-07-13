import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
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
import { importInventoryFile, importMonthlyOutboundFile, importOrdersFile, importShippingFile } from "./importers.js";
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
import {
  getBarcodeCatalog,
  getBarcodeTemplate,
  listBarcodePrinters,
  renderBarcodeSvg,
  saveBarcodeTemplate
} from "./barcodes.js";
import {
  UNPACK_COMPLETE_BARCODE,
  completeUnpackSession,
  createNasCommand,
  exportUnpackCsv,
  getUnpackOverview,
  getUnpackSession,
  importUnpackReturnWorkbook,
  listUnpackCameras,
  listUnpackSessions,
  registerNasVideoClip,
  saveUnpackCamera,
  startUnpackSession,
  verifyNasSignature
} from "./unpack.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(rootDir, "web");
const uploadDir = path.join(rootDir, "uploads");
const productImageDir = path.join(rootDir, "data", "product-images");
fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(productImageDir, { recursive: true });

const upload = multer({ dest: uploadDir });
const app = express();

// server.js 只做“HTTP 编排”：收请求、处理上传、调用业务模块、统一返回。
// 具体业务规则尽量放在 importers/reports/order-matching 等模块，避免路由膨胀。
app.use(express.json({ verify: (req, _res, buffer) => { req.rawBody = buffer.toString("utf8"); } }));
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
app.post("/api/skus/:sku/images", upload.array("images", 80), (req, res) =>
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
    // 库存导入会创建/更新正式 SKU，并写库存快照；原始文件统一归档去重。
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

app.post("/api/import/monthly-outbound", upload.single("file"), (req, res) =>
  sendJson(res, () => {
    // 菜鸟月度出库只更新 monthly_outbound，不把月末库存当作当前库存。
    // 当前库存仍以库存导入、手工编辑、订单扣减流水为准。
    const uploadInfo = prepareUploadedFile(req);
    const warehouseId = req.body.warehouseId || "cainiao";
    const month = req.body.month || "";
    const result = importMonthlyOutboundFile({
      file: uploadInfo.importPath,
      warehouseId,
      month
    });
    return withStoredImportFile(uploadInfo, {
      result,
      importType: "monthly_outbound",
      platform: "cainiao",
      warehouseId,
      period: month || result.month || "",
      rowCount: result.rowCount
    });
  })
);

app.post("/api/import/orders", upload.single("file"), (req, res) =>
  sendJson(res, () => {
    // 订单导入是覆盖式：同平台同订单号会先清掉旧明细和旧扣减，再写最新导入结果。
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

app.post("/api/unpack/import-returns", upload.single("file"), (req, res) =>
  sendJson(res, () => {
    const uploadInfo = prepareUploadedFile(req);
    const result = importUnpackReturnWorkbook(uploadInfo.importPath, uploadInfo.originalName);
    return withStoredImportFile(uploadInfo, {
      result: { ...result, successCount: result.imported, rowCount: result.imported },
      importType: "unpack_returns",
      platform: "",
      store: "",
      rowCount: result.imported
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

app.get("/api/barcodes/catalog", (_req, res) => sendJson(res, () => getBarcodeCatalog()));
app.get("/api/barcodes/template", (req, res) => sendJson(res, () => getBarcodeTemplate(String(req.query.sku || ""))));
app.post("/api/barcodes/template", (req, res) => sendJson(res, () => saveBarcodeTemplate(req.body || {})));
app.get("/api/barcodes/printers", async (_req, res) => {
  try {
    res.json({ ok: true, data: await listBarcodePrinters() });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});
app.get("/api/barcodes/code128.svg", (req, res) => {
  try {
    const svg = renderBarcodeSvg({
      value: String(req.query.value || ""),
      scale: Number(req.query.scale || 2),
      height: Number(req.query.height || 18),
      includetext: req.query.text === "1",
      type: String(req.query.type || "code128")
    });
    res.setHeader("content-type", "image/svg+xml; charset=utf-8");
    res.send(svg);
  } catch (error) {
    res.status(400).send(error.message);
  }
});

app.get("/api/unpack/overview", (_req, res) => sendJson(res, () => getUnpackOverview()));
app.get("/api/unpack/sessions", (req, res) =>
  sendJson(res, () => listUnpackSessions({ status: String(req.query.status || ""), keyword: String(req.query.keyword || "") }))
);
app.get("/api/unpack/sessions/:id", (req, res) => sendJson(res, () => getUnpackSession(req.params.id)));
app.post("/api/unpack/scan", async (req, res) => {
  try {
    const trackingNo = String(req.body?.trackingNo || "");
    const operator = String(req.body?.operator || process.env.UNPACK_DEFAULT_OPERATOR || "local");
    const source = String(req.body?.source || "scanner");
    const session = trackingNo.trim().toUpperCase() === UNPACK_COMPLETE_BARCODE
      ? completeUnpackSession({ operator })
      : startUnpackSession({ trackingNo, operator, scanSource: source });
    const command = createNasCommand(session.id, session.status === "recording" ? "start" : "complete");
    await dispatchNasCommand(command);
    res.json({ ok: true, data: { ...getUnpackSession(session.id), completeBarcode: UNPACK_COMPLETE_BARCODE } });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});
app.get("/api/unpack/export.csv", (_req, res) => {
  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent("拆包扫码记录.csv")}`);
  res.send(exportUnpackCsv());
});
app.get("/api/unpack/complete-barcode.svg", (_req, res) => {
  try {
    res.setHeader("content-type", "image/svg+xml; charset=utf-8");
    res.send(renderBarcodeSvg({ value: UNPACK_COMPLETE_BARCODE, height: 22, includetext: true, type: "code128" }));
  } catch (error) {
    res.status(500).send(error.message);
  }
});
app.get("/api/unpack/cameras", (_req, res) => sendJson(res, () => listUnpackCameras()));
app.post("/api/unpack/cameras", (req, res) => sendJson(res, () => saveUnpackCamera(req.body || {})));
app.post("/api/unpack/nas/video-clips", (req, res) => {
  try {
    verifyNasSignature({
      timestamp: req.header("x-unpack-timestamp"),
      signature: req.header("x-unpack-signature"),
      rawBody: req.rawBody || JSON.stringify(req.body || {})
    });
    res.json({ ok: true, data: registerNasVideoClip(req.body || {}) });
  } catch (error) {
    res.status(401).json({ ok: false, error: error.message });
  }
});

app.post("/api/dingtalk/send-report", async (req, res) => {
  try {
    const type = req.body.type || "inventory";
    const report =
      type === "monthly"
        ? buildMonthlyMarkdown(req.body.month)
        : buildInventoryMarkdown('table');
    const result = await sendDingTalkMarkdown({
      title: report.title,
      text: report.text
    });
    res.json({ ok: true, report, result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/sync/cainiao-inventory", (_req, res) => {
  try {
    const scriptPath = path.join(rootDir, "core", "sync-cainiao-inventory.js");
    const child = spawn(process.execPath, [scriptPath], {
      cwd: rootDir,
      detached: true,
      stdio: "ignore"
    });
    child.unref();
    res.json({ ok: true, message: "已开始同步菜鸟库存，完成后会推送钉钉消息" });
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
  // 大多数同步业务接口共用这个返回格式，前端 api() 也依赖 { ok, data/error } 约定。
  try {
    res.json({ ok: true, data: fn() });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
}

async function dispatchNasCommand(command) {
  const url = process.env.VIDEO_NAS_COMMAND_URL || "";
  const secret = process.env.UNPACK_NAS_SHARED_SECRET || "";
  const db = getDb();
  if (!url || !secret) {
    db.prepare("UPDATE unpack_nas_commands SET status = 'not_configured', error = 'NAS command URL or shared secret is missing' WHERE id = ?").run(command.id);
    return;
  }
  const timestamp = String(Date.now());
  const body = JSON.stringify({ id: command.id, sessionId: command.sessionId, commandType: command.commandType, payload: JSON.parse(command.payload) });
  const signature = crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-unpack-timestamp": timestamp, "x-unpack-signature": signature },
      body,
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error(`NAS returned HTTP ${response.status}`);
    db.prepare("UPDATE unpack_nas_commands SET status = 'sent', completed_at = CURRENT_TIMESTAMP WHERE id = ?").run(command.id);
  } catch (error) {
    db.prepare("UPDATE unpack_nas_commands SET status = 'failed', error = ? WHERE id = ?").run(error.message, command.id);
  }
}

function prepareUploadedFile(req) {
  if (!req.file?.path) throw new Error("请上传 Excel/CSV 文件。");
  const originalName = decodeUploadName(req.file.originalname || "");
  const ext = path.extname(originalName || req.file.originalname || "");
  const hash = hashFile(req.file.path);
  const existing = getDb().prepare("SELECT stored_path AS storedPath FROM imported_files WHERE hash = ?").get(hash);

  // multer 的临时文件没有扩展名时，Excel 解析库会更难判断格式；这里补回原扩展名。
  if (ext && !req.file.path.endsWith(ext)) {
    const renamed = `${req.file.path}${ext}`;
    fs.renameSync(req.file.path, renamed);
    req.file.path = renamed;
  }

  if (existing?.storedPath && fs.existsSync(existing.storedPath)) {
    // 相同 hash 的文件只保留一份，重复导入仍会重新解析旧文件，但不重复保存档案。
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
  // 业务导入成功后再归档原文件，保证“文件档案”里只出现系统确实处理过的文件。
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
  // 图片按 SKU 分文件夹保存，数据库只记录公开访问 URL 和排序。
  // 这里允许大量图片，前端弹窗负责预览和选择。
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
