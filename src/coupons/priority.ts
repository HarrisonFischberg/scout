// Which waiting code to test next (owner request 2026-10-29, sproos log: 43
// coupon-site codes failed before the store's own FLASH30, and HotDeals gave
// 20 "Enter a valid discount code" in a row). Codes that wait to be tested
// are re-ranked before each try, so a strong code found later still goes
// ahead of weak ones found earlier. Only an order: nothing is skipped, every
// code is still tested if the run keeps going (the pause every 30 codes
// stays, owner 2026-10-29), and guesses still come after every code found
// online (owner 2026-10-19).
//
// What this learns is kept on this device only: per coupon site, how many
// of its codes were tried and how many saved money; per store, the codes it
// refused in the last day. Site names, codes and counts; never page text.
import { scoreCandidate, type CouponCandidate } from "./candidates";
import type { CouponAttempt } from "./finder";
import type { Merchant } from "./merchant";
import { siteOf } from "./reader-hosts";

export const SITE_STATS_KEY = "coupons.sites.v1";
export const REFUSED_KEY = "coupons.refused.v1";
/** A store's refusals count for this long: a cart change can make a code work again. */
export const REFUSED_MS = 24 * 60 * 60 * 1000;
/** A site whose codes failed this many times in a row in this run goes to the back. */
export const SITE_MISSES = 5;
const MAX_SITES = 200;
const MAX_STORES = 100;
const MAX_REFUSED = 150;

export interface SiteStat {
  tried: number;
  worked: number;
  at: number;
}
export type SiteStats = Record<string, SiteStat>;
/** Store domain to code to when the store last refused it. */
export type RefusedCodes = Record<string, Record<string, number>>;

export function parseSiteStats(raw: unknown): SiteStats {
  const out: SiteStats = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [site, v] of Object.entries(raw as Record<string, unknown>)) {
    const s = v as Partial<SiteStat> | null;
    if (s && typeof s.tried === "number" && typeof s.worked === "number" && typeof s.at === "number") out[site] = { tried: s.tried, worked: s.worked, at: s.at };
  }
  return out;
}

export function parseRefused(raw: unknown, now = Date.now()): RefusedCodes {
  const out: RefusedCodes = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [store, codes] of Object.entries(raw as Record<string, unknown>)) {
    if (!codes || typeof codes !== "object" || Array.isArray(codes)) continue;
    const fresh = Object.entries(codes as Record<string, unknown>).filter((e): e is [string, number] => typeof e[1] === "number" && now - e[1] < REFUSED_MS);
    if (fresh.length) out[store] = Object.fromEntries(fresh);
  }
  return out;
}

/** Whether a tested code saved nothing: refused, or no lower total. Unreadable results don't count. */
export const missed = (a: CouponAttempt): boolean => !a.combo && (a.accepted === false || (a.total !== null && (a.saving ?? 0) <= 0));
const saved = (a: CouponAttempt): boolean => !a.combo && a.accepted !== false && (a.saving ?? 0) > 0;

/** Counts tested codes found online by the site they came from. */
export function countSites(stats: SiteStats, attempts: CouponAttempt[], now = Date.now()): SiteStats {
  const next: SiteStats = { ...stats };
  for (const a of attempts) {
    if (a.combo || !a.sourceUrl || a.origin === "guess" || a.origin === "remembered" || a.origin === "store") continue;
    if (!saved(a) && !missed(a)) continue;
    const site = siteOf(a.sourceUrl);
    if (!site) continue;
    const was = next[site] ?? { tried: 0, worked: 0, at: now };
    next[site] = { tried: was.tried + 1, worked: was.worked + (saved(a) ? 1 : 0), at: now };
  }
  const sites = Object.keys(next);
  if (sites.length > MAX_SITES) for (const s of sites.sort((a, b) => next[a]!.at - next[b]!.at).slice(0, sites.length - MAX_SITES)) delete next[s];
  return next;
}

/** The store's refusals after a run: codes that saved nothing are added, codes that saved money are taken off. */
export function noteRefused(all: RefusedCodes, domain: string, attempts: CouponAttempt[], now = Date.now()): RefusedCodes {
  const mine: Record<string, number> = { ...(all[domain] ?? {}) };
  for (const a of attempts) {
    if (a.combo) continue;
    if (saved(a)) delete mine[a.code];
    else if (missed(a)) mine[a.code] = now;
  }
  const kept = Object.entries(mine)
    .filter(([, at]) => now - at < REFUSED_MS)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_REFUSED);
  const out: RefusedCodes = { ...all };
  if (kept.length) out[domain] = Object.fromEntries(kept);
  else delete out[domain];
  const stores = Object.keys(out);
  if (stores.length > MAX_STORES) {
    const latest = (s: string): number => Math.max(...Object.values(out[s]!));
    for (const s of stores.sort((a, b) => latest(a) - latest(b)).slice(0, stores.length - MAX_STORES)) delete out[s];
  }
  return out;
}

