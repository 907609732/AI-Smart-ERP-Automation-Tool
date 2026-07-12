import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import bwipjs from "bwip-js";
import { getDb } from "./db.js";

const defaultTemplateDir = "/Users/chenyuecai/店口五金/S商品条形码";
const execFileAsync = promisify(execFile);

export function getBarcodeCatalog({ templateDir = defaultTemplateDir } = {}) {
  const templates = listHanmaTemplates(templateDir);
  const skus = getDb()
    .prepare(
      `SELECT sku, name, barcode, cost_price AS costPrice, low_stock_threshold AS lowStockThreshold
       FROM skus
       WHERE status = 'active' AND source IN ('manual', 'inventory')
       ORDER BY name, sku`
    )
    .all();
  const templateByCode = new Map(templates.filter((item) => item.barcode).map((item) => [normalizeCode(item.barcode), item]));
  const items = skus.map((sku) => {
    const code = sku.barcode || sku.sku;
    const template =
      templateByCode.get(normalizeCode(code)) ||
      templateByCode.get(normalizeCode(sku.sku)) ||
      findTemplateByName(templates, sku.name || sku.sku);
    const parsed = parseTemplateName(`${sku.name || sku.sku}-${code}`);
    return {
      sku: sku.sku,
      name: sku.name || sku.sku,
      barcode: code,
      category: template?.category || parsed.category,
      productName: template?.productName || sku.name || parsed.productName,
      templateName: template?.templateName || "",
      templateFile: template?.templateFile || "",
      hasHanmaTemplate: Boolean(template)
    };
  });

  return {
    templateDir,
    templates,
    items,
    categories: [...new Set([...templates.map((item) => item.category), ...items.map((item) => item.category)].filter(Boolean))].sort()
  };
}

export function renderBarcodeSvg({ value, scale = 2, height = 18, includetext = false, type = "code128" } = {}) {
  const text = String(value || "").trim();
  if (!text) throw new Error("缺少条形码内容。");
  return bwipjs.toSVG({
    bcid: type === "qrcode" ? "qrcode" : "code128",
    text,
    scale: Number(scale) || 2,
    height: Number(height) || 18,
    includetext: Boolean(includetext),
    textxalign: "center",
    backgroundcolor: "FFFFFF"
  });
}

export function getBarcodeTemplate(sku) {
  const db = getDb();
  const item = db
    .prepare(
      `SELECT sku, name, barcode
         FROM skus
        WHERE sku = ? AND status = 'active' AND source IN ('manual', 'inventory')`
    )
    .get(sku);
  if (!item) throw new Error("请选择正式库存商品。");
  const saved = db
    .prepare(
      `SELECT sku, name, label_width_mm AS widthMm, label_height_mm AS heightMm, elements_json AS elementsJson
         FROM barcode_templates
        WHERE sku = ?`
    )
    .get(sku);
  if (saved) {
    return {
      sku,
      name: saved.name || item.name || sku,
      widthMm: Number(saved.widthMm || 40),
      heightMm: Number(saved.heightMm || 60),
      elements: parseElements(saved.elementsJson)
    };
  }
  return createDefaultTemplate(item);
}

export function saveBarcodeTemplate(payload = {}) {
  const sku = String(payload.sku || "").trim();
  if (!sku) throw new Error("缺少 SKU。");
  const name = String(payload.name || "").trim();
  const widthMm = clampNumber(payload.widthMm, 20, 120, 40);
  const heightMm = clampNumber(payload.heightMm, 15, 160, 60);
  const elements = normalizeElements(payload.elements || []);
  getDb()
    .prepare(
      `INSERT INTO barcode_templates (sku, name, label_width_mm, label_height_mm, elements_json, updated_at)
       VALUES (@sku, @name, @widthMm, @heightMm, @elementsJson, CURRENT_TIMESTAMP)
       ON CONFLICT(sku) DO UPDATE SET
         name = excluded.name,
         label_width_mm = excluded.label_width_mm,
         label_height_mm = excluded.label_height_mm,
         elements_json = excluded.elements_json,
         updated_at = CURRENT_TIMESTAMP`
    )
    .run({
      sku,
      name,
      widthMm,
      heightMm,
      elementsJson: JSON.stringify(elements)
    });
  return getBarcodeTemplate(sku);
}

