// Coupon candidates. Every candidate is a code that was actually seen written
// on a page, with that page kept as evidence. Nothing here generates codes:
// no brand-name patterns, no "WELCOME10"-style guesses, no variations of a
// found code (owner rule 2026-10-17, replacing the 2026-10-16 guess list).
// Origins, best-supported first:
//   store    - the store's own site (banner, announcement bar, promotions page), read on the device
//   verified - the exact code appears in page text the search retrieved (a fetched page or a cited passage)
//   reported - the model listed it with a page the search returned, but no retrieved text could be checked
// A code the model lists with a page the search never returned is dropped,
// because nothing but the model's memory stands behind it.

export type CandidateOrigin = "store" | "verified" | "reported";

export interface CouponCandidate {
  code: string;
  origin: CandidateOrigin;
  /** The page the code was seen on. */
  sourceUrl: string;
  sourceTitle?: string;
  /** Words from the page around the code: the evidence shown to the user. */
  context?: string;
  /** Eligibility or expiry words seen with it ("first order", "expires 10/31"). */
  conditions?: string;
  /** How many different pages showed this code. */
  sources?: number;
}

/** Names a store goes by, for relevance checks (see merchant.ts). */
export interface MerchantNames {
  domain: string;
  names: string[];
}

export const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{2,24}$/;
const STOPWORDS = new Set([
  "NONE", "N/A", "CODE", "CODES", "COUPON", "SORRY", "NOTE", "THE", "AND", "HINT", "MASKED", "OFFER", "URL", "HTTP", "HTTPS",
  "NULL", "UNKNOWN", "TBD", "SALE", "FREE", "SHIPPING", "OFF", "PERCENT", "APPLIED",
]);
// A code shown partly hidden: "SAVE1***", "WELC•••", "XXXX20", "SAVE…".
const MASK_RE = /[*•●▪■…]|(?:^|[^A-Z])X{3,}|X{3,}(?:[^A-Z]|$)|\.{3}/;

export function normalizeCode(raw: string): string | null {
  const code = raw.trim().replace(/^[-.]+|[-.]+$/g, "").toUpperCase();
  return CODE_RE.test(code) && /[A-Z]/.test(code) && !STOPWORDS.has(code) ? code : null;
}

/** Whether a code as written on a page is masked or cut short, so it must not be completed. */
export function isMasked(raw: string): boolean {
  return MASK_RE.test(raw.trim());
}

const RANK: Record<CandidateOrigin, number> = { store: 0, verified: 1, reported: 2 };
const RESTRICTED =
  /\bfirst[- ](?:time\s+)?(?:order|purchase|customer)|new\s+(?:customer|subscriber|member)s?|welcome|sign[- ]?up|newsletter|subscri(?:be|ption|ber)|app[- ]only|students?|military|veterans?|teachers?|nurses?|first\s+responders?|referr|friends?\s+(?:and|&)\s+family|minimum|orders?\s+(?:over|above)|select(?:ed)?\s+(?:items|styles|products)|bundle|exclusions/i;
const STALE = /\bexpired|no\s+longer|ended|inactive|not\s+working|didn['’]t\s+work|stopped\s+working|dead\b|invalid|out\s+of\s+date|last\s+(?:reported|worked)\s+(?:working\s+)?(?:a|one|\d+)\s+years?/i;
const FREE_SHIPPING = /free\s+(?:ground\s+)?(?:shipping|delivery)/i;

/** Evidence text of a candidate, for relevance and savings hints. */
const evidence = (c: CouponCandidate): string => [c.sourceTitle ?? "", c.context ?? "", c.conditions ?? ""].join(" ");

/** Whether the evidence or the page address names the store. */
export function mentionsMerchant(c: CouponCandidate, m: MerchantNames): boolean {
  const hay = (c.sourceUrl + " " + evidence(c)).toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const url = c.sourceUrl.toLowerCase();
  const label = m.domain.split(".")[0] ?? "";
  if (label.length >= 3 && (url.includes(label) || hay.includes(label))) return true;
  return m.names.some((n) => n.length >= 3 && (hay.includes(n.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()) || url.includes(n.toLowerCase().replace(/[^a-z0-9]+/g, ""))));
}

/**
 * Testing order. Higher is tried first: the store's own codes, then codes read
 * on their pages, then reported ones; a page that names the store, a larger
 * advertised saving, and more pages showing the code help; words that limit
 * who can use it or say it stopped working hurt. Only an order: every code
 * is still tested, and the cart decides.
 */
export function scoreCandidate(c: CouponCandidate, m?: MerchantNames): number {
  let s = (2 - RANK[c.origin]) * 10;
  const text = evidence(c);
  if (m && mentionsMerchant(c, m)) s += 8;
  const pct = /(\d{1,2})\s?%/.exec(text);
  if (pct) s += Math.min(Number(pct[1]), 50) / 5;
  else if (/[$€£]\s?\d+|\d+\s?[$€£]\s+off/i.test(text)) s += 2;
  if (FREE_SHIPPING.test(text)) s += 3;
  if (RESTRICTED.test(text)) s -= 3;
  if (STALE.test(text)) s -= 6;
  if (/\b20(?:1\d|2[0-4])\b/.test(text) && !/\b202[6-9]\b/.test(text)) s -= 2;
  s += Math.min((c.sources ?? 1) - 1, 3);
  return s;
}

/** One entry per code, best origin kept, evidence merged, best-supported first (ties keep the given order). */
export function mergeCandidates(...groups: CouponCandidate[][]): CouponCandidate[] {
  const byCode = new Map<string, CouponCandidate>();
  for (const c of groups.flat()) {
    const code = normalizeCode(c.code);
    if (!code || !c.sourceUrl) continue;
    const prev = byCode.get(code);
    if (!prev) {
      byCode.set(code, { ...c, code, sources: 1 });
      continue;
    }
    const sameUrl = prev.sourceUrl === c.sourceUrl;
    const better = RANK[c.origin] < RANK[prev.origin];
    const merged: CouponCandidate = better ? { ...prev, ...c, code } : { ...prev };
    if (!merged.context && c.context) merged.context = c.context;
    if (!merged.conditions && c.conditions) merged.conditions = c.conditions;
    if (!merged.sourceTitle && c.sourceTitle) merged.sourceTitle = c.sourceTitle;
    merged.sources = (prev.sources ?? 1) + (sameUrl ? 0 : 1);
    byCode.set(code, merged);
  }
  return [...byCode.values()];
}

/** Candidates in testing order (see `scoreCandidate`); stable for equal scores. */
export function rankCandidates(cands: CouponCandidate[], m?: MerchantNames): CouponCandidate[] {
  return cands
    .map((c, i) => ({ c, i, s: scoreCandidate(c, m) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.c);
}

/** Short label for a code's evidence in the results list and summary. */
export function originLabel(c: { origin: CandidateOrigin; sourceUrl?: string }): string {
  const host = c.sourceUrl ? safeHost(c.sourceUrl) : "";
  switch (c.origin) {
    case "store":
      return host ? "the store's own site (" + host + ")" : "the store's own site";
    case "verified":
      return host ? "seen on " + host : "seen on its page";
    case "reported":
      return host ? host + " (reported by the search)" : "reported by the search";
  }
}

export function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
