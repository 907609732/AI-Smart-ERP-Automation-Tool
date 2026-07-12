import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { loadConfig, requireEnv } from "./config.js";
import { buildInventoryReport } from "./process-inventory.js";
import { sendDingTalkMarkdown } from "./dingtalk.js";

const config = loadConfig();
const statePath = path.join(config.stateDir, "cainiao-storage-state.json");
const profileDir = process.env.CAINIAO_CHROME_PROFILE_DIR || path.join(config.stateDir, "chrome-profile");

function ensureDirs() {
  for (const dir of [config.downloadDir, config.reportDir, config.stateDir, path.join(config.reportDir, "..", "logs")]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function firstVisible(page, selectors, timeout = 1500) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      await locator.waitFor({ state: "visible", timeout });
      return locator;
    } catch {
      // Try the next known selector.
    }
  }
  return null;
}

async function fillLoginIfNeeded(page) {
  const username = requireEnv("CAINIAO_USERNAME");
  const password = requireEnv("CAINIAO_PASSWORD");

  const passwordInput = await firstVisible(page, config.login.passwordSelectors, 3000);
  if (!passwordInput) return false;

  const usernameInput = await firstVisible(page, config.login.usernameSelectors, 1000);
  if (usernameInput) {
    await usernameInput.fill(username);
  }
  await passwordInput.fill(password);

  const submit = await firstVisible(page, config.login.submitSelectors, 1000);
  if (submit) {
    await Promise.all([
      page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => null),
      submit.click()
    ]);
  } else {
    await passwordInput.press("Enter");
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => null);
  }

  const stillNeedsPassword = await firstVisible(page, config.login.passwordSelectors, 2000);
  if (stillNeedsPassword && process.env.HEADLESS !== "true") {
    console.log("检测到仍在登录页，可能需要验证码/滑块。请在打开的浏览器中手动完成登录。");
    await page.waitForURL((url) => !String(url).includes("login"), { timeout: 180000 }).catch(() => null);
  }

  let loginStillVisible = await firstVisible(page, config.login.passwordSelectors, 1000);
  let currentUrl = page.url();
  let currentTitle = await page.title().catch(() => "");
  let stillOnLoginPage =
    currentUrl.includes("login") ||
    currentUrl.includes("cnlogin.cainiao.com") ||
    currentTitle.includes("登录");

  if (stillOnLoginPage && process.env.HEADLESS !== "true") {
    console.log("当前仍在登录页。请在打开的浏览器中完成短信/滑块验证，脚本最多等待 10 分钟。");
    await page.waitForURL((url) => !String(url).includes("login"), { timeout: 600000 }).catch(() => null);
    loginStillVisible = await firstVisible(page, config.login.passwordSelectors, 1000);
    currentUrl = page.url();
    currentTitle = await page.title().catch(() => "");
    stillOnLoginPage =
      currentUrl.includes("login") ||
      currentUrl.includes("cnlogin.cainiao.com") ||
      currentTitle.includes("登录");
  }

  if (loginStillVisible || stillOnLoginPage) {
    throw new Error("仍未完成登录。请重新运行 npm run run:headed，并在打开的浏览器中完成验证码/滑块/短信验证。");
  }

  return true;
}

async function runConfiguredSteps(page) {
  let downloadedPath = null;

  for (const step of config.downloadSteps || []) {
    console.log(`执行步骤：${step.type}${step.selector ? ` ${step.selector}` : ""}`);
    if (step.type === "goto") {
      await page.goto(step.url, { waitUntil: "domcontentloaded" });
    } else if (step.type === "click") {
      await page.locator(step.selector).first().click();
    } else if (step.type === "fill") {
      await page.locator(step.selector).first().fill(step.value || "");
    } else if (step.type === "press") {
      await page.locator(step.selector || "body").first().press(step.key);
    } else if (step.type === "wait") {
      await page.waitForTimeout(step.ms || 1000);
    } else if (step.type === "waitForSelector") {
      await page.locator(step.selector).first().waitFor({
        state: step.state || "visible",
        timeout: step.timeout || 30000
      });
    } else if (step.type === "download") {
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: step.timeout || 60000 }),
        page.locator(step.selector).first().click()
      ]);
      downloadedPath = path.join(config.downloadDir, download.suggestedFilename());
      await download.saveAs(downloadedPath);
    } else {
      throw new Error(`未知下载步骤类型：${step.type}`);
    }
  }

  return downloadedPath;
}

async function runAutoDownload(page) {
  if (!config.autoDownload?.enabled) return null;

  for (const text of config.autoDownload.navigationTexts || []) {
    const target = page.getByText(text, { exact: false }).first();
    if (await target.isVisible({ timeout: 1500 }).catch(() => false)) {
      await target.click();
      await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => null);
      break;
    }
  }

  for (const text of config.autoDownload.downloadTexts || []) {
    const target = page.getByText(text, { exact: false }).first();
    if (!(await target.isVisible({ timeout: 1500 }).catch(() => false))) continue;

    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 60000 }),
      target.click()
    ]);
    const downloadedPath = path.join(config.downloadDir, download.suggestedFilename());
    await download.saveAs(downloadedPath);
    return downloadedPath;
  }

  return null;
}

async function main() {
  ensureDirs();

  const headless = process.env.HEADLESS === "true";
  const usePersistentBrowser = process.env.USE_PERSISTENT_BROWSER === "true";
  let context;
  try {
    console.log(`启动浏览器：${usePersistentBrowser ? profileDir : "temporary context"}`);
    context = usePersistentBrowser
      ? await chromium.launchPersistentContext(profileDir, {
          channel: "chrome",
          chromiumSandbox: true,
          headless: false,
          acceptDownloads: true
        })
      : await chromium
          .launch({ headless })
          .then((browser) =>
            browser.newContext({
              acceptDownloads: true,
              storageState: fs.existsSync(statePath) ? statePath : undefined
            })
          );
  } catch (error) {
    if (String(error?.message || error).includes("正在现有的浏览器会话中打开")) {
      throw new Error("Chrome 专用档案正在被手动登录窗口占用。请关闭刚才 npm run manual-login 打开的 Chrome 窗口后再运行。");
    }
    throw error;
  }
  const page = context.pages()[0] || (await context.newPage());

  try {
    console.log(`打开页面：${config.startUrl}`);
    await page.goto(config.startUrl, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => null);
    console.log(`当前页面：${page.url()}`);
    await fillLoginIfNeeded(page);
    await context.storageState({ path: statePath });

    let downloadedPath = null;
    if ((config.downloadSteps || []).length > 0) {
      downloadedPath = await runConfiguredSteps(page);
    } else {
      downloadedPath = await runAutoDownload(page);
    }

    if (!downloadedPath) {
      throw new Error(
        "没有完成库存文件下载。请在 config.json 的 downloadSteps 中配置实际页面点击路径，或把页面按钮名称补到 autoDownload。"
      );
    }

    const report = buildInventoryReport(downloadedPath);
    console.log(`生成报告：${report.reportPath}`);
    await sendDingTalkMarkdown({ title: report.title, text: report.markdown });
    console.log(`完成：${report.reportPath}`);
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
