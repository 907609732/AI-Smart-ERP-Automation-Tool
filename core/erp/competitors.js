import { getDb, nowDate } from "./db.js";

const DESKTOP_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36";
const MOBILE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

export function listCompetitors({ sku = "" } = {}) {
  const db = getDb();
  const params = {};
  const where = [];
  if (sku) {
    where.push("c.sku = @sku");
    params.sku = sku;
  }
  const items = db
    .prepare(
      `SELECT c.id, c.label, c.platform, c.relation, c.sku, c.url,
              c.note, c.enabled, c.created_at AS createdAt,
              s.snapshot_date AS snapshotDate, s.title, s.price,
              s.sales_text AS salesText, s.sales_value AS salesValue,
              s.status, s.error
       FROM competitors c
       LEFT JOIN competitor_snapshots s
         ON s.id = (
           SELECT id FROM competitor_snapshots
           WHERE competitor_id = c.id
           ORDER BY snapshot_date DESC, id DESC
           LIMIT 1
         )
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY c.enabled DESC, c.relation DESC, c.id DESC`
    )
    .all(params);
  const unboundItems = sku
    ? db
        .prepare(
          `SELECT c.id, c.label, c.platform, c.relation, c.sku, c.url,
                  c.note, c.enabled, c.created_at AS createdAt,
                  s.snapshot_date AS snapshotDate, s.title, s.price,
                  s.sales_text AS salesText, s.sales_value AS salesValue,
                  s.status, s.error
           FROM competitors c
           LEFT JOIN competitor_snapshots s
             ON s.id = (
               SELECT id FROM competitor_snapshots
               WHERE competitor_id = c.id
               ORDER BY snapshot_date DESC, id DESC
               LIMIT 1
             )
           WHERE c.sku = ''
           ORDER BY c.id DESC`
        )
        .all()
    : [];
  return {
    sku,
    items,
    unboundItems,
    comparison: buildComparison(items)
  };
}

export function createCompetitor(payload) {
  const db = getDb();
  const sku = String(payload.sku || "").trim();
  if (!sku) throw new Error("请选择正式库存 SKU。");
  ensureActiveSku(sku);
  const label = String(payload.label || "").trim();
  const url = String(payload.url || "").trim();
  if (!label) throw new Error("请填写链接名称。");
  if (!url) throw new Error("请填写商品链接。");
  const result = db
    .prepare(
      `INSERT INTO competitors (label, platform, relation, sku, url, note, enabled)
       VALUES (@label, @platform, @relation, @sku, @url, @note, @enabled)`
    )
    .run({
      label,
      platform: normalizePlatform(payload.platform || url),
      relation: payload.relation === "own" ? "own" : "competitor",
      sku,
      url,
      note: String(payload.note || "").trim(),
      enabled: payload.enabled === false || payload.enabled === "0" ? 0 : 1
    });
  return getCompetitor(result.lastInsertRowid);
}

export function updateCompetitor(id, payload) {
  const db = getDb();
  const current = getCompetitor(id);
  if (!current) throw new Error("同行链接不存在。");
  const nextSku = payload.sku == null ? current.sku : String(payload.sku || "").trim();
  if (nextSku) ensureActiveSku(nextSku);
  const nextUrl = payload.url == null ? current.url : String(payload.url || "").trim();
  const nextPlatform = payload.platform == null ? current.platform : normalizePlatform(payload.platform || nextUrl);
  db.prepare(
    `UPDATE competitors SET
       label = @label,
       platform = @platform,
       relation = @relation,
       sku = @sku,
       url = @url,
       note = @note,
       enabled = @enabled
     WHERE id = @id`
  ).run({
    id,
    label: payload.label == null ? current.label : String(payload.label || "").trim(),
    platform: nextPlatform,
    relation: payload.relation == null ? current.relation : payload.relation === "own" ? "own" : "competitor",
    sku: nextSku,
    url: nextUrl,
    note: payload.note == null ? current.note : String(payload.note || "").trim(),
    enabled:
      payload.enabled == null
        ? current.enabled
        : payload.enabled === true || payload.enabled === "1" || payload.enabled === 1
          ? 1
          : 0
  });
  return getCompetitor(id);
}

