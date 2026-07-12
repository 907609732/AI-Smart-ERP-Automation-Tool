import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.js";
import { syncLatestCainiaoInventory } from "./sync-cainiao-inventory-file.js";

const config = loadConfig();
const userDownloadsDir = path.join(process.env.HOME || "/Users/chenyuecai", "Downloads");
const watchedDirs = [...new Set([userDownloadsDir, config.downloadDir])].filter((dir) => fs.existsSync(dir));
const inventoryFilePattern = /库存.*\.(xlsx|xls|csv)$/i;
let running = false;
let pendingTimer = null;

console.log("正在监听菜鸟库存下载：");
for (const dir of watchedDirs) console.log(`- ${dir}`);
console.log("在本机 Chrome 手动下载库存明细后，系统会自动导入并发送钉钉。");

function scheduleSync(fileName = "") {
  if (fileName && (!inventoryFilePattern.test(fileName) || fileName.startsWith("~$"))) return;
  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(runSync, 1500);
}

async function runSync() {
  if (running) return;
  running = true;
  try {
    const result = await syncLatestCainiaoInventory();
    if (result.skipped) {
      console.log(`跳过：${result.reason}`);
    } else {
      console.log(`已同步并发送钉钉：${result.localFile}`);
    }
  } catch (error) {
    console.error(`同步失败：${error.message}`);
  } finally {
    running = false;
  }
}

for (const dir of watchedDirs) {
  fs.watch(dir, (_event, fileName) => scheduleSync(String(fileName || "")));
}

process.stdin.resume();
