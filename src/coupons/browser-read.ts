// Browser fallback for coupon pages (owner request 2026-10-17). When the
// provider's page reader refuses or fails a page (getbeefy.co's coupon pages
// answered 403), or a page hides its codes behind a "Show code" button, Scout
// opens that page in a background Safari tab, waits for it to render, presses
// up to a few coupon controls ("Show code", "Reveal coupon", "Load more"),
// reads the codes now written on the page, and closes the tab.
//
// Code here drives the tab, not the model, so page text never steers what is
// clicked. Boundaries: only pages the search found, a few pages and clicks,
// a time budget; never a link to another site, an order, sign-in or payment
// control (the safety classifier decides), and a page that asks for a
// CAPTCHA or a sign-in is left as it is and reported. A code read here was
// found on a page; it is not known to work until the cart says so.
import { CODE_RE, normalizeCode } from "./candidates";
import { isOrderLike, newLines } from "./form";
import { codesWithContext } from "./store";
import { detectCaptcha } from "../safety/classifier";
import type { SnapElement, Snapshot } from "../snapshot/snapshot";

/** The tab tools the fallback needs; the popup implements them with Safari tabs and Scout's content script. */
export interface PageBrowser {
  /** Opens `url` in a background tab and returns its id, or null when it cannot. */
  open(url: string): Promise<number | null>;
  /** The rendered page, or null while it is not readable (loading, no access). */
  read(tab: number): Promise<Snapshot | null>;
  /** Presses one element of the last snapshot. False when the page refused it. */
  click(tab: number, ref: string): Promise<boolean>;
  /** Closes the tab and any tab the page opened from it. */
  close(tab: number): Promise<void>;
  wait(ms: number): Promise<void>;
}

/** Why a page went to the browser. */
export type BrowserReason = "refused" | "failed" | "short" | "masked";

export interface BrowserTarget {
  url: string;
  reason: BrowserReason;
  /** The reader's own error, when it gave one ("url_not_accessible", "403"). */
  error?: string;
}

export type BrowserOutcome = "read" | "empty" | "captcha" | "sign_in" | "no_access" | "timeout" | "stopped" | "error";

/** One page the browser visited: the run trace's record of it. */
export interface BrowserPage {
  url: string;
  reason: BrowserReason;
  error?: string;
  outcome: BrowserOutcome;
  /** Characters of rendered text read. */
  chars: number;
  /** Kinds of the controls pressed, in order ("reveal", "more"; "(refused)" when the page refused one). Never page text. */
  clicks: string[];
  /** Codes read on the page. */
  codes: string[];
  /** Whole run time on this page. */
  ms: number;
}

export interface BrowserCode {
  code: string;
  url: string;
  /** Words around the code on the page. */
  context: string;
  /** How it was read: printed in the page text, or shown after a press. */
  how: "printed" | "revealed";
}

export const BROWSER_MAX_PAGES = 5;
export const BROWSER_TIME_MS = 120_000;
/** One page: load, presses and reading. */
export const BROWSER_PAGE_MS = 30_000;
export const BROWSER_MAX_CLICKS = 6;
const LOAD_POLL_MS = 600;
const SETTLE_MS = 1200;
/** Rendered text shorter than this is still loading (or a blank wall). */
const MIN_TEXT = 200;
const MAX_TEXT_KEPT = 60_000;