export function getCompetitorSnapshots(id, { range = 90 } = {}) {
  const safeRange = Math.min(Math.max(Number(range) || 90, 1), 365);
  return getDb()
    .prepare(
      `SELECT snapshot_date AS snapshotDate, title, price,
              sales_text AS salesText, sales_value AS salesValue,
              status, error, created_at AS createdAt
       FROM competitor_snapshots
       WHERE competitor_id = ?
       ORDER BY snapshot_date DESC, id DESC
       LIMIT ?`
    )
    .all(id, safeRange)
    .reverse();
}

export function getCompetitorSkuSummary() {
  const rows = getDb()
    .prepare(
      `SELECT c.sku, sk.name AS skuName,
              COUNT(c.id) AS linkCount,
              MIN(CASE WHEN c.relation = 'competitor' THEN s.price END) AS minCompetitorPrice,
              MIN(CASE WHEN c.relation = 'own' THEN s.price END) AS ownPrice,
              MAX(s.snapshot_date) AS latestSnapshotDate
       FROM competitors c
       JOIN skus sk ON sk.sku = c.sku
       LEFT JOIN competitor_snapshots s
         ON s.id = (
           SELECT id FROM competitor_snapshots
           WHERE competitor_id = c.id
           ORDER BY snapshot_date DESC, id DESC
           LIMIT 1
         )
       WHERE c.sku != ''
       GROUP BY c.sku
       ORDER BY latestSnapshotDate DESC, linkCount DESC, c.sku`
    )
    .all();
  return rows.map((row) => ({
    ...row,
    priceGap:
      row.ownPrice != null && row.minCompetitorPrice != null
        ? Number(row.ownPrice) - Number(row.minCompetitorPrice)
        : null
  }));
}

export async function runCompetitorSnapshots({ sku = "", id = "" } = {}) {
  const db = getDb();
  const competitors = db
    .prepare(
      `SELECT * FROM competitors
       WHERE enabled = 1
         AND (? = '' OR sku = ?)
         AND (? = '' OR id = ?)
       ORDER BY id`
    )
    .all(sku, sku, id, id);
  const results = [];
  for (const competitor of competitors) {
    results.push(await snapshotCompetitor(competitor));
  }
  return results;
}

function getCompetitor(id) {
  return getDb()
    .prepare(
      `SELECT id, label, platform, relation, sku, url, note, enabled,
              created_at AS createdAt
       FROM competitors
       WHERE id = ?`
    )
    .get(id);
}

async function snapshotCompetitor(competitor) {
  const db = getDb();
  const date = nowDate();
  try {
    const platform = normalizePlatform(competitor.platform || competitor.url);
    const response = await fetch(competitor.url, {
      headers: buildRequestHeaders(platform)
    });
    const html = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const visibleText = decodeHtml(stripTags(html)).replace(/\s+/g, " ");
    if (needsLoginOrVerification(html, visibleText, platform)) {
      throw new Error("页面出现登录墙、验证码或访问受限。");
    }

    return saveCompetitorSnapshotFromHtml(competitor, { html, visibleText, platform, date });
  } catch (error) {
    db.prepare(
      `INSERT INTO competitor_snapshots
       (competitor_id, snapshot_date, status, error)
       VALUES (@competitorId, @snapshotDate, 'error', @error)
       ON CONFLICT(competitor_id, snapshot_date) DO UPDATE SET
         status = 'error',
         error = excluded.error,
         created_at = CURRENT_TIMESTAMP`
    ).run({
      competitorId: competitor.id,
      snapshotDate: date,
      error: error.message
    });
    return { id: competitor.id, status: "error", error: error.message };
  }
}

