import crypto from "node:crypto";
import XLSX from "xlsx";
import { getDb } from "./db.js";

export const UNPACK_COMPLETE_BARCODE = "UNPACK_COMPLETE";
const RETENTION_DAYS = 90;

export function getUnpackOverview() {
  const db = getDb();
  const active = db.prepare("SELECT * FROM unpack_sessions WHERE status = 'recording' ORDER BY started_at DESC LIMIT 1").get();
  return {
    activeSession: active ? decorateSession(active) : null,
    cameras: listUnpackCameras(),
    summary: {
      today: db.prepare("SELECT COUNT(*) AS value FROM unpack_sessions WHERE substr(started_at, 1, 10) = ?").get(chinaDate()).value,
      recording: db.prepare("SELECT COUNT(*) AS value FROM unpack_sessions WHERE status = 'recording'").get().value,
      unmatched: db.prepare("SELECT COUNT(*) AS value FROM unpack_sessions WHERE match_status = 'unmatched' AND status != 'recording'").get().value,
      sources: db.prepare("SELECT COUNT(*) AS value FROM unpack_return_sources").get().value
    }
  };
}

export function listUnpackSessions({ status = "", keyword = "", limit = 100 } = {}) {
  const db = getDb();
  const where = [];
  const params = {};
  if (status) {
    where.push("s.status = @status");
    params.status = status;
  }
  if (keyword) {
    where.push("(s.tracking_no LIKE @keyword OR r.product_name LIKE @keyword OR r.order_id LIKE @keyword)");
    params.keyword = `%${keyword}%`;
  }
  params.limit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const sql = `SELECT s.*, r.platform, r.store, r.order_id AS orderId, r.refund_id AS refundId,
                      r.product_name AS productName, r.return_status AS returnStatus
               FROM unpack_sessions s
               LEFT JOIN unpack_return_sources r ON r.id = s.return_source_id
               ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
               ORDER BY s.started_at DESC LIMIT @limit`;
  return db.prepare(sql).all(params).map(decorateSession);
}

export function startUnpackSession({ trackingNo, operator = "local", scanSource = "scanner" }) {
  const tracking = cleanTrackingNo(trackingNo);
  if (!tracking) throw new Error("请先扫描快递物流单号。");
  if (tracking === UNPACK_COMPLETE_BARCODE) throw new Error("完成条码只能用于结束正在录制的拆包会话。");
  const db = getDb();
  const active = db.prepare("SELECT id FROM unpack_sessions WHERE status = 'recording' ORDER BY started_at DESC LIMIT 1").get();
  if (active) throw new Error("当前已有正在录制的拆包会话，请先扫描完成录制条码。");
  const candidates = db.prepare("SELECT * FROM unpack_return_sources WHERE tracking_no = ? ORDER BY id").all(tracking);
  const session = {
    id: crypto.randomUUID(),
    trackingNo: tracking,
    status: "recording",
    matchStatus: candidates.length === 0 ? "unmatched" : candidates.length === 1 ? "matched" : "ambiguous",
    returnSourceId: candidates.length === 1 ? candidates[0].id : null,
    operator: String(operator || "local").trim() || "local",
    scanSource: String(scanSource || "scanner"),
    startedAt: chinaDateTime()
  };
  db.prepare(
    `INSERT INTO unpack_sessions (id, tracking_no, status, match_status, return_source_id, operator, scan_source, started_at)
     VALUES (@id, @trackingNo, @status, @matchStatus, @returnSourceId, @operator, @scanSource, @startedAt)`
  ).run(session);
  createExpectedClips(db, session.id);
  writeOperation(db, session.id, "unpack_started", session.operator, `物流单号 ${tracking} 开始拆包录像`);
  return getUnpackSession(session.id);
}

