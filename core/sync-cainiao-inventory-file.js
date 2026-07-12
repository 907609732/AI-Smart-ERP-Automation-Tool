import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, rootDir } from "./config.js";
import { sendDingTalkMarkdown } from "./dingtalk.js";
import { buildInventoryMarkdown } from "./erp/reports.js";
import { importInventoryFile } from "./erp/importers.js";
import { buildInventoryReport } from "./process-inventory.js";

const config = loadConfig();
const userDownloadsDir = path.join(process.env.HOME || "/Users/chenyuecai", "Downloads");
const statePath = path.join(config.stateDir, "last-cainiao-inventory-sync.json");
const inventoryFilePattern = /库存.*\.(xlsx|xls|csv)$/i;

function extractDateFromFilename(filename) {
  const match = filename.match(/(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

export async function syncLatestCainiaoInventory({
  minMtimeMs = 0,
  allowAlreadySynced = false,
  waitStable = true
} = {}) {
  fs.mkdirSync(config.downloadDir, { recursive: true });
  fs.mkdirSync(config.reportDir, { recursive: true });
  fs.mkdirSync(config.stateDir, { recursive: true });

  const latest = findLatestInventoryFile({ minMtimeMs });
  if (!latest) {
    throw new Error("没有找到新的菜鸟库存文件。请先在本机 Chrome 的菜鸟云仓页面手动导出并下载库存明细，或运行 npm run sync:inventory:full 自动导出。");
  }

  if (waitStable) await waitForStableFile(latest.path);

  const today = new Date().toISOString().slice(0, 10);
  const fileDate = extractDateFromFilename(latest.name);
  if (fileDate && fileDate !== today) {
    throw new Error(
      `找到的最新库存文件日期是 ${fileDate}，不是今天（${today}）。\n` +
      `请运行 npm run sync:inventory:full 重新导出今天的库存，或先在本机 Chrome 手动下载 today's 库存文件。`
    );
  }

  const fingerprint = fileFingerprint(latest.path);
  const previous = readLastSync();
  if (!allowAlreadySynced && previous?.fingerprint === fingerprint) {
    return {
      skipped: true,
      reason: "这个库存文件已经同步过。",
      file: latest.path,
      fingerprint,
      previous
    };
  }

  const localFile = copyIntoProjectDownloads(latest.path);
  const imported = importInventoryFile({
    file: localFile,
    warehouseId: "cainiao",
    snapshotDate: new Date().toISOString().slice(0, 10)
  });

  // 生成本地报告文件
  const report = buildInventoryReport(localFile);

  // 使用表格格式发送钉钉
  const dingReport = buildInventoryMarkdown('table');
  await sendDingTalkMarkdown({ title: dingReport.title, text: dingReport.text });

  const syncRecord = {
    syncedAt: new Date().toISOString(),
    sourceFile: latest.path,
    localFile,
    fingerprint,
    imported,
    reportPath: report.reportPath,
    title: report.title
  };
  fs.writeFileSync(statePath, JSON.stringify(syncRecord, null, 2));
  return {
    skipped: false,
    ...syncRecord
  };
}

export function findLatestInventoryFile({ minMtimeMs = 0 } = {}) {
  const files = [
    ...listCandidateFiles(userDownloadsDir),
    ...listCandidateFiles(config.downloadDir)
  ]
    .filter((file) => file.mtimeMs >= minMtimeMs)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files[0] || null;
}

function listCandidateFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && inventoryFilePattern.test(entry.name) && !entry.name.startsWith("~$"))
    .map((entry) => {
      const filePath = path.join(dir, entry.name);
      const stat = fs.statSync(filePath);
      return {
        path: filePath,
        name: entry.name,
        size: stat.size,
        mtimeMs: stat.mtimeMs
      };
    });
}

async function waitForStableFile(filePath, timeoutMs = 30000) {
  const startedAt = Date.now();
  let previousSize = -1;
  let stableCount = 0;
  while (Date.now() - startedAt < timeoutMs) {
    const size = fs.statSync(filePath).size;
    if (size > 0 && size === previousSize) {
      stableCount += 1;
      if (stableCount >= 2) return;
    } else {
      stableCount = 0;
      previousSize = size;
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  throw new Error(`库存文件还没有下载稳定：${filePath}`);
}

function copyIntoProjectDownloads(filePath) {
  const target = path.join(config.downloadDir, path.basename(filePath));
  if (path.resolve(filePath) !== path.resolve(target)) {
    fs.copyFileSync(filePath, target);
  }
  return target;
}

function fileFingerprint(filePath) {
  const stat = fs.statSync(filePath);
  return `${path.basename(filePath)}:${stat.size}:${Math.round(stat.mtimeMs)}`;
}

function readLastSync() {
  if (!fs.existsSync(statePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  const force = process.argv.includes("--force");
  const result = await syncLatestCainiaoInventory({ allowAlreadySynced: force });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
