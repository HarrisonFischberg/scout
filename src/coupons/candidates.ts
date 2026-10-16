// Coupon candidates (T031). Owner decision 2026-10-16: find as many codes as
// possible and test them, including guesses, because the store itself decides
// whether a code works. Every candidate says honestly where it came from:
//   sourced    - a page the web search returned shows the code
//   unverified - the model reported a page, but the search did not return it
//   hint       - a guess built from a site that says a % code exists but hides it
//   pattern    - a guess built from common code patterns for this store name
// Guesses are generated here in plain code, never invented by the model.

export type CandidateOrigin = "sourced" | "unverified" | "hint" | "pattern";

export interface CouponCandidate {
  code: string;
  origin: CandidateOrigin;
  /** Page the code (or the hint) came from, when there is one. */
  sourceUrl?: string;
}

export const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{2,24}$/;
const STOPWORDS = new Set(["NONE", "N/A", "CODE", "CODES", "COUPON", "SORRY", "NOTE", "THE", "AND", "HINT"]);

export function normalizeCode(raw: string): string | null {
  const code = raw.trim().replace(/^[-.]+|[-.]+$/g, "").toUpperCase();
  return CODE_RE.test(code) && /[A-Z]/.test(code) && !STOPWORDS.has(code) ? code : null;
}

const PREFIXES = ["get", "shop", "try", "the", "my", "use", "buy", "go", "join", "drink", "eat", "wear"];
const SUFFIXES = ["shop", "store", "hq", "co", "official", "online", "usa", "us", "brand", "inc"];

/** Brand words from a host: getbeefy.co -> ["BEEFY", "GETBEEFY"]. */
export function brandTokens(host: string): string[] {
  const label = host.toLowerCase().replace(/^www\./, "").split(".")[0] ?? "";
  const clean = label.replace(/[^a-z0-9]/g, "");
  const out = new Set<string>();
  let core = clean;
  for (const p of PREFIXES) if (core.startsWith(p) && core.length - p.length >= 3) core = core.slice(p.length);
  for (const s of SUFFIXES) if (core.endsWith(s) && core.length - s.length >= 3) core = core.slice(0, -s.length);
  if (core.length >= 3) out.add(core.toUpperCase());
  if (clean.length >= 3) out.add(clean.toUpperCase());
  return [...out].filter((t) => t.length <= 18);
}

/**
 * Common code shapes for this store, most likely first. Percentages a coupon
 * site mentions (hints) are tried before the usual ones.
 */
export function patternCodes(host: string, hintPercents: number[] = []): string[] {
  const brands = brandTokens(host);
  const usual = [10, 15, 20, 5, 25, 30];
  const percents = [...new Set([...hintPercents.filter((p) => p > 0 && p < 100), ...usual])];
  const out: string[] = [];
  const add = (c: string): void => {
    const n = normalizeCode(c);
    if (n && !out.includes(n)) out.push(n);
  };
  for (const p of percents) for (const b of brands.slice(0, 1)) add(b + p);
  for (const b of brands) add(b);
  for (const p of percents.slice(0, 4)) {
    add("WELCOME" + p);
    add("SAVE" + p);
  }
  ["WELCOME", "FIRST10", "FIRST15", "TAKE10", "TAKE15", "10OFF", "15OFF", "20OFF", "NEWSLETTER", "THANKYOU", "FREESHIP", "FREESHIPPING", "SUBSCRIBE", "VIP", "SPRING", "SUMMER", "FALL", "HOLIDAY", "BLACKFRIDAY"].forEach(add);
  for (const b of brands.slice(0, 1)) ["FAM", "VIP", "LOVE", "FRIENDS", "20OFF", "10OFF"].forEach((s) => add(b + s));
  return out;
}

/** Sourced first, then unverified, then hint guesses, then pattern guesses; one entry per code. */
export function mergeCandidates(...groups: CouponCandidate[][]): CouponCandidate[] {
  const rank: Record<CandidateOrigin, number> = { sourced: 0, unverified: 1, hint: 2, pattern: 3 };
  const byCode = new Map<string, CouponCandidate>();
  for (const c of groups.flat()) {
    const code = normalizeCode(c.code);
    if (!code) continue;
    const prev = byCode.get(code);
    if (!prev || rank[c.origin] < rank[prev.origin]) byCode.set(code, { ...c, code });
  }
  return [...byCode.values()].sort((a, b) => rank[a.origin] - rank[b.origin]);
}

/** Short label for the results table and summary. */
export function originLabel(c: { origin: CandidateOrigin; sourceUrl?: string }): string {
  const host = c.sourceUrl ? safeHost(c.sourceUrl) : "";
  switch (c.origin) {
    case "sourced":
      return host || "web search";
    case "unverified":
      return host ? host + " (unverified)" : "unverified";
    case "hint":
      return host ? "Guess (hint from " + host + ")" : "Guess (coupon-site hint)";
    case "pattern":
      return "Guess (common pattern)";
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