export function completeUnpackSession({ operator = "local" } = {}) {
  const db = getDb();
  const session = db.prepare("SELECT * FROM unpack_sessions WHERE status = 'recording' ORDER BY started_at DESC LIMIT 1").get();
  if (!session) throw new Error("当前没有进行中的拆包会话，请先扫描物流单号。");
  const endedAt = chinaDateTime();
  const duration = Math.max(0, Math.round((Date.now() - new Date(session.started_at.replace(" ", "T") + "+08:00").getTime()) / 1000));
  db.prepare(
    `UPDATE unpack_sessions
     SET status = 'completed', ended_at = ?, duration_seconds = ?, video_status = 'processing', updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(endedAt, duration, session.id);
  writeOperation(db, session.id, "unpack_completed", operator, `扫描完成条码，拆包时长 ${duration} 秒`);
  return getUnpackSession(session.id);
}

export function getUnpackSession(id) {
  const db = getDb();
  const row = db.prepare(
    `SELECT s.*, r.platform, r.store, r.order_id AS orderId, r.refund_id AS refundId,
            r.product_name AS productName, r.return_status AS returnStatus, r.apply_time AS applyTime
     FROM unpack_sessions s LEFT JOIN unpack_return_sources r ON r.id = s.return_source_id WHERE s.id = ?`
  ).get(id);
  if (!row) throw new Error("拆包会话不存在。");
  const clips = db.prepare(
    `SELECT id, clip_type AS clipType, camera_id AS cameraId, video_ref AS videoRef,
            started_at AS startedAt, ended_at AS endedAt, checksum, status, expires_at AS expiresAt
     FROM unpack_video_clips WHERE session_id = ? ORDER BY clip_type, camera_id`
  ).all(id);
  return { ...decorateSession(row), clips };
}

export function listUnpackCameras() {
  return getDb().prepare(
    `SELECT id, name, camera_type AS cameraType, stream_ref AS streamRef, enabled, status,
            created_at AS createdAt, updated_at AS updatedAt
     FROM unpack_cameras ORDER BY created_at`
  ).all();
}

export function saveUnpackCamera(payload = {}) {
  const id = String(payload.id || crypto.randomUUID());
  const camera = {
    id,
    name: String(payload.name || "").trim(),
    cameraType: String(payload.cameraType || "hikvision_rtsp").trim(),
    streamRef: String(payload.streamRef || "").trim(),
    enabled: payload.enabled === false || payload.enabled === "0" ? 0 : 1,
    status: String(payload.status || "unknown")
  };
  if (!camera.name) throw new Error("请填写摄像头名称。");
  getDb().prepare(
    `INSERT INTO unpack_cameras (id, name, camera_type, stream_ref, enabled, status)
     VALUES (@id, @name, @cameraType, @streamRef, @enabled, @status)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, camera_type = excluded.camera_type,
       stream_ref = excluded.stream_ref, enabled = excluded.enabled, status = excluded.status,
       updated_at = CURRENT_TIMESTAMP`
  ).run(camera);
  return listUnpackCameras().find((item) => item.id === id);
}

export function importUnpackReturnWorkbook(file, sourceFile = "") {
  const workbook = XLSX.readFile(file, { cellDates: true });
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO unpack_return_sources
     (tracking_no, platform, store, order_id, refund_id, product_name, return_status, apply_time, source_sheet, source_file)
     VALUES (@trackingNo, @platform, @store, @orderId, @refundId, @productName, @returnStatus, @applyTime, @sourceSheet, @sourceFile)
     ON CONFLICT(tracking_no, platform, store, order_id, refund_id, product_name, source_sheet)
     DO UPDATE SET return_status = excluded.return_status, apply_time = excluded.apply_time, imported_at = CURRENT_TIMESTAMP`
  );
  let scannedHistory = 0;
  let imported = 0;
  const sheets = [];
  const transaction = db.transaction(() => {
    for (const name of workbook.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: "", raw: false });
      if (!rows.length) continue;
      if (name.includes("扫码")) {
        scannedHistory += rows.slice(1).filter((row) => cleanTrackingNo(row[1])).length;
        sheets.push({ name, imported: 0, scannedHistory: true });
        continue;
      }
      const columns = inferReturnColumns(rows);
      let count = 0;
      for (const row of rows.slice(columns.startRow)) {
        const trackingNo = cleanTrackingNo(row[columns.tracking]);
        if (!trackingNo) continue;
        insert.run({
          trackingNo,
          platform: platformFromSheet(name),
          store: storeFromSheet(name),
          orderId: text(row[columns.orderId]),
          refundId: text(row[columns.refundId]),
          productName: text(row[columns.product]),
          returnStatus: text(row[columns.status]),
          applyTime: text(row[columns.date]),
          sourceSheet: name,
          sourceFile
        });
        imported += 1;
        count += 1;
      }
      sheets.push({ name, imported: count, scannedHistory: false });
    }
  });
  transaction();
  return { sheets, imported, scannedHistory };
}