export function saveCompetitorSnapshotFromHtml(competitor, { html, visibleText = "", platform = "", date = nowDate() } = {}) {
  const db = getDb();
  const normalizedPlatform = normalizePlatform(platform || competitor.platform || competitor.url);
  const text = visibleText || decodeHtml(stripTags(html)).replace(/\s+/g, " ");
  const parsed = parseCompetitorPage({ html, visibleText: text, platform: normalizedPlatform });
  const title = parsed.title;
  const price = parsed.price;
  const salesText = parsed.salesText;
  const salesValue = parseSalesValue(salesText);
  const missing = [];
  if (price == null) missing.push("价格");
  if (!salesValue && salesText === "不可获取") missing.push("销量");
  const status = missing.length ? "partial" : "ok";
  const error = missing.length ? `未识别到公开${missing.join("和")}。` : "";

  db.prepare(
    `INSERT INTO competitor_snapshots
     (competitor_id, snapshot_date, title, price, sales_text, sales_value, status, error)
     VALUES (@competitorId, @snapshotDate, @title, @price, @salesText, @salesValue, @status, @error)
     ON CONFLICT(competitor_id, snapshot_date) DO UPDATE SET
       title = excluded.title,
       price = excluded.price,
       sales_text = excluded.sales_text,
       sales_value = excluded.sales_value,
       status = excluded.status,
       error = excluded.error,
       created_at = CURRENT_TIMESTAMP`
  ).run({
    competitorId: competitor.id,
    snapshotDate: date,
    title,
    price,
    salesText,
    salesValue,
    status,
    error
  });
  return { id: competitor.id, status, title, price, salesText, salesValue, error };
}

function buildRequestHeaders(platform) {
  const isPdd = platform === "拼多多";
  const headers = {
    "user-agent": isPdd ? MOBILE_USER_AGENT : DESKTOP_USER_AGENT,
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8"
  };
  if (isPdd) {
    headers.referer = "https://mobile.yangkeduo.com/";
    headers["sec-fetch-site"] = "same-origin";
    headers["sec-fetch-mode"] = "navigate";
    headers["sec-fetch-dest"] = "document";
    if (process.env.PDD_COOKIE) headers.cookie = process.env.PDD_COOKIE;
  }
  return headers;
}