// Coupon-site controls worth one press each. Ordered: reveal first, then load more.
const REVEAL = /\b(?:show|reveal|get|see|view|unlock|copy)\s+(?:the\s+)?(?:promo\s+|coupon\s+|discount\s+)?(?:code|coupon|deal)s?\b|\bclick\s+to\s+(?:reveal|copy|show)\b/i;
const LOAD_MORE = /\b(?:load|show|see|view)\s+(?:more|all)(?:\s+(?:codes|coupons|offers|deals|promo\s+codes))?\b/i;
// Walls that need the user: never pressed through.
const SIGN_IN = /\b(?:sign|log)\s*in\s+to\s+(?:see|view|reveal|get|continue|access)|\bmembers?\s+only\b|\bsubscribe\s+to\s+(?:see|view|reveal|unlock)/i;
// Words written alone on coupon pages that are not codes.
const NOT_CODES = new Set([
  "COPY", "COPIED", "CODE", "CODES", "SHOW", "REVEAL", "GET", "DEAL", "DEALS", "OFFER", "OFFERS", "COUPON", "COUPONS", "VERIFIED",
  "EXCLUSIVE", "EXPIRED", "EXPIRES", "SALE", "SHOP", "STORE", "CLOSE", "DONE", "MORE", "DETAILS", "TERMS", "WORKED", "WORKS",
  "YES", "NO", "OK", "NEW", "HOT", "TOP", "BEST", "FREE", "SHIPPING", "LOADING", "MENU", "SEARCH", "LOGIN", "SIGNUP", "HOME",
  "FAQ", "FAQS", "USD", "EUR", "GBP", "CAD", "AUD", "OFF", "BOGO", "SITEWIDE", "TODAY", "ACTIVE", "SUCCESS", "THANKS",
]);

const isButtonish = (e: SnapElement): boolean => e.tag === "button" || e.role === "button" || e.tag === "a" || e.role === "link" || e.role === "tab";

function sameSite(href: string, pageUrl: string): boolean {
  const h = href.trim();
  if (!h || h.startsWith("#") || /^javascript:/i.test(h)) return true;
  try {
    const a = new URL(h, pageUrl).hostname.replace(/^www\./, "");
    const b = new URL(pageUrl).hostname.replace(/^www\./, "");
    return a === b;
  } catch {
    return false;
  }
}

/** Coupon controls on a page, best first: reveal buttons, then "Load more". Never one that leaves the site or orders. */
export function couponControls(snap: Snapshot): SnapElement[] {
  const ok = (e: SnapElement): boolean =>
    isButtonish(e) && !e.disabled && e.name.length <= 80 && sameSite(e.href ?? "", snap.url) && !isOrderLike(e, snap);
  const reveal = snap.elements.filter((e) => ok(e) && REVEAL.test(e.name));
  const more = snap.elements.filter((e) => ok(e) && LOAD_MORE.test(e.name) && !REVEAL.test(e.name));
  return [...reveal, ...more];
}

/** A string that is a code by itself ("SAVE20", "SAVE20 Copy"), or null. */
export function codeAlone(s: string): string | null {
  const bare = s.replace(/\s+(?:copy|copied|copy\s+code)$/i, "").replace(/^(?:code|promo\s+code|coupon\s+code)\s*[:-]?\s*/i, "").trim();
  if (!CODE_RE.test(bare) || bare !== bare.toUpperCase() || bare.length < 4) return null;
  const code = normalizeCode(bare);
  if (!code || NOT_CODES.has(code)) return null;
  // A code mixes letters with digits, or is a long made-up word ("CYBERTACK"); plain short words are labels.
  return /\d/.test(code) || code.length >= 6 ? code : null;
}

/** Element names and values that are codes by themselves. */
function elementCodes(snap: Snapshot): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of snap.elements) {
    for (const s of [e.name, e.redacted ? "" : (e.value ?? "")]) {
      const code = codeAlone(s);
      if (code && !out.has(code)) out.set(code, s.trim());
    }
  }
  return out;
}

/**
 * Codes that a press made appear: new lines or element texts that are a code
 * by themselves, and, after a reveal press (`revealed`), any code-like word
 * new to the page on a changed line ("15% off SYNTH15 Shop now").
 */
