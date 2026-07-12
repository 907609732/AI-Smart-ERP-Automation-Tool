import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chromium } from "playwright";
import { loadConfig } from "./config.js";
import { getDb, nowDate } from "./erp/db.js";
import { saveCompetitorSnapshotFromHtml } from "./erp/competitors.js";

const MOBILE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, ...value] = arg.replace(/^--/, "").split("=");
    return [key, value.join("=") || "1"];
  })
);

const config = loadConfig();
const profileDir = process.env.PDD_CHROME_PROFILE_DIR || path.join(config.stateDir, "pdd-mobile-profile");
const headless = args.headless === "1" || process.env.HEADLESS === "true";
const waitLogin = args["wait-login"] !== "0";
const loginOnly = args.login === "1";

const competitors = getPddCompetitors();
if (!loginOnly && !competitors.length) {
  console.log("没有找到启用的拼多多同行链接。");
  process.exit(0);
}

const context = await chromium.launchPersistentContext(profileDir, {
  headless,
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
  userAgent: MOBILE_USER_AGENT,
  locale: "zh-CN",
  args: ["--disable-blink-features=AutomationControlled"]
});

const page = await context.newPage();
const rl = readline.createInterface({ input, output });
const results = [];

try {
  if (loginOnly) {
    await page.goto("https://mobile.yangkeduo.com/", { waitUntil: "domcontentloaded", timeout: 60000 });
    console.log("请在弹出的手机模式浏览器里完成拼多多登录，完成后回到终端按回车。");
    await rl.question("登录完成后按回车保存登录态：");
    console.log(`登录态已保存到：${profileDir}`);
  } else {
    for (const competitor of competitors) {
      console.log(`\n打开：${competitor.label} #${competitor.id}`);
      await page.goto(competitor.url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(2500);

      let pageText = await readBodyText(page);
      if (needsManualLogin(pageText) && waitLogin && !headless) {
        console.log("拼多多页面需要登录。请在弹出的手机模式浏览器里完成登录，然后回到终端按回车继续。");
        await rl.question("登录完成后按回车继续：");
        await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(2500);
        pageText = await readBodyText(page);
      }

      if (needsManualLogin(pageText)) {
        const result = recordError(competitor.id, "拼多多仍要求登录，未采集到商品数据。");
        results.push(result);
        console.log(JSON.stringify(result));
        continue;
      }

      const html = await page.content();
      const result = saveCompetitorSnapshotFromHtml(competitor, {
        html,
        visibleText: pageText.replace(/\s+/g, " "),
        platform: "拼多多"
      });
      results.push(result);
      console.log(JSON.stringify(result));
    }
  }
} finally {
  rl.close();
  await context.close();
}

console.log(`\n拼多多手机模式采集完成：${results.length} 条。`);

function getPddCompetitors() {
  const id = String(args.id || "").trim();
  const sku = String(args.sku || "").trim();
  return getDb()
    .prepare(
      `SELECT *
       FROM competitors
       WHERE enabled = 1
         AND platform = '拼多多'
         AND (@id = '' OR id = @id)
         AND (@sku = '' OR sku = @sku)
       ORDER BY id`
    )
    .all({ id, sku });
}

async function readBodyText(page) {
  return page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
}

function needsManualLogin(text) {
  return /登录|请登录|验证码|安全验证|滑块|访问受限|打开拼多多APP/i.test(String(text || ""));
}

function recordError(competitorId, error) {
  getDb()
    .prepare(
      `INSERT INTO competitor_snapshots
       (competitor_id, snapshot_date, status, error)
       VALUES (@competitorId, @snapshotDate, 'error', @error)
       ON CONFLICT(competitor_id, snapshot_date) DO UPDATE SET
         status = 'error',
         error = excluded.error,
         created_at = CURRENT_TIMESTAMP`
    )
    .run({ competitorId, snapshotDate: nowDate(), error });
  return { id: competitorId, status: "error", error };
}
