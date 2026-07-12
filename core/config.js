import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const rootDir = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(rootDir, ".env.local") });
dotenv.config({ path: path.join(rootDir, ".env") });

export function loadConfig() {
  const configPath = path.join(rootDir, "config.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  return {
    ...config,
    downloadDir: path.resolve(rootDir, config.downloadDir || "downloads"),
    reportDir: path.resolve(rootDir, config.reportDir || "reports"),
    stateDir: path.resolve(rootDir, "state")
  };
}

export function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`缺少环境变量 ${name}，请在 .env.local 或 .env 中填写。`);
  }
  return value;
}