function needsLoginOrVerification(html, visibleText, platform) {
  if (/验证码|滑块|安全验证|登录后|请登录|访问受限|风险验证/.test(visibleText)) return true;
  if (platform === "拼多多") {
    const rawData = extractWindowObject(html, "rawData");
    if (rawData && /["']needLogin["']\s*:\s*true/i.test(rawData)) return true;
  }
  return false;
}

function parseCompetitorPage({ html, visibleText, platform }) {
  if (platform === "拼多多") {
    return {
      title: extractPddTitle(html) || extractTitle(html),
      price: extractPddPrice(html) ?? extractPrice(html),
      salesText: extractPddSalesText(html, visibleText) || extractSalesText(visibleText)
    };
  }
  return {
    title: extractTitle(html),
    price: extractPrice(html),
    salesText: extractSalesText(visibleText)
  };
}

function ensureActiveSku(sku) {
  const row = getDb()
    .prepare("SELECT sku FROM skus WHERE sku = ? AND status = 'active' AND source IN ('manual', 'inventory')")
    .get(sku);
  if (!row) throw new Error(`请选择正式库存 SKU：${sku}`);
}

function buildComparison(items) {
  const ownPrices = items
    .filter((item) => item.relation === "own" && item.price != null)
    .map((item) => Number(item.price));
  const competitorPrices = items
    .filter((item) => item.relation === "competitor" && item.price != null)
    .map((item) => Number(item.price));
  const ownPrice = ownPrices.length ? Math.min(...ownPrices) : null;
  const minCompetitorPrice = competitorPrices.length ? Math.min(...competitorPrices) : null;
  return {
    linkCount: items.length,
    ownPrice,
    minCompetitorPrice,
    priceGap: ownPrice != null && minCompetitorPrice != null ? ownPrice - minCompetitorPrice : null
  };
}

function extractTitle(html) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";
  return decodeHtml(stripTags(title)).slice(0, 120);
}

function extractPrice(html) {
  const candidates = [
    /["']price["']\s*:\s*["']?([0-9]+(?:\.[0-9]+)?)/i,
    /["']salePrice["']\s*:\s*["']?([0-9]+(?:\.[0-9]+)?)/i,
    /["']currentPrice["']\s*:\s*["']?([0-9]+(?:\.[0-9]+)?)/i,
    /￥\s*([0-9]+(?:\.[0-9]+)?)/,
    /¥\s*([0-9]+(?:\.[0-9]+)?)/,
    /([0-9]+(?:\.[0-9]+)?)\s*元/
  ];
  for (const pattern of candidates) {
    const match = html.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

function extractSalesText(text) {
  const match =
    text.match(/([0-9.万wW+]+)\s*(?:人付款|人已买|已售|销量|付款|件已售|件已拼|已拼|人拼单|月销|月售)/) ||
    text.match(/(?:销量|已售|付款人数|月销|月售)[:：]?\s*([0-9.万wW+]+)/);
  return match ? match[0].slice(0, 40) : "不可获取";
}

function extractPddTitle(html) {
  return firstDecodedMatch(html, [
    /["']goods_name["']\s*:\s*["']([^"']{2,200})["']/i,
    /["']goodsName["']\s*:\s*["']([^"']{2,200})["']/i,
    /["']shareTitle["']\s*:\s*["']([^"']{2,200})["']/i,
    /["']goodsDesc["']\s*:\s*["']([^"']{2,200})["']/i
  ]);
}

function extractPddPrice(html) {
  const candidates = [];
  const centKeys =
    /["'](?:min_group_price|minGroupPrice|min_on_sale_group_price|minOnSaleGroupPrice|min_normal_price|minNormalPrice|group_price|groupPrice|event_price|eventPrice)["']\s*:\s*([0-9]{2,})/gi;
  for (const match of html.matchAll(centKeys)) {
    const value = Number(match[1]);
    const price = value / 100;
    if (price > 0 && price < 100000) candidates.push(price);
  }

  const textKeys =
    /["'](?:priceText|price_text|priceDesc|price_desc|priceTip|price_tip)["']\s*:\s*["'][^0-9"']*([0-9]+(?:\.[0-9]+)?)/gi;
  for (const match of html.matchAll(textKeys)) {
    const price = Number(match[1]);
    if (price > 0 && price < 100000) candidates.push(price);
  }

  return candidates.length ? Math.min(...candidates) : null;
}

function extractPddSalesText(html, visibleText) {
  const jsonValue = firstDecodedMatch(html, [
    /["']side_sales_tip["']\s*:\s*["']([^"']{1,80})["']/i,
    /["']sideSalesTip["']\s*:\s*["']([^"']{1,80})["']/i,
    /["']bottom_sales_tip["']\s*:\s*["']([^"']{1,80})["']/i,
    /["']bottomSalesTip["']\s*:\s*["']([^"']{1,80})["']/i,
    /["']sales_tip["']\s*:\s*["']([^"']{1,80})["']/i,
    /["']salesTip["']\s*:\s*["']([^"']{1,80})["']/i
  ]);
  if (jsonValue) return jsonValue.slice(0, 40);

  const salesNumber = html.match(/["']sales["']\s*:\s*([0-9]+)/i)?.[1];
  if (salesNumber) return `已拼${salesNumber}件`;

  const textMatch =
    visibleText.match(/([0-9.万wW+]+)\s*(?:件已拼|已拼|人拼单|件已售|已售|销量|月售|月销)/) ||
    visibleText.match(/(?:已拼|已售|销量|月售|月销)[:：]?\s*([0-9.万wW+]+)/);
  return textMatch ? textMatch[0].slice(0, 40) : "";
}

function firstDecodedMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return decodeJsonText(match[1]).slice(0, 200);
  }
  return "";
}

function decodeJsonText(value) {
  const text = String(value || "");
  try {
    return decodeHtml(JSON.parse(`"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)).trim();
  } catch {
    return decodeHtml(text.replace(/\\u002F/g, "/")).trim();
  }
}

function extractWindowObject(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return html.match(new RegExp(`window\\.${escaped}\\s*=\\s*(\\{[\\s\\S]*?\\});`, "i"))?.[1] || "";
}

function parseSalesValue(salesText) {
  const match = String(salesText || "").match(/([0-9]+(?:\.[0-9]+)?)/);
  if (!match) return null;
  const unit = /万|w/i.test(salesText) ? 10000 : 1;
  return Number(match[1]) * unit;
}

function normalizePlatform(value) {
  const text = String(value || "").toLowerCase();
  if (/pinduoduo|yangkeduo|拼多多|pdd/.test(text)) return "拼多多";
  if (/taobao|tmall|淘宝|天猫/.test(text)) return "淘宝";
  if (/jd|jingdong|京东/.test(text)) return "京东";
  return String(value || "").trim();
}

function stripTags(value) {
  return String(value || "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, "");
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