export function revealedCodes(before: Snapshot, after: Snapshot, revealed = false): Array<{ code: string; context: string }> {
  const out: Array<{ code: string; context: string }> = [];
  const add = (code: string | null, context: string): void => {
    if (code && !out.some((o) => o.code === code)) out.push({ code, context: context.slice(0, 200) });
  };
  const fresh = newLines(before.text, after.text).split("\n");
  fresh.forEach((line, i) => {
    const context = [fresh[i - 1] ?? "", line, fresh[i + 1] ?? ""].join(" ").trim();
    add(codeAlone(line), context);
    if (revealed) for (const word of line.split(/\s+/)) if (!textHas(before.text, word)) add(codeAlone(word), context);
  });
  const had = elementCodes(before);
  for (const [code, s] of elementCodes(after)) if (!had.has(code)) add(code, s);
  return out;
}

const textHas = (text: string, word: string): boolean => new RegExp("(^|[^A-Za-z0-9])" + word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([^A-Za-z0-9]|$)").test(text);

const pageKey = (url: string): string => {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/+$/, "");
  } catch {
    return url;
  }
};

export interface BrowserReadOptions {
  signal?: AbortSignal;
  timeMs?: number;
  pageMs?: number;
  maxPages?: number;
  maxClicks?: number;
  /** Words that are the store's own name, never a code. */
  storeWords?: ReadonlySet<string>;
  /** Called as each page finishes, for the run trace and early testing. */
  onPage?: (page: BrowserPage, codes: BrowserCode[], text: string) => void;
  now?: () => number;
}

export interface BrowserReadResult {
  pages: BrowserPage[];
  codes: BrowserCode[];
  /** Rendered text of each page read, by address: evidence for the model's lines. */
  texts: Map<string, string>;
}

/**
 * Visits `targets` one at a time in background tabs and reads their codes.
 * Never throws; a page that cannot be read is reported with why.
 */
