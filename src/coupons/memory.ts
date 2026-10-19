// Codes that worked on a store before, kept on this device only and tried
// first next time (owner request 2026-10-19: the other tool's Beefy runs
// reused BEEFY15 and GETBEEFY from earlier sessions). Stored in the
// extension's local storage; never sent anywhere. A code the store later
// turns down stays listed until it has failed twice, since a code can be
// refused for one cart and accepted for another.
import type { CouponCandidate } from "./candidates";

export const WORKED_KEY = "coupons.worked.v1";
const MAX_STORES = 200;
const MAX_PER_STORE = 8;
const MAX_FAILS = 2;

export interface WorkedCode {
  code: string;
  /** Percent off the last time it worked. */
  pct: number;
  /** When it last worked (ms since epoch). */
  at: number;
  /** Times the store turned it down since it last worked. */
  fails?: number;
}
export type WorkedCodes = Record<string, WorkedCode[]>;

/** Reads the stored value defensively: anything malformed is dropped. */
export function parseWorked(raw: unknown): WorkedCodes {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: WorkedCodes = {};
  for (const [domain, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    const good = list.filter(
      (w): w is WorkedCode =>
        !!w && typeof w === "object" && typeof (w as WorkedCode).code === "string" && typeof (w as WorkedCode).pct === "number" && typeof (w as WorkedCode).at === "number",
    );
    if (good.length) out[domain] = good.slice(0, MAX_PER_STORE);
  }
  return out;
}

/** This store's remembered codes, best first, as candidates to test before anything else. */
export function rememberedCodes(all: WorkedCodes, domain: string): CouponCandidate[] {
  return [...(all[domain] ?? [])]
    .sort((a, b) => b.pct - a.pct || b.at - a.at)
    .map((w) => ({ code: w.code.toUpperCase(), origin: "remembered" as const, sourceUrl: "", context: "worked on this store before (" + Math.round(w.pct) + "% off)" }));
}

/**
 * The stored codes after a run: codes that lowered the total are added or
 * refreshed, remembered codes the store turned down count a failure and are
 * forgotten after two. Least recently used stores drop out past the limit.
 */
export function updateWorked(all: WorkedCodes, domain: string, results: { worked: Array<{ code: string; pct: number }>; refused: string[] }, now = Date.now()): WorkedCodes {
  const list = [...(all[domain] ?? [])].map((w) => ({ ...w }));
  for (const r of results.worked) {
    const code = r.code.toUpperCase();
    const prev = list.find((w) => w.code.toUpperCase() === code);
    if (prev) {
      prev.pct = r.pct;
      prev.at = now;
      delete prev.fails;
    } else list.push({ code, pct: r.pct, at: now });
  }
  for (const code of results.refused.map((c) => c.toUpperCase())) {
    const prev = list.find((w) => w.code.toUpperCase() === code);
    if (prev && !results.worked.some((r) => r.code.toUpperCase() === code)) prev.fails = (prev.fails ?? 0) + 1;
  }
  const kept = list.filter((w) => (w.fails ?? 0) < MAX_FAILS).sort((a, b) => b.at - a.at).slice(0, MAX_PER_STORE);
  const out: WorkedCodes = { ...all };
  if (kept.length) out[domain] = kept;
  else delete out[domain];
  const stores = Object.entries(out);
  if (stores.length > MAX_STORES) {
    const latest = (l: WorkedCode[]): number => Math.max(...l.map((w) => w.at));
    return Object.fromEntries(stores.sort((a, b) => latest(b[1]) - latest(a[1])).slice(0, MAX_STORES));
  }
  return out;
}
