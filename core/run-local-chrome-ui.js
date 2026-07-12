import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import dotenv from "dotenv";
import { buildInventoryReport } from "./process-inventory.js";
import { sendDingTalkMarkdown } from "./dingtalk.js";
import { loadConfig, rootDir } from "./config.js";

const execFileAsync = promisify(execFile);
const config = loadConfig();
const browserUrl = config.startUrl;
const userDownloadsDir = path.join(os.homedir(), "Downloads");

dotenv.config({ path: path.join(rootDir, ".env.local") });
dotenv.config({ path: path.join(rootDir, ".env") });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function osascript(script) {
  try {
    const { stdout } = await execFileAsync("osascript", ["-e", script], {
      maxBuffer: 1024 * 1024
    });
    return stdout.trim();
  } catch (error) {
    const message = String(error?.stderr || error?.message || error);
    if (message.includes("不允许辅助访问") || message.includes("assistive access")) {
      throw new Error(
        "macOS 拒绝 osascript 辅助访问。请到 系统设置 > 隐私与安全性 > 辅助功能，添加并开启 /usr/bin/osascript，然后重试。"
      );
    }
    throw error;
  }
}

async function clickAt(x, y) {
  await osascript(`tell application "System Events" to click at {${x}, ${y}}`);
}

async function openChromePage() {
  await osascript(`
tell application "Google Chrome"
  activate
  if (count of windows) = 0 then make new window
  set bounds of front window to {0, 25, 1350, 900}
  set URL of active tab of front window to "${browserUrl}"
end tell
`);
}

async function getActiveChromeUrl() {
  return osascript('tell application "Google Chrome" to get URL of active tab of front window');
}

function newestInventoryDownload(afterMs) {
  if (!fs.existsSync(userDownloadsDir)) return null;
  return fs
    .readdirSync(userDownloadsDir)
    .filter((name) => /^库存明细导出.*\.xlsx$/i.test(name))
    .map((name) => path.join(userDownloadsDir, name))
    .filter((file) => fs.statSync(file).mtimeMs >= afterMs)
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || null;
}

async function waitForDownload(afterMs, timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const file = newestInventoryDownload(afterMs);
    if (file && !fs.existsSync(`${file}.crdownload`)) return file;
    await sleep(2000);
  }
  throw new Error("等待 Chrome 下载库存明细超时。");
}

async function copyIntoProjectDownloads(file) {
  fs.mkdirSync(config.downloadDir, { recursive: true });
  const target = path.join(config.downloadDir, path.basename(file));
  fs.copyFileSync(file, target);
  return target;
}

async function main() {
  const startedAt = Date.now();
  console.log("打开本地 Chrome 菜鸟库存页面");
  await openChromePage();
  await sleep(12000);

  const currentUrl = await getActiveChromeUrl().catch(() => "");
  console.log(`当前 Chrome URL：${currentUrl}`);
  if (currentUrl.includes("login") || currentUrl.includes("cnlogin.cainiao.com")) {
    throw new Error("本地 Chrome 当前未登录菜鸟云仓。请先在日常 Chrome 里手动登录一次。");
  }

  console.log("点击库存明细");
  await clickAt(225, 270);
  await sleep(2500);

  console.log("点击查询");
  await clickAt(1245, 412);
  await sleep(3500);

  console.log("点击导出明细");
  await clickAt(125, 463);
  await sleep(3000);

  console.log("等待并点击下载");
  await sleep(10000);
  await clickAt(676, 538);

  const downloadedFile = await waitForDownload(startedAt);
  console.log(`下载完成：${downloadedFile}`);
  const projectFile = await copyIntoProjectDownloads(downloadedFile);
  const report = buildInventoryReport(projectFile);
  console.log(`生成报告：${report.reportPath}`);
  await sendDingTalkMarkdown({ title: report.title, text: report.markdown });
  console.log(`完成：${report.reportPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
