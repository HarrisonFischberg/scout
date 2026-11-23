// Order totals as stores print them, in any common currency and format:
// "$1,234.50", "USD $170.00", "1.234,56 €", "£99", "¥12,800", "CHF 99.00",
// "499,00 kr". Used by the coupon finder's page path, so savings can be
// measured on any checkout, not only ones in US dollars.

const SYMBOLS = "$€£¥₹₩₽₺₪₫₱฿₦₴₲₡₸";
// Letter currencies printed next to the amount.
const WORDS = "kr|zł|Kč|Ft|lei|RM|Rp|R\\$|CHF|Fr\\.";
const CUR = "(?:[A-Z]{0,3}[" + SYMBOLS + "]|" + WORDS + "|[A-Z]{3}(?![a-z]))";
const NUM = "\\d{1,3}(?:[.,\\u00a0'’ ]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?";
/** An amount with its currency before or after it. Groups: 1 currency, 2 amount, or 3 amount, 4 currency. */
const MONEY = "(" + CUR + ")\\s?(" + NUM + ")|(" + NUM + ")\\s?(" + CUR + ")";

// Words that label the amount to pay. "Subtotal" and "Zwischensumme" are not
// totals: the label must not follow a letter.
const LABEL =
  "(?:total|amount\\s+due|balance\\s+due|you\\s+pay|to\\s+pay|gesamt(?:summe|betrag)?|summe|totale|totaal|razem|suma)";
// "Total savings", "Total discount", "Total items" are not the amount to pay.
const NOT_TOTAL = "(?!\\s*(?:savings?|saved|discounts?|off|items?|quantity|qty)\\b)";
const GAP = "[^\\d" + SYMBOLS + "]{0,30}?(?:\\d+\\s+items?\\b[^\\d" + SYMBOLS + "]{0,12}?)?";

const TOTAL_RE = new RegExp("(?:^|[^\\p{L}])" + LABEL + "\\b" + NOT_TOTAL + GAP + "(?:" + MONEY + ")", "giu");
// A cart drawer with no labelled total often prints it on its button:
// "Checkout - $10", "CHECKOUT+ · $25.69", "Pay now $12.00". Lowest priority,
// because such a button amount can include extras (order protection) that a
// labelled Subtotal leaves out.
const BUTTON_RE = new RegExp("\\b(?:check\\s*out|pay(?:\\s+now)?|place\\s+order)\\b[^\\p{L}\\d" + SYMBOLS + "]{0,12}(?:" + MONEY + ")", "giu");
// A lone Subtotal is still never a total: a code shown as a separate discount
// line would read as "no saving", which would wrongly condemn working codes.

export interface Money {
  amount: number;
  /** As printed: "$", "€", "USD", "CA$", "kr". */
  currency: string;
}

/** "1.234,56" → 1234.56, "1,234.50" → 1234.5, "12,800" → 12800. */
export function parseAmount(raw: string): number | null {
  const s = raw.replace(/[\s '’]/g, "");
  const last = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
  let n: number;
  if (last === -1) n = Number(s);
  else {
    const whole = s.slice(0, last).replace(/[.,]/g, "");
    const tail = s.slice(last + 1);
    // Three digits after the only separator is a thousands group, not cents.
    n = tail.length === 3 ? Number(whole + tail) : Number(whole + "." + tail);
  }
  return Number.isFinite(n) ? n : null;
}

function fromMatch(m: RegExpMatchArray, first: number): Money | null {
  const currency = (m[first] ?? m[first + 3] ?? "").trim();
  const amount = parseAmount(m[first + 1] ?? m[first + 2] ?? "");
  return amount === null ? null : { amount, currency };
}

/**
 * The last order total on the page. With `label` (words a store uses for its
 * total, e.g. from the model when the usual words are missing), the amount
 * after the last occurrence of that label.
 */
export function readTotal(text: string, label?: string): Money | null {
  let last: Money | null = null;
  for (const m of text.matchAll(TOTAL_RE)) last = fromMatch(m, 1) ?? last;
  if (last) return last;
  if (label?.trim()) {
    const escaped = label.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    const re = new RegExp(escaped + GAP + "(?:" + MONEY + ")", "giu");
    for (const m of text.matchAll(re)) last = fromMatch(m, 1) ?? last;
    if (last) return last;
  }
  for (const m of text.matchAll(BUTTON_RE)) last = fromMatch(m, 1) ?? last;
  return last;
}

/** "$80.00", "€80.00", "USD 80.00" for a currency as printed on the page or an ISO code. */
export function formatMoney(n: number, currency?: string | null): string {
  const cur = (currency ?? "$").trim() || "$";
  if (/^[A-Z]{3}$/.test(cur)) {
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency: cur }).format(n);
    } catch {
      return cur + " " + n.toFixed(2);
    }
  }
  return cur + n.toFixed(2);
}

