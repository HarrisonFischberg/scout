// Codes a store advertises on its own site ("Use code TACO10 for 10% off" in
// an announcement bar or banner). Read on the device from the page the user
// is on and the store's home page; nothing is sent anywhere, and no model is
// involved, so this works even when the web search fails. Each code keeps
// the words around it as evidence.
import { normalizeCode } from "./candidates";

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

const QUOTE = "[\"“”'‘’]?";
const TOKEN = "([A-Za-z0-9][A-Za-z0-9_-]{2,24})";
const PATTERNS = [
  // "promo code: SAVE15", "use code TACO10", "code CYBERTACK", "with code FALL20"
  new RegExp("\\bcodes?\\s*(?:is|:|=|-|–|—)?\\s*" + QUOTE + TOKEN, "gi"),
  // "enter SAVE15 at checkout", "use WELCOME10 for 10% off", "apply FALL20 to get"
  new RegExp("\\b(?:use|enter|apply|redeem)\\s+" + QUOTE + TOKEN + QUOTE + "\\s+(?:at\\s+check-?out|for|to\\s+(?:get|save|receive))", "gi"),
  // "Coupon: SAVE15", "Promo - FALL20", "Discount = BF2026" (a separator is required, so "coupon below" is not read)
  new RegExp("\\b(?:coupon|promo|discount|voucher)\\s*(?::|=|-|–|—)\\s*" + QUOTE + TOKEN, "gi"),
];

