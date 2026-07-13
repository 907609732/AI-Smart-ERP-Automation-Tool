import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import XLSX from "xlsx";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "erp-unpack-test-"));
process.env.ERP_DATA_DIR = path.join(tempDir, "data");

const {
  UNPACK_COMPLETE_BARCODE,
  completeUnpackSession,
  getUnpackOverview,
  importUnpackReturnWorkbook,
  startUnpackSession
} = await import("../core/erp/unpack.js");

test("imports a return source and completes an unpack recording session", () => {
  const workbookPath = path.join(tempDir, "returns.xlsx");
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["物流单号", "店铺", "平台", "申请时间", "状态", "商品信息"],
    ["YT123456789CN", "店口五金", "拼多多", "2026-07-13 09:30:00", "待拆包", "测试商品"]
  ]), "退货订单");
  XLSX.writeFile(workbook, workbookPath);

  const imported = importUnpackReturnWorkbook(workbookPath, "test");
  assert.equal(imported.imported, 1);

  const started = startUnpackSession({ trackingNo: "YT123456789CN", operator: "operator-1" });
  assert.equal(started.status, "recording");
  assert.equal(started.matchStatus, "matched");

  assert.throws(() => startUnpackSession({ trackingNo: "YT987654321CN" }), /正在录制/);
  assert.throws(() => startUnpackSession({ trackingNo: UNPACK_COMPLETE_BARCODE }), /完成条码/);

  const completed = completeUnpackSession({ operator: "operator-1" });
  assert.equal(completed.status, "completed");
  assert.equal(getUnpackOverview().summary.today, 1);
});

test.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