const MINUS = "[-\\u2212\\u2013\\u2014]";
// A negative amount with a real currency sign: "−$34.79", "- CA$5.00", "$-12.50", "-10,00 €".
// Never a bare three-letter word as the currency: "XMAS-25" and "- VIP20" are codes, not money.
const SIGN = "(?:[A-Z]{0,3}[" + SYMBOLS + "])";
const NEGATIVE_RE = new RegExp(MINUS + "\\s?" + SIGN + "\\s?(" + NUM + ")|" + SIGN + "\\s?" + MINUS + "\\s?(" + NUM + ")|" + MINUS + "\\s?(" + NUM + ")\\s?(?:[" + SYMBOLS + "]|" + WORDS + ")(?![\\p{L}\\d])", "u");

// Accountants' brackets, only on the line that names the code: "Discount (SAVE10) (€10,00)".
const BRACKET_RE = new RegExp("\\(\\s?" + SIGN + "\\s?(" + NUM + ")\\s?\\)|\\(\\s?(" + NUM + ")\\s?[" + SYMBOLS + "]\\s?\\)", "u");

/**
 * What the store's own discount line says a code takes off ("WELCOME20  − $34.79",
 * or the amount alone on the line under the code), or null. Only a line that
 * names `code` counts, and only an amount on that line or standing alone right
 * under it: a gift card, a sale price or a shipping fee nearby is never read
 * as the code's. With several (a cart that prints each item's share and the
 * sum), the largest. Lines for which `skip` is true (the store's "code not
 * valid" words) never count.
 */
export function readDiscount(text: string, code: string, skip?: (line: string) => boolean): number | null {
  const lines = text.split("\n").map((l) => l.trim());
  const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const names = new RegExp("(^|[^A-Z0-9])" + escaped + "([^A-Z0-9]|$)", "gi");
  const negative = (line: string): { amount: number; alone: boolean } | null => {
    const m = NEGATIVE_RE.exec(line);
    if (!m) return null;
    const amount = parseAmount(m[1] ?? m[2] ?? m[3] ?? "");
    if (amount === null || amount <= 0) return null;
    return { amount, alone: !/[\p{L}\d]/u.test(line.replace(m[0], "")) };
  };
  let best: number | null = null;
  lines.forEach((line, i) => {
    if (!line || skip?.(line) || !line.match(names)) return;
    // The code itself must not be what reads as the amount ("SAVE-20").
    const own = line.replace(names, "$1 $2");
    const bracket = BRACKET_RE.exec(own);
    let found = negative(own)?.amount ?? (bracket ? parseAmount(bracket[1] ?? bracket[2] ?? "") : null);
    if (found === null) {
      const next = lines.slice(i + 1).find((l) => l !== "");
      const under = next ? negative(next) : null;
      if (under?.alone) found = under.amount;
    }
    if (found !== null && (best === null || found > best)) best = found;
  });
  return best;
}