// Words promo codes are built from; a code made of anything else plus a
// number ("NANCYCHU10", "KATIE20") is most likely a creator's own code.
const PROMO_WORDS =
  /^(?:SAVE|SAVEBIG|WELCOME|NEW|NEWBIE|HELLO|HI|HOLIDAY|HOLIDAYS|XMAS|SPRING|SUMMER|FALL|AUTUMN|WINTER|BLACKFRIDAY|BF|CYBER|CYBERMONDAY|CM|FLASH|VIP|FRIEND|FRIENDS|TAKE|GET|EXTRA|OFF|FIRST|SHIP|FREESHIP|FREE|BDAY|BIRTHDAY|THANKS|THANKYOU|CART|SALE|DEAL|DEALS|PROMO|CODE|EMAIL|SMS|TEXT|APP|STUDENT|MILITARY|TEACHER|NURSE|HERO|HEROES|SPECIAL|SHOP|BUY|LOVE|SEASON|LABOR|LABORDAY|MEMORIAL|JULY|MOM|MOMS|DAD|DADS|EASTER|HALLOWEEN|SPOOKY|THANKSGIVING|NEWYEAR|NY|OCT|NOV|DEC|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|GIFT|BUNDLE|SUB|SUBSCRIBE|REFER|REFERRAL|LAUNCH|ANNIVERSARY|TEN|TWENTY|FIFTEEN|FIVE|ONE|DISCOUNT|PAYDAY|WEEKEND|TODAY|NOW|MORE|BONUS|EXCLUSIVE|COUPON)$/;

/** Name tokens of a store in capitals, 4+ letters ("SPROOS"), for codes built on the brand. */
function brandWords(m: Pick<Merchant, "names" | "domain">): string[] {
  const out = new Set<string>();
  for (const n of [...m.names, m.domain.split(".")[0] ?? ""]) {
    const t = n.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (t.length >= 4 && t.length <= 20) out.add(t);
  }
  return [...out];
}

/** A creator's own code: a name plus a number, with no promo word and no brand in it. */
export function looksLikeCreatorCode(code: string, brands: string[]): boolean {
  const m = /^([A-Z]{3,16})(\d{1,3})$/.exec(code);
  if (!m) return false;
  const word = m[1]!;
  if (PROMO_WORDS.test(word) || brands.some((b) => code.includes(b))) return false;
  // Promo word plus more letters ("SAVENOW10", "GETFIT15") is still a promotion.
  return !/^(?:SAVE|WELCOME|NEW|HELLO|HOLIDAY|FLASH|EXTRA|TAKE|GET|FREE|FIRST|VIP|SPRING|SUMMER|FALL|WINTER|CYBER|BLACK|SHOP|BUY|SALE|DEAL|PROMO|FRIEND|GIFT)/.test(word);
}

export interface RankContext {
  merchant: Pick<Merchant, "names" | "domain">;
  /** What this device learned about coupon sites. */
  sites?: SiteStats;
  /** Codes this store refused in the last day (code to time). */
  refused?: Record<string, number>;
}

/**
 * Score of a waiting code: the evidence score (`scoreCandidate`), plus the
 * store's name in the code, minus creator-style codes, plus what this device
 * learned about the site it came from.
 */
export function priorityScore(c: CouponCandidate, ctx: RankContext, brands = brandWords(ctx.merchant)): number {
  let s = scoreCandidate(c, ctx.merchant);
  if (brands.some((b) => c.code.includes(b))) s += 6;
  if (c.origin !== "store" && c.origin !== "remembered" && looksLikeCreatorCode(c.code, brands)) s -= 6;
  const site = c.sourceUrl && c.origin !== "store" ? siteOf(c.sourceUrl) : "";
  const stat = site ? ctx.sites?.[site] : undefined;
  if (stat && stat.tried >= 8) {
    const rate = stat.worked / stat.tried;
    if (stat.worked === 0) s -= Math.min(8, 3 + stat.tried / 10);
    else if (rate >= 0.05) s += Math.min(6, rate * 40);
  }
  return s;
}

/** Sites whose last SITE_MISSES codes in this run all saved nothing, with none of theirs saving money. */
export function coldSites(attempts: CouponAttempt[]): Set<string> {
  const streak = new Map<string, number>();
  const won = new Set<string>();
  for (const a of attempts) {
    const site = a.sourceUrl && a.origin !== "store" && a.origin !== "remembered" ? siteOf(a.sourceUrl) : "";
    if (!site) continue;
    if (saved(a)) won.add(site);
    streak.set(site, missed(a) ? (streak.get(site) ?? 0) + 1 : 0);
  }
  return new Set([...streak].filter(([s, n]) => n >= SITE_MISSES && !won.has(s)).map(([s]) => s));
}

/**
 * Waiting codes in testing order. Four groups, each by score: codes found
 * online; codes found online from a site that just failed SITE_MISSES times in
 * a row, or that this store refused in the last day; guesses (in their own
 * order); refused guesses.
 */
export function rankPending(pending: CouponCandidate[], attempts: CouponAttempt[], ctx: RankContext): CouponCandidate[] {
  const brands = brandWords(ctx.merchant);
  const cold = coldSites(attempts);
  const group = (c: CouponCandidate): number => {
    const back = !!ctx.refused?.[c.code] || (!!c.sourceUrl && c.origin !== "store" && c.origin !== "remembered" && cold.has(siteOf(c.sourceUrl)));
    return (c.origin === "guess" ? 2 : 0) + (back ? 1 : 0);
  };
  return pending
    // Past winners lead, best first (memory.ts), and guesses keep the order guesses.ts gives them (hinted percentages first).
    .map((c, i) => ({ c, i, g: group(c), s: c.origin === "remembered" ? 1e9 : c.origin === "guess" ? 0 : priorityScore(c, ctx, brands) }))
    .sort((a, b) => a.g - b.g || b.s - a.s || a.i - b.i)
    .map((x) => x.c);
}
