import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.js";

const config = loadConfig();
const profileDir = process.env.CAINIAO_CHROME_PROFILE_DIR || path.join(config.stateDir, "chrome-profile");
fs.mkdirSync(profileDir, { recursive: true });

const args = [
  "-na",
  "Google Chrome",
  "--args",
  `--user-data-dir=${profileDir}`,
  config.startUrl
];

console.log("正在打开专用 Chrome 档案。请在打开的浏览器里手动完成菜鸟云仓登录。");
console.log(`档案目录：${profileDir}`);

execFile("open", args, (error) => {
  if (error) {
    console.error(error);
    process.exitCode = 1;
  }
});