export function exportUnpackCsv() {
  const rows = listUnpackSessions({ limit: 5000 });
  const headers = ["物流单号", "状态", "匹配结果", "平台", "店铺", "订单号", "退货单号", "商品", "开始时间", "结束时间", "时长秒", "操作员", "输入方式", "视频状态", "完整视频", "开始短片", "完成短片"];
  const lines = [headers, ...rows.map((row) => [
    row.trackingNo, statusLabel(row.status), statusLabel(row.matchStatus), row.platform, row.store, row.orderId,
    row.refundId, row.productName, row.startedAt, row.endedAt, row.durationSeconds, row.operator, row.scanSource,
    row.videoStatus, row.clips?.find((clip) => clip.clipType === "full")?.videoRef || "",
    row.clips?.find((clip) => clip.clipType === "start_event")?.videoRef || "",
    row.clips?.find((clip) => clip.clipType === "completion_event")?.videoRef || ""
  ])];
  return "\uFEFF" + lines.map((line) => line.map(csvCell).join(",")).join("\n");
}

export function registerNasVideoClip(payload = {}) {
  const db = getDb();
  const sessionId = String(payload.sessionId || "");
  if (!db.prepare("SELECT 1 FROM unpack_sessions WHERE id = ?").get(sessionId)) throw new Error("视频对应的拆包会话不存在。");
  const clip = {
    id: String(payload.id || crypto.randomUUID()),
    sessionId,
    clipType: String(payload.clipType || "full"),
    cameraId: String(payload.cameraId || ""),
    videoRef: String(payload.videoRef || ""),
    startedAt: String(payload.startedAt || ""),
    endedAt: String(payload.endedAt || ""),
    checksum: String(payload.checksum || ""),
    status: String(payload.status || "ready"),
    expiresAt: String(payload.expiresAt || addDays(chinaDate(), RETENTION_DAYS))
  };
  db.prepare(
    `INSERT INTO unpack_video_clips (id, session_id, clip_type, camera_id, video_ref, started_at, ended_at, checksum, status, expires_at)
     VALUES (@id, @sessionId, @clipType, @cameraId, @videoRef, @startedAt, @endedAt, @checksum, @status, @expiresAt)
     ON CONFLICT(session_id, clip_type, camera_id) DO UPDATE SET video_ref = excluded.video_ref,
       started_at = excluded.started_at, ended_at = excluded.ended_at, checksum = excluded.checksum,
       status = excluded.status, expires_at = excluded.expires_at, updated_at = CURRENT_TIMESTAMP`
  ).run(clip);
  const pending = db.prepare("SELECT COUNT(*) AS value FROM unpack_video_clips WHERE session_id = ? AND status != 'ready'").get(sessionId).value;
  db.prepare("UPDATE unpack_sessions SET video_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(pending ? "processing" : "ready", sessionId);
  return getUnpackSession(sessionId);
}

export function createNasCommand(sessionId, commandType) {
  const session = getUnpackSession(sessionId);
  const command = { id: crypto.randomUUID(), sessionId, commandType, payload: JSON.stringify({ session, eventWindowSeconds: 5, completeDelaySeconds: 5 }) };
  getDb().prepare(
    `INSERT INTO unpack_nas_commands (id, session_id, command_type, payload_json) VALUES (@id, @sessionId, @commandType, @payload)`
  ).run(command);
  return command;
}

export function verifyNasSignature({ timestamp, signature, rawBody }) {
  const secret = process.env.UNPACK_NAS_SHARED_SECRET || "";
  if (!secret) throw new Error("服务器未配置 UNPACK_NAS_SHARED_SECRET。");
  const age = Math.abs(Date.now() - Number(timestamp || 0));
  if (!Number.isFinite(age) || age > 5 * 60 * 1000) throw new Error("NAS 请求时间戳无效或已过期。");
  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(String(signature || ""), "utf8");
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) throw new Error("NAS 请求签名无效。");
}

