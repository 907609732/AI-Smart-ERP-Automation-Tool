import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getDb } from "./db.js";
import { rootDir } from "../config.js";

const importedFilesDir = path.join(rootDir, "data", "imported-files");

export function archiveImportedFile({
  file,
  originalName = path.basename(file),
  importType,
  platform = "",
  store = "",
  warehouseId = "",
  period = "",
  rowCount = 0
}) {
  fs.mkdirSync(importedFilesDir, { recursive: true });
  const hash = hashFile(file);
  const existing = getDb().prepare("SELECT hash FROM imported_files WHERE hash = ?").get(hash);
  if (existing) {
    getDb()
      .prepare("UPDATE imported_files SET last_used_at = CURRENT_TIMESTAMP WHERE hash = ?")
      .run(hash);
    return { hash, originalName, duplicate: true };
  }

  const ext = path.extname(file);
  const storedPath = path.join(importedFilesDir, `${hash}${ext}`);
  fs.copyFileSync(file, storedPath);
  const sizeBytes = fs.statSync(file).size;

  getDb()
    .prepare(
      `INSERT INTO imported_files
       (hash, original_name, stored_path, size_bytes, import_type, platform,
        store, warehouse_id, period, row_count)
       VALUES (@hash, @originalName, @storedPath, @sizeBytes, @importType,
        @platform, @store, @warehouseId, @period, @rowCount)`
    )
    .run({
      hash,
      originalName,
      storedPath,
      sizeBytes,
      importType,
      platform,
      store,
      warehouseId,
      period,
      rowCount
    });

  return { hash, originalName, duplicate: false };
}

export function hashFile(file) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}
