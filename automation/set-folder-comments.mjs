import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const folderComments = {
  core: "系统核心：后端 API、数据库、导入、报表、钉钉、自动化底层",
  web: "页面前端：ERP 的 HTML、JS、CSS",
  data: "数据中心：SQLite 数据库、导入文件档案、商品图片",
  uploads: "上传缓存：网页上传文件的临时目录",
  downloads: "下载文件：菜鸟或平台自动化下载的原始文件",
  reports: "输出报表：库存日报、调试截图、导出结果",
  state: "运行状态：浏览器登录态、Chrome profile、自动化状态",
  logs: "运行日志：服务、定时任务、自动化日志",
  docs: "项目文档：架构、模块索引、流程说明",
  automation: "自动化流程：菜鸟库存到钉钉，以及未来更多流程",
  config: "配置模板：环境变量、launchd、示例配置"
};

function escapeAppleScript(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function setCommentWithXattr(target, comment) {
  const plist = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    `<string>${escapeXml(comment)}</string>`,
    "</plist>"
  ].join("\n");
  const binary = execFileSync("plutil", ["-convert", "binary1", "-o", "-", "-"], { input: plist });
  execFileSync("xattr", ["-w", "-x", "com.apple.metadata:kMDItemFinderComment", binary.toString("hex"), target]);
}

function setCommentWithFinder(target, comment) {
  const script = [
    "with timeout of 5 seconds",
    'tell application "Finder"',
    `  set comment of (POSIX file "${escapeAppleScript(target)}" as alias) to "${escapeAppleScript(comment)}"`,
    "end tell",
    "end timeout"
  ].join("\n");
  execFileSync("osascript", ["-e", script], { stdio: "inherit" });
}

for (const [folder, comment] of Object.entries(folderComments)) {
  const target = path.join(rootDir, folder);
  fs.mkdirSync(target, { recursive: true });

  try {
    setCommentWithXattr(target, comment);
    console.log(`${folder}: ${comment}`);
  } catch (error) {
    try {
      setCommentWithFinder(target, comment);
      console.log(`${folder}: ${comment}`);
    } catch {
      console.warn(`${folder}: Finder 备注写入失败，可以稍后重新执行 npm run set-folder-comments`);
    }
  }
}
