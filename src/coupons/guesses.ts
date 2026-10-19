// Guessed codes, tested only after every code found online (owner decision
// 2026-10-19, "All guesses", reversing the 2026-10-17 no-guess rule). From
// the owner's logs of another tool on getbeefy.co: both winning codes were
// guesses. BEEFY15 came from SimplyCodes saying a 15% code exists while
// hiding it; GETBEEFY is the store's domain name. None of the common guesses
// (WELCOME10, SAVE15, ...) worked in those logs, so smart guesses go first.
// Every guess is labeled as one; the cart decides.
import { normalizeCode, type CouponCandidate } from "./candidates";
import type { Merchant } from "./merchant";

/** Most guesses one run tests: smart ones first, then common ones. */
export const MAX_GUESSES = 40;
const MAX_SMART = 20;

// Words in a domain or brand that are not the brand itself ("getbeefy", "drinkolipop", "eatbirdcall").
const PREFIXES = ["get", "shop", "try", "drink", "eat", "buy", "the", "my", "go", "hey", "meet", "wear", "use", "join"];
const SUFFIXES = ["shop", "store", "hq", "co", "usa", "official", "brand", "brands", "online"];
const PERCENTS = [10, 15, 20];

/** Short names a store's codes are often built from: GETBEEFY -> GETBEEFY, BEEFY. */
export function brandTokens(m: Pick<Merchant, "domain" | "brand">): string[] {
  const out: string[] = [];
  const add = (raw: string): void => {
    const t = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (t.length >= 3 && t.length <= 14 && /[A-Z]/.test(t) && !out.includes(t)) out.push(t);
  };
  const label = (m.domain.split(".")[0] ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const brand = m.brand.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9 ]/g, "").trim();
  const words = brand.split(/\s+/).filter((w) => w.length >= 3 && w !== "the" && w !== "and" && w !== "store");
  add(brand.replace(/\s+/g, ""));
  for (const p of PREFIXES) if (label.startsWith(p) && label.length - p.length >= 3) add(label.slice(p.length));
  for (const s of SUFFIXES) if (label.endsWith(s) && label.length - s.length >= 3) add(label.slice(0, -s.length));
  add(label);
  if (words.length > 1) add(words[0] ?? "");
  return out.slice(0, 3);
}

/** Percentages that pages hint at for this store ("15% off" next to a hidden code, "Beefy Promo Codes - 15% Off"). */
export function hintedPercents(texts: string[]): number[] {
  const seen = new Map<number, number>();
  for (const t of texts) {
    for (const m of t.matchAll(/(\d{1,2})\s?%\s*off/gi)) {
      const n = Number(m[1]);
      if (n >= 5 && n <= 60) seen.set(n, (seen.get(n) ?? 0) + 1);
    }
  }
  return [...seen].sort((a, b) => b[1] - a[1] || b[0] - a[0]).map(([n]) => n);
}

const MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
const SEASON = (month: number): string => (month <= 1 || month === 11 ? "WINTER" : month <= 4 ? "SPRING" : month <= 7 ? "SUMMER" : "FALL");
// Holiday words stores use in the weeks around each month.
const HOLIDAYS: Record<number, string[]> = {
  0: ["NEWYEAR"], 1: ["VALENTINE", "LOVE"], 2: ["SPRING"], 3: ["EASTER"], 4: ["MOM", "MEMORIAL"], 5: ["DAD", "SUMMER"],
  6: ["JULY4", "SUMMER"], 7: ["BACKTOSCHOOL", "BTS"], 8: ["LABORDAY"], 9: ["HALLOWEEN", "SPOOKY"], 10: ["BLACKFRIDAY", "BFCM", "CYBER"], 11: ["HOLIDAY", "GIFT"],
};
const COMMON = [
  "WELCOME10", "WELCOME15", "WELCOME", "SAVE10", "SAVE15", "SAVE20", "FIRST10", "FIRST15", "NEW10", "HELLO10", "TAKE10",
  "EMAIL10", "SMS10", "TEXT10", "VIP", "THANKYOU", "FREESHIP", "FREESHIPPING", "SUBSCRIBE", "FRIENDS", "WELCOME20", "SAVE25",
];

export interface GuessInput {
  merchant: Pick<Merchant, "domain" | "brand">;
  /** Percentages pages hinted at for this store, most-seen first (see `hintedPercents`). */
  percents?: number[];
  /** Codes already known (found, remembered or tried): never guessed again. */
  known?: Iterable<string>;
  now?: Date;
}

/** Guessed codes in testing order: store-name codes shaped by hinted percentages, then common and seasonal ones. */
export function guessCodes(input: GuessInput): CouponCandidate[] {
  // An IP address or localhost (local fixtures) names no store, as in likelyCodePages.
  if (/^(?:\d{1,3}\.){3}\d{1,3}$|^localhost$/.test(input.merchant.domain)) return [];
  const known = new Set([...(input.known ?? [])].map((c) => c.toUpperCase()));
  const out: CouponCandidate[] = [];
  const add = (raw: string, why: string): void => {
    const code = normalizeCode(raw);
    if (!code || known.has(code) || out.some((c) => c.code === code)) return;
    out.push({ code, origin: "guess", sourceUrl: "", context: why });
  };
  const tokens = brandTokens(input.merchant);
  const hinted = (input.percents ?? []).slice(0, 2);
  const percents = [...new Set([...hinted, ...PERCENTS])];
  // 1. Smart: the store's name with the percentages pages hint at, then on its own.
  for (const p of hinted) for (const t of tokens) add(t + p, "a guess: the store's name with the " + p + "% that coupon sites mention");
  for (const t of tokens) add(t, "a guess: the store's name");
  for (const p of percents) for (const t of tokens) add(t + p, "a guess: the store's name with " + p + "%");
  for (const t of tokens.slice(0, 1)) {
    add("WELCOME" + t, "a guess: welcome code with the store's name");
    add(t + "FAM", "a guess: the store's name");
    add(t + "VIP", "a guess: the store's name");
  }
  out.splice(MAX_SMART);
  // 2. Common and seasonal codes.
  const now = input.now ?? new Date();
  const month = now.getMonth();
  const season = SEASON(month);
  for (const p of hinted) add("SAVE" + p, "a guess: a common code with the " + p + "% that coupon sites mention");
  for (const c of COMMON.slice(0, 10)) add(c, "a guess: a common code");
  add(MONTHS[month] ?? "", "a guess: this month");
  add(season, "a guess: this season");
  add(season + "15", "a guess: this season");
  add(season + "20", "a guess: this season");
  for (const h of HOLIDAYS[month] ?? []) add(h, "a guess: a holiday this time of year");
  for (const c of COMMON.slice(10)) add(c, "a guess: a common code");
  return out.slice(0, MAX_GUESSES);
}