function createDefaultTemplate(item) {
  const barcode = item.barcode || item.sku;
  return {
    sku: item.sku,
    name: item.name || item.sku,
    widthMm: 40,
    heightMm: 60,
    elements: [
      {
        id: "name",
        type: "text",
        text: item.name || item.sku,
        x: 3,
        y: 4,
        w: 34,
        h: 6,
        rotate: 0,
        fontSize: 3,
        fontWeight: 700,
        align: "center"
      },
      {
        id: "barcode",
        type: "barcode",
        text: barcode,
        x: 6,
        y: 13,
        w: 28,
        h: 32,
        rotate: 90
      },
      {
        id: "sku",
        type: "text",
        text: item.sku || barcode,
        x: 4,
        y: 47,
        w: 32,
        h: 6,
        rotate: 0,
        fontSize: 3.2,
        fontWeight: 700,
        align: "center"
      },
      {
        id: "time",
        type: "time",
        text: "{date}",
        x: 5,
        y: 55,
        w: 30,
        h: 4,
        rotate: 0,
        fontSize: 2.2,
        align: "center"
      }
    ]
  };
}

function parseElements(value) {
  try {
    return normalizeElements(JSON.parse(value || "[]"));
  } catch {
    return [];
  }
}

function normalizeElements(elements) {
  return (Array.isArray(elements) ? elements : [])
    .slice(0, 80)
    .map((element, index) => ({
      id: String(element.id || `el_${index}_${Date.now()}`),
      type: ["text", "time", "barcode", "qrcode", "image", "rect", "circle", "line"].includes(element.type) ? element.type : "text",
      text: String(element.text ?? ""),
      src: String(element.src || ""),
      x: clampNumber(element.x, -200, 200, 2),
      y: clampNumber(element.y, -200, 200, 2),
      w: clampNumber(element.w, 1, 200, 20),
      h: clampNumber(element.h, 1, 200, 8),
      rotate: clampNumber(element.rotate, -360, 360, 0),
      fontSize: clampNumber(element.fontSize, 1, 30, 3),
      fontWeight: Number(element.fontWeight || 400),
      align: ["start", "center", "end"].includes(element.align) ? element.align : "start",
      strokeWidth: clampNumber(element.strokeWidth, 0, 10, 0.2),
      fill: String(element.fill || "#ffffff"),
      stroke: String(element.stroke || "#111827")
    }));
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

export async function listBarcodePrinters() {
  try {
    const [{ stdout: printerStdout }, defaultResult] = await Promise.all([
      execFileAsync("lpstat", ["-p"]),
      execFileAsync("lpstat", ["-d"]).catch(() => ({ stdout: "" }))
    ]);
    const printers = printerStdout
      .split(/\r?\n/)
      .map((line) => {
        const match = line.match(/^printer\s+(\S+)/);
        if (!match) return null;
        return {
          id: match[1],
          name: match[1],
          status: line.includes("disabled") ? "disabled" : "ready"
        };
      })
      .filter(Boolean);
    const defaultMatch = String(defaultResult.stdout || "").match(/system default destination:\s*(\S+)/i);
    return {
      printers,
      defaultPrinter: defaultMatch?.[1] || printers[0]?.id || ""
    };
  } catch (error) {
    return {
      printers: [],
      defaultPrinter: "",
      error: "未读取到系统打印机，请确认 macOS 已安装打印机。"
    };
  }
}

function listHanmaTemplates(templateDir) {
  if (!fs.existsSync(templateDir)) return [];
  return fs
    .readdirSync(templateDir)
    .filter((name) => name.toLowerCase().endsWith(".tprts"))
    .sort((a, b) => a.localeCompare(b, "zh-CN"))
    .map((fileName) => {
      const parsed = parseTemplateName(path.basename(fileName, path.extname(fileName)));
      return {
        ...parsed,
        templateName: path.basename(fileName, path.extname(fileName)),
        templateFile: path.join(templateDir, fileName)
      };
    });
}

function parseTemplateName(name) {
  const clean = String(name || "").replace(/_/g, "-").trim();
  const segments = clean.split("-").map((part) => part.trim()).filter(Boolean);
  const category = inferCategory(segments[0] || clean);
  const last = segments[segments.length - 1] || clean;
  const barcode = looksLikeCode(last) ? last : "";
  const productSegments = barcode ? segments.slice(1, -1) : segments.slice(1);
  return {
    category,
    productName: productSegments.join("-") || clean,
    barcode
  };
}

function findTemplateByName(templates, name) {
  const normalizedName = normalizeName(name);
  return (
    templates.find((template) => {
      const product = normalizeName(template.productName || template.templateName);
      return product && (normalizedName.includes(product) || product.includes(normalizedName));
    }) || null
  );
}

function inferCategory(value) {
  const text = String(value || "");
  const categories = ["螺丝包", "钥匙胚", "螺丝刀", "螺丝", "锁芯", "手柄", "门卡"];
  return categories.find((category) => text.includes(category)) || text || "未分类";
}

function looksLikeCode(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (/^[A-Z0-9][A-Z0-9._-]{2,}$/i.test(text) && /[A-Z]/i.test(text) && /\d/.test(text)) return true;
  return /^[A-Z]{2,}[A-Z0-9._-]*$/i.test(text);
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[()\（\）\s._,-]/g, "")
    .trim();
}