function createExpectedClips(db, sessionId) {
  const cameras = db.prepare("SELECT id FROM unpack_cameras WHERE enabled = 1").all();
  const insert = db.prepare("INSERT OR IGNORE INTO unpack_video_clips (id, session_id, clip_type, camera_id, status) VALUES (?, ?, ?, ?, 'pending')");
  for (const camera of cameras) {
    for (const type of ["full", "start_event", "completion_event"]) insert.run(crypto.randomUUID(), sessionId, type, camera.id);
  }
}

function decorateSession(row) {
  const clips = getDb().prepare("SELECT clip_type AS clipType, camera_id AS cameraId, video_ref AS videoRef, status FROM unpack_video_clips WHERE session_id = ?").all(row.id);
  return {
    id: row.id, trackingNo: row.tracking_no, status: row.status, matchStatus: row.match_status,
    operator: row.operator, scanSource: row.scan_source, startedAt: row.started_at, endedAt: row.ended_at,
    durationSeconds: Number(row.duration_seconds || 0), videoStatus: row.video_status, note: row.note,
    platform: row.platform || "", store: row.store || "", orderId: row.orderId || "", refundId: row.refundId || "",
    productName: row.productName || "", returnStatus: row.returnStatus || "", applyTime: row.applyTime || "", clips
  };
}

function writeOperation(db, id, action, operator, note) {
  db.prepare("INSERT INTO operation_logs (entity_type, entity_id, action, operator, note) VALUES ('unpack_session', ?, ?, ?, ?)").run(id, action, String(operator || "local"), note);
}

function inferReturnColumns(rows) {
  const header = rows[0].map((value) => text(value));
  const find = (patterns, fallback) => {
    const index = header.findIndex((value) => patterns.some((pattern) => value.includes(pattern)));
    return index >= 0 ? index : fallback;
  };
  const tracking = find(["退货运单号", "物流单号", "运单号", "单号"], 1);
  return { startRow: header.some(Boolean) ? 1 : 0, tracking, date: find(["申请时间", "退款申请时间", "时间", "日期"], 0), status: find(["状态", "已签收", "快递"], 2), product: find(["sku", "商品", "宝贝", "标题"], 3), orderId: find(["订单"], -1), refundId: find(["退款", "售后"], -1) };
}

function platformFromSheet(name) { return name.includes("拼多多") ? "pdd" : name.includes("京东") ? "jd" : name.includes("淘宝") ? "qianniu" : ""; }
function storeFromSheet(name) { return name.includes("西施") ? "西施五金店" : name.includes("店口") ? "店口五金店" : ""; }
function cleanTrackingNo(value) { return text(value).replace(/\s+/g, "").toUpperCase(); }
function text(value) { return String(value ?? "").trim(); }
function csvCell(value) { const valueText = String(value ?? ""); return /[",\n]/.test(valueText) ? `"${valueText.replace(/"/g, '""')}"` : valueText; }
function statusLabel(value) { return ({ recording: "录制中", completed: "已完成", matched: "已匹配", unmatched: "未匹配", ambiguous: "多个候选" })[value] || value || ""; }
function chinaDate() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
function chinaDateTime() { return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", dateStyle: "short", timeStyle: "medium", hour12: false }).format(new Date()); }
function addDays(dateText, days) { const date = new Date(`${dateText}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
