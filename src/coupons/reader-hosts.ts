// Which coupon sites refuse the provider's page reader, learned on this
// device (owner request 2026-10-17: Find coupons should work on any store).
// Each page fetch the reader refused or loaded is counted by site; a site
// that keeps refusing goes straight to a background tab on later runs
// (src/coupons/codes.ts `firstHosts`). Only site names and counts are kept.

export const READER_HOSTS_KEY = "couponReaderHosts";
const MAX_SITES = 200;

export interface SiteCount {
  refused: number;
  ok: number;
  /** Last time this site was counted (ms). */
  at: number;
}
export type ReaderHosts = Record<string, SiteCount>;

/** The site a page belongs to: "brand.tenereteam.com" and "tenereteam.com" are one site. */
export function siteOf(url: string): string {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
  if (!host || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return "";
  const parts = host.split(".");
  // "example.co.uk", "example.com.au": three labels.
  const n = parts.length >= 3 && parts[parts.length - 1]!.length === 2 && parts[parts.length - 2]!.length <= 3 ? 3 : 2;
  return parts.slice(-n).join(".");
}

export function parseReaderHosts(raw: unknown): ReaderHosts {
  const out: ReaderHosts = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [site, v] of Object.entries(raw as Record<string, unknown>)) {
    const c = v as Partial<SiteCount> | null;
    if (!c || typeof c.refused !== "number" || typeof c.ok !== "number" || typeof c.at !== "number") continue;
    out[site] = { refused: c.refused, ok: c.ok, at: c.at };
  }
  return out;
}

/** Counts one fetch; keeps the most recently seen sites. */
export function countFetch(hosts: ReaderHosts, url: string, ok: boolean, now: number): ReaderHosts {
  const site = siteOf(url);
  if (!site) return hosts;
  const was = hosts[site] ?? { refused: 0, ok: 0, at: now };
  const next: ReaderHosts = { ...hosts, [site]: { refused: was.refused + (ok ? 0 : 1), ok: was.ok + (ok ? 1 : 0), at: now } };
  const sites = Object.keys(next);
  if (sites.length <= MAX_SITES) return next;
  for (const s of sites.sort((a, b) => next[a]!.at - next[b]!.at).slice(0, sites.length - MAX_SITES)) delete next[s];
  return next;
}

/** Sites that refused the reader at least twice and more often than they loaded. */
export function browserFirstSites(hosts: ReaderHosts): string[] {
  return Object.entries(hosts)
    .filter(([, c]) => c.refused >= 2 && c.refused > c.ok)
    .map(([site]) => site);
}
