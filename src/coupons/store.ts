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
];

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
 * Strict on purpose: the code must be written in capitals (digits allowed)
 * right after a phrase such as "use code" or "promo code:", so ordinary
 * words are not picked up.
 */
export function codesWithContext(text: string, max = MAX_STORE_CODES): StoreCode[] {
  const hits: Array<{ at: number; code: string; context: string }> = [];
  for (const re of PATTERNS) {
    for (const m of text.matchAll(re)) {
      const raw = m[1] ?? "";
      if (raw !== raw.toUpperCase()) continue;
      const code = normalizeCode(raw);
      if (!code || NOT_CODES.has(code)) continue;
      const at = m.index ?? 0;
      const context = text.slice(Math.max(0, at - CONTEXT_CHARS), at + m[0].length + CONTEXT_CHARS).replace(/\s+/g, " ").trim();
      hits.push({ at, code, context });
    }
  }
  const out: StoreCode[] = [];
  for (const h of hits.sort((a, b) => a.at - b.at)) {
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