// Looser (owner report 2026-11-02, bunkerkc.com showed KCMO15 and Scout found
// nothing): a code-like word printed in capitals with a digit (KCMO15,
// BF2026, 15OFF), anywhere near offer words such as "15% off", "save",
// "coupon" or "promo", without "use code" in front. Tested after the strict
// ones; product numbers ("SKU AB1234"), sizes and units are left out.
const LOOSE_TOKEN = /(?<![A-Za-z0-9_-])[A-Z0-9][A-Z0-9-]{3,19}(?![A-Za-z0-9_-])/g;
const LOOSE_NEAR = 60;
const OFFER_WORDS = /\bcodes?\b|coupon|promo|discount|voucher|\d{1,2}\s?%\s*off|[$€£]\s?\d+\s*off|\bsave\b|\bextra\b.{0,12}\boff\b|\boff\s+(?:sitewide|everything|your|all)/i;
const PRODUCT_PREFIX = /\b(?:sku|model|item|part|style|upc|mpn|ean|isbn|gtin|serial)\s*(?:#|no\.?|number)?\s*[:#.]?\s*$|#\s*$/i;
const UNIT = /^\d+(?:AM|PM|ST|ND|RD|TH|OZ|MM|CM|IN|FT|LB|LBS|GB|TB|MB|ML|KG|HZ|MP|PC|PCS|PK|XL|XXL|XS|MAH|MPH|HP|CC|W|V)$|^[A-Z]{1,2}\d{1,2}$|^(?:USB|HDMI|MP3|MP4|COVID19|H2O|CO2|4K|8K|5G|4G|3D|2D)\w*$/;

/** Code-like words near offer words, with their position and the words around them. */
function looseHits(text: string): Array<{ at: number; code: string; context: string }> {
  const out: Array<{ at: number; code: string; context: string }> = [];
  for (const m of text.matchAll(LOOSE_TOKEN)) {
    const raw = m[0];
    const at = m.index ?? 0;
    if (!/\d/.test(raw) || !/[A-Z].*[A-Z]/.test(raw) || UNIT.test(raw)) continue;
    // A dash-joined part number ("AB-12-CD") or a date-like word is not a code.
    if ((raw.match(/-/g) ?? []).length > 1) continue;
    if (PRODUCT_PREFIX.test(text.slice(Math.max(0, at - 16), at))) continue;
    const near = text.slice(Math.max(0, at - LOOSE_NEAR), at + raw.length + LOOSE_NEAR);
    if (!OFFER_WORDS.test(near)) continue;
    const code = normalizeCode(raw);
    if (!code || NOT_CODES.has(code)) continue;
    out.push({ at, code, context: text.slice(Math.max(0, at - CONTEXT_CHARS), at + raw.length + CONTEXT_CHARS).replace(/\s+/g, " ").trim() });
  }
  return out;
}

// Words that follow "code" on store pages but are not codes.
const NOT_CODES = new Set([
  "APPLY", "APPLIED", "ENTER", "ENTERED", "USE", "REDEEM", "CHECKOUT", "CODE", "CODES", "COUPON", "COUPONS", "PROMO", "DISCOUNT",
  "DISCOUNTS", "VOUCHER", "GIFT", "CARD", "REQUIRED", "OPTIONAL", "INVALID", "VALID", "EXPIRED", "BELOW", "ABOVE", "HERE", "NOW",
  "TODAY", "FOR", "AND", "THE", "YOUR", "OFF", "USD", "CAD", "EUR", "GBP", "AUD", "NONE", "SORRY", "NOTE", "HINT", "WILL", "WAS",
  "NOT", "CAN", "CANNOT", "MUST", "ONLY", "ONCE", "PER", "WITH", "FROM", "THIS", "THAT", "ANY", "ALL", "EACH", "FIELD", "BOX",
]);

export const MAX_STORE_CODES = 10;
const CONTEXT_CHARS = 90;

export interface StoreCode {
  code: string;
  /** The sentence around the code, whitespace collapsed. */
  context: string;
}

/**
 * Codes advertised in `text`, in page order, with the words around each.
 * Strict matches first: a code right after a phrase such as "use code" or
 * "promo code:", written in capitals or with a digit. Then looser ones: a
 * capitalised word with a digit near offer words ("15% OFF · KCMO15").
 */
export function codesWithContext(text: string, max = MAX_STORE_CODES): StoreCode[] {
  const hits: Array<{ at: number; code: string; context: string }> = [];
  for (const re of PATTERNS) {
    for (const m of text.matchAll(re)) {
      const raw = m[1] ?? "";
      // Written in capitals, or with a digit ("use code kcmo15"), so "code below" is not a code.
      if (raw !== raw.toUpperCase() && !/\d/.test(raw)) continue;
      const code = normalizeCode(raw);
      if (!code || NOT_CODES.has(code)) continue;
      const at = m.index ?? 0;
      const context = text.slice(Math.max(0, at - CONTEXT_CHARS), at + m[0].length + CONTEXT_CHARS).replace(/\s+/g, " ").trim();
      hits.push({ at, code, context });
    }
  }
  // Strict matches in page order first, then the looser ones.
  const ordered = [...hits.sort((a, b) => a.at - b.at), ...looseHits(text)];
  const out: StoreCode[] = [];
  for (const h of ordered) {
    if (!out.some((o) => o.code === h.code)) out.push({ code: h.code, context: h.context });
    if (out.length >= max) break;
  }
  return out;
}

/** Just the codes, in page order. */
export function codesInText(text: string, max = MAX_STORE_CODES): string[] {
  return codesWithContext(text, max).map((c) => c.code);
}

const MAX_HTML = 2_000_000;

/** Visible text of an HTML page, without scripts and styles. Returns "" when it cannot be parsed. */
export function htmlText(html: string): string {
  if (typeof DOMParser === "undefined") return "";
  const doc = new DOMParser().parseFromString(html.slice(0, MAX_HTML), "text/html");
  for (const el of doc.querySelectorAll("script, style, noscript, template, svg")) el.remove();
  return (doc.body?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Text of the store's home page, fetched from the content script on the
 * store's own origin with the user's session (like opening the page), or
 * null when it does not load in `timeoutMs`.
 */
export async function storeHomeText(f: FetchFn = fetch, timeoutMs = 5000): Promise<string | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await f("/", { credentials: "same-origin", headers: { accept: "text/html" }, signal: ac.signal });
    if (!r.ok) return null;
    return htmlText(await r.text()).slice(0, 200_000);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