export async function browserRead(targets: BrowserTarget[], browser: PageBrowser, opts: BrowserReadOptions = {}): Promise<BrowserReadResult> {
  const now = opts.now ?? Date.now;
  const started = now();
  const deadline = started + (opts.timeMs ?? BROWSER_TIME_MS);
  const pages: BrowserPage[] = [];
  const codes: BrowserCode[] = [];
  const texts = new Map<string, string>();
  const seen = new Set<string>();
  const queue = targets.filter((t) => {
    const k = pageKey(t.url);
    if (seen.has(k) || !/^https?:\/\//i.test(t.url)) return false;
    seen.add(k);
    return true;
  }).slice(0, opts.maxPages ?? BROWSER_MAX_PAGES);
  const stopped = (): boolean => opts.signal?.aborted === true;
  const skip = (code: string): boolean => opts.storeWords?.has(code) === true;

  for (const target of queue) {
    if (stopped() || now() >= deadline) break;
    const pageStart = now();
    const pageEnd = Math.min(deadline, pageStart + (opts.pageMs ?? BROWSER_PAGE_MS));
    const page: BrowserPage = { url: target.url, reason: target.reason, ...(target.error ? { error: target.error } : {}), outcome: "error", chars: 0, clicks: [], codes: [], ms: 0 };
    const found: BrowserCode[] = [];
    const addCode = (c: BrowserCode): void => {
      if (skip(c.code) || found.some((f) => f.code === c.code)) return;
      found.push(c);
    };
    let text = "";
    let tab: number | null = null;
    try {
      tab = await browser.open(target.url);
      if (tab === null) {
        page.outcome = "no_access";
      } else {
        // 1. Wait for rendered text.
        let snap: Snapshot | null = null;
        while (!stopped() && now() < pageEnd) {
          snap = await browser.read(tab).catch(() => null);
          if (snap && snap.text.trim().length >= MIN_TEXT) break;
          await browser.wait(LOAD_POLL_MS);
        }
        if (stopped()) page.outcome = "stopped";
        else if (!snap) page.outcome = now() >= pageEnd ? "timeout" : "no_access";
        else if (snap.text.trim().length < MIN_TEXT) page.outcome = "timeout";
        else if (detectCaptcha(snap)) page.outcome = "captcha";
        else {
          // Settled once more: lists that fill in after the first paint.
          await browser.wait(SETTLE_MS);
          snap = (await browser.read(tab).catch(() => null)) ?? snap;
          text = snap.text;
          const landed = snap.url || target.url;
          for (const c of codesWithContext(snap.text, 20)) addCode({ code: c.code, url: target.url, context: c.context, how: "printed" });
          for (const [code, s] of elementCodes(snap)) addCode({ code, url: target.url, context: s, how: "printed" });
          // 2. Press coupon controls, one at a time, reading what each shows.
          // Refs are renumbered on every read, so presses are counted by name:
          // `skipped` = how many leading controls of that name are done. A press
          // that turns "Show code" into the code itself leaves the next one first.
          const skipped = new Map<string, number>();
          const nameOf = (e: SnapElement): string => e.name.trim().toLowerCase();
          const maxClicks = opts.maxClicks ?? BROWSER_MAX_CLICKS;
          while (page.clicks.length < maxClicks && !stopped() && now() < pageEnd) {
            const controls = couponControls(snap);
            const seenNames = new Map<string, number>();
            const next = controls.find((e) => {
              const n = nameOf(e);
              const nth = seenNames.get(n) ?? 0;
              seenNames.set(n, nth + 1);
              return nth >= (skipped.get(n) ?? 0);
            });
            if (!next) break;
            const name = nameOf(next);
            const countOf = (s: Snapshot): number => couponControls(s).filter((e) => nameOf(e) === name).length;
            const before = countOf(snap);
            const reveal = REVEAL.test(next.name);
            const ok = await browser.click(tab, next.ref).catch(() => false);
            page.clicks.push((reveal ? "reveal" : "more") + (ok ? "" : " (refused)"));
            if (!ok) {
              skipped.set(name, (skipped.get(name) ?? 0) + 1);
              continue;
            }
            await browser.wait(SETTLE_MS);
            const after = await browser.read(tab).catch(() => null);
            if (!after) break;
            if (countOf(after) >= before) skipped.set(name, (skipped.get(name) ?? 0) + 1);
            if (detectCaptcha(after)) {
              page.outcome = "captcha";
              break;
            }
            // A press that left the site (an affiliate redirect to the store) ends the presses; that page is not read.
            if (!sameSite(after.url, landed)) break;
            for (const r of revealedCodes(snap, after, reveal)) addCode({ code: r.code, url: target.url, context: r.context, how: "revealed" });
            for (const c of codesWithContext(after.text, 20)) addCode({ code: c.code, url: target.url, context: c.context, how: "printed" });
            const added = newLines(text, after.text);
            if (added) text += "\n" + added;
            snap = after;
          }
          if (page.outcome !== "captcha") {
            if (found.length) page.outcome = "read";
            else if (SIGN_IN.test(text)) page.outcome = "sign_in";
            else page.outcome = stopped() ? "stopped" : text.trim().length >= MIN_TEXT ? "empty" : "timeout";
          }
        }
      }
    } catch {
      page.outcome = stopped() ? "stopped" : "error";
    } finally {
      if (tab !== null) await browser.close(tab).catch(() => undefined);
    }
    page.chars = text.length;
    page.codes = found.map((f) => f.code);
    page.ms = now() - pageStart;
    pages.push(page);
    if (text) texts.set(target.url, text.slice(0, MAX_TEXT_KEPT));
    for (const f of found) if (!codes.some((c) => c.code === f.code && c.url === f.url)) codes.push(f);
    opts.onPage?.(page, found, text);
  }
  return { pages, codes, texts };
}

/** Trace line for one page: method, page, reason, outcome, presses, codes. No query strings, no page text. */
export function browserTrace(p: BrowserPage): string {
  return (
    "coupons:browser " + pageKey(p.url) + " why=" + p.reason + (p.error ? "(" + p.error + ")" : "") + " -> " + p.outcome +
    " chars=" + p.chars + " clicks=" + p.clicks.length + (p.clicks.length ? "[" + p.clicks.join("; ") + "]" : "") +
    " codes=" + p.codes.length + " " + Math.round(p.ms / 1000) + "s"
  );
}
