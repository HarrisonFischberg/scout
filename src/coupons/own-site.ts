// The store's own site, read before any coupon site (owner request
// 2026-10-29, sproos log: the winning FLASH30 was on sproos.co/pages/about
// but was tested 44th, after 43 coupon-site codes that all failed). Its home
// page and its own promotion-looking pages (/pages/*, about, offers, FAQ,
// rewards) are downloaded quietly from the worker (src/coupons/quiet-read.ts:
// no tab, no cookies), and the codes they advertise are tested first. On a
// hosted checkout (shop.app) this is the only way to reach the store's site,
// since the tab is on the checkout's host.
import type { PageBrowser } from "./browser-read";
import { codesWithContext, MAX_STORE_CODES, type StoreCode } from "./store";
import type { Snapshot } from "../snapshot/snapshot";

/** Pages read besides the home page. */
export const OWN_SITE_PAGES = 6;
/** The whole read, so testing is never held up for long. */
export const OWN_SITE_MS = 12_000;

// Paths where stores print codes: Shopify's /pages/*, and promotion words anywhere in the path.
const PROMO_PATH =
  /\/pages\/|about|offer|promo|deal|discount|coupon|sale|reward|loyal|student|military|teacher|nurse|hero|refer|ambassador|affiliate|influencer|partner|faq|newsletter|subscribe|special|vip|welcome|first|gift/i;
// Store pages that never carry codes.
const NO_CODES = /contact|privacy|terms|polic(?:y|ies)|shipping|return|refund|track|account|login|cart|checkout|search|careers|jobs|warranty|accessib|sitemap|press|blogs?\//i;

export interface OwnSiteCode extends StoreCode {
  url: string;
}

/** The store's own pages a home page links to that may print codes, best first. */
export function ownSitePages(home: Snapshot, domain: string, max = OWN_SITE_PAGES): string[] {
  const out: string[] = [];
  const onSite = (h: string): boolean => h === domain || h.endsWith("." + domain);
  for (const el of home.elements) {
    if (!el.href) continue;
    let u: URL;
    try {
      u = new URL(el.href, home.url);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(u.protocol) || !onSite(u.hostname.toLowerCase())) continue;
    const path = u.pathname.replace(/\/+$/, "");
    if (!path || !PROMO_PATH.test(path) || NO_CODES.test(path)) continue;
    const page = u.origin + path;
    if (!out.includes(page)) out.push(page);
  }
  // Pages with promotion words in their path before the plain /pages/* ones.
  const strong = (p: string): number => (/offer|promo|deal|discount|coupon|sale|reward|vip|welcome|first|student|military|refer/i.test(new URL(p).pathname) ? 0 : 1);
  return out.sort((a, b) => strong(a) - strong(b)).slice(0, max);
}

async function readPage(b: PageBrowser, url: string): Promise<Snapshot | null> {
  const tab = await b.open(url).catch(() => null);
  if (tab === null) return null;
  try {
    return await b.read(tab).catch(() => null);
  } finally {
    await b.close(tab).catch(() => undefined);
  }
}

export interface OwnSiteRead {
  codes: OwnSiteCode[];
  /** Pages that loaded, home included. */
  pages: number;
}

/**
 * Codes on the store's own site: its home page, then up to OWN_SITE_PAGES of
 * the pages it links to, read at the same time. Empty when the site can't be
 * read (no access, a bot wall) or the time runs out.
 */
export async function readOwnSite(b: PageBrowser, domain: string, opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<OwnSiteRead> {
  const found: OwnSiteCode[] = [];
  let pages = 0;
  const take = (snap: Snapshot, url: string): void => {
    pages++;
    for (const c of codesWithContext(snap.text)) {
      if (!found.some((f) => f.code === c.code)) found.push({ ...c, url });
    }
  };
  const work = (async () => {
    const homeUrl = "https://" + domain + "/";
    const home = await readPage(b, homeUrl);
    if (!home || opts.signal?.aborted) return;
    take(home, homeUrl);
    const more = ownSitePages(home, domain);
    const read = await Promise.all(more.map(async (url) => ({ url, snap: opts.signal?.aborted ? null : await readPage(b, url) })));
    for (const r of read) if (r.snap) take(r.snap, r.url);
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([work.catch(() => undefined), new Promise<void>((r) => (timer = setTimeout(r, opts.timeoutMs ?? OWN_SITE_MS)))]);
  clearTimeout(timer);
  return { codes: found.slice(0, MAX_STORE_CODES), pages };
}
