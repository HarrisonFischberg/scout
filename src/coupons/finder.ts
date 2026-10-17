// Coupon finder: test the codes found online one at a time against the real
// cart, keep the best, apply it, and never touch checkout. The try loop is
// plain code, not model-driven, so page content cannot steer it, and it only
// ever tests codes that were seen on a page (candidates.ts): never guesses.
//
// Two ways to test a code:
//   cart API - the store's own cart endpoint (Shopify /cart/update.js,
//              WooCommerce, BigCommerce), the same one its Apply button uses,
//              in the user's session. Fast and exact; can also try two codes
//              together where the store allows stacking.
//   page     - type the code in the page's coupon box, press Apply, read the total.
// The coupon box (or cart API) is opened before the web search, so a page
// with no way to test codes stops at once instead of after a long search.
// Codes are tested as the search finds them (`incoming`), not after it ends.
// Every code a search finds is tested, not just until the first saving; when
// none of them saves, the user is asked whether to search the web again.
import type { Action, ActionResult } from "../actions/executor";
import type { AgentControl } from "../agent/control";
import { detectCaptcha } from "../safety/classifier";
import type { Snapshot } from "../snapshot/snapshot";
import { CODE_RE, type CandidateOrigin, type CouponCandidate } from "./candidates";
import { findForm, newLines, removeTarget, revealTargets, showsCode, storeReply, type FormHints, type StoreReply } from "./form";
import { formatMoney, readTotal } from "./money";

export type { CouponCandidate } from "./candidates";

export interface CartState {
  /** Cart total in the store currency, already including any applied code. */
  total: number;
  currency: string | null;
  codes: Array<{ code: string; applicable: boolean }>;
  /** Whose cart API answered: "shopify", "woocommerce", "bigcommerce". */
  platform?: string;
}

/** The store's own cart API (Shopify), reached through the content script. */
export interface CartApi {
  info(): Promise<CartState | null>;
  update(discount: string): Promise<CartState | { rateLimited: true } | null>;
  reload(): Promise<void>;
}

export interface CouponPage {
  snapshot(): Promise<Snapshot>;
  act(action: Action): Promise<ActionResult>;
  cart?: CartApi;
}

export interface CouponAttempt {
  /** The code, or "A,B" for two codes applied together. */
  code: string;
  origin: CandidateOrigin;
  sourceUrl?: string;
  /** Words from the source page around the code. */
  context?: string;
  conditions?: string;
  /** Set when `code` is two codes applied together. */
  combo?: string[];
  /** Total after applying the code, or null if unreadable. */
  total: number | null;
  /** Baseline total minus this total; 0 means no saving. */
  saving: number | null;
  /** Cart API: whether the store accepted the code. Page path: unknown (null). */
  accepted: boolean | null;
  note: string;
}

export type CouponStatus = "done" | "no_form" | "no_codes" | "search_failed" | "captcha" | "stopped" | "rate_limited" | "error";

// Plain-language status line for the popup; never shows the internal code.
export function couponStatusText(status: CouponStatus): string {
  switch (status) {
    case "done": return "Coupon search finished.";
    case "no_form": return "Coupon search stopped: no coupon box on this page.";
    case "no_codes": return "Coupon search found no codes posted online.";
    case "search_failed": return "Coupon search could not search the web.";
    case "captcha": return "Coupon search stopped at a CAPTCHA.";
    case "stopped": return "Coupon search stopped.";
    case "rate_limited": return "Coupon search paused: the store asked to slow down.";
    case "error": return "Coupon search failed. Nothing was ordered.";
  }
}

export interface CouponOutcome {
  status: CouponStatus;
  /** "page" (coupon box) or the store platform whose cart API was used. */
  method: string | null;
  baseline: number | null;
  /** As the store prints it ("$", "€") or an ISO code from its cart API. */
  currency?: string;
  /** Why testing ended early, for the summary. */
  note?: string;
  attempts: CouponAttempt[];
  best?: CouponAttempt;
  /** True when the best code was applied and a fresh read confirmed the total. */
  applied: boolean;
  /** Codes left untested because the user stopped between batches. */
  untested: number;
  /** True when the user asked for more codes and none could be found. */
  exhausted?: boolean;
  message: string;
}

/** Most codes one run tests, across all its searches. */
export const MAX_TOTAL = 80;
/** Pairs tried on top of the best single code, on stores whose cart API allows stacking. */
const MAX_COMBOS = 2;
const STOPWORDS = new Set(["NONE", "N/A", "CODE", "CODES", "COUPON", "SORRY", "NOTE", "THE", "AND"]);

/** Candidate codes from free text: one per token, upper-cased, deduped, capped. */
export function parseCodes(text: string, max = 10): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\s,;:()[\]"'`*]+/)) {
    const tok = raw.replace(/^[-.]+|[-.]+$/g, "");
    if (tok !== tok.toUpperCase() || !/[A-Z]/.test(tok) || !CODE_RE.test(tok) || STOPWORDS.has(tok)) continue;
    if (!out.includes(tok)) out.push(tok);
    if (out.length >= max) break;
  }
  return out;
}

/** Last order total on the page that is not a subtotal, in the store's currency. */
export function parseTotal(text: string): number | null {
  return readTotal(text)?.amount ?? null;
}

/** Largest positive saving among accepted (or not rejected) codes; the earliest wins ties. */
export function bestOf(attempts: CouponAttempt[]): CouponAttempt | undefined {
  let best: CouponAttempt | undefined;
  for (const a of attempts) {
    if (a.accepted === false) continue;
    if (a.saving !== null && a.saving > 0 && (!best || a.saving > (best.saving ?? 0))) best = a;
  }
  return best;
}

export interface TryResult {
  total: number | null;
  accepted: boolean | null;
  note?: string;
  captcha?: boolean;
  rateLimited?: boolean;
  /** No further code can be measured on this page; `note` says why. */
  halt?: boolean;
}

/** A way to test codes on the user's cart: the store's cart API or its coupon box. */
export interface CouponTester {
  method: string;
  baseline: number;
  currency?: string;
  tryCode(code: string): Promise<TryResult>;
  /** Cart APIs: several codes at once ("A,B"); accepted only when the store takes all of them. */
  tryCombo?(codes: string[]): Promise<TryResult>;
  /** Applies one code (or "" to clear) and returns the confirmed total. */
  apply(code: string): Promise<number | null>;
  /** Leaves the cart as the user expects: winner applied, or original codes back. */
  finish(winner: string | null): Promise<void>;
}

export interface TesterError {
  error: CouponStatus;
  message: string;
}

async function cartTester(cart: CartApi): Promise<CouponTester | TesterError | null> {
  const start = await cart.info();
  // Only a real cart (numeric total) counts; anything else falls back to the page path.
  if (!start || typeof start.total !== "number" || !Array.isArray(start.codes)) return null;
  // Nothing to lower: an empty cart, or one whose price the store sets at checkout.
  if (start.total <= 0) {
    return { error: "error", message: "The cart total is " + formatMoney(0, start.currency) + ", so no code could lower it. Add an item to the cart first." };
  }
  const original = start.codes.map((c) => c.code).join(",");
  const outcome = (r: CartState | { rateLimited: true } | null, asked: string[]): TryResult => {
    if (!r) return { total: null, accepted: null, note: "The store did not answer." };
    if ("rateLimited" in r) return { total: null, accepted: null, rateLimited: true, note: "The store asked to slow down." };
    const accepted = asked.every((code) => r.codes.find((c) => c.code.toUpperCase() === code.toUpperCase())?.applicable === true);
    return { total: r.total, accepted };
  };
  return {
    method: start.platform ?? "shopify",
    baseline: start.total,
    ...(start.currency ? { currency: start.currency } : {}),
    async tryCode(code) {
      return outcome(await cart.update(code), [code]);
    },
    async tryCombo(codes) {
      return outcome(await cart.update(codes.join(",")), codes);
    },
    async apply(code) {
      const r = await cart.update(code);
      return r && !("rateLimited" in r) ? r.total : null;
    },
    async finish(winner) {
      if (winner === null) await cart.update(original);
      // The cart page shows stale totals after API changes; reload it.
      await cart.reload();
    },
  };
}

/** How long to wait for a store after pressing Apply (or a toggle), and how often to look. */
export interface SettleTimes {
  /** With no word from the store, a code that changed nothing is judged after this. */
  quietMs: number;
  /** Upper bound while the store says it is working or that the code applied. */
  maxMs: number;
}
const POLL_MS = 300;
const MIN_QUIET_MS = 600;
const CHECKOUT_CONTROL = /\bcheck\s*out\b/i;
const CART_PAGE = /\b(?:cart|bag|basket)\b/i;

/**
 * Why no code can be tested here. Many stores (headless and drawer-only
 * Shopify fronts among them) take codes only on the checkout page; a cart
 * page with a Checkout button says so, so the user knows where to go.
 */
export function noBoxMessage(snap: Snapshot): string {
  const checkout = snap.elements.some((e) => (e.tag === "button" || e.role === "button" || e.role === "link" || e.tag === "a") && CHECKOUT_CONTROL.test(e.name));
  const onCart = CART_PAGE.test(snap.title) || CART_PAGE.test(snap.url) || /openCart|cart=/i.test(snap.url);
  if (checkout && onCart) {
    return "No coupon box on this cart. This store takes codes on its checkout page: open Checkout (nothing is bought until you confirm there) and run Find coupons again.";
  }
  return "No coupon box found on this page. Open the cart or checkout page first.";
}
const EPS = 0.004;
// Why the page path stopped with a code still on the order: each says which
// step failed, so a live run's summary tells the two apart.
const REMOVE_FAILED_NOTE = "The store kept the earlier code on the order: I pressed its remove control, but the total did not go back, so I stopped testing there.";
const BOX_GONE_NOTE =
  "The store kept the earlier code on the order and shows no remove button I can use safely, and its coupon box is not available while that code is on, so I stopped testing there.";
const stackedNote = (kept: string, code: string): string =>
  "The store kept " + kept + " on the order and added " + code + " on top of it, so the total now counts both codes. Codes cannot be measured one at a time here, so I stopped testing.";

async function pageTester(
  page: CouponPage,
  times: SettleTimes,
  locate?: (snap: Snapshot) => Promise<FormHints | null>,
): Promise<CouponTester | TesterError> {
  const pause = async (ms: number): Promise<void> => void (await page.act({ type: "wait", ms }).catch(() => null));
  // A page that is reloading (a store whose Apply submits a form) does not answer for a moment.
  const look = async (): Promise<Snapshot | null> => {
    for (let i = 0; i < 4; i++) {
      const snap = await page.snapshot().catch(() => null);
      if (snap && typeof snap.text === "string" && Array.isArray(snap.elements)) return snap;
      await pause(POLL_MS);
    }
    return null;
  };
  // Never throws: a page that did not answer counts as a failed action.
  const act = async (a: Action): Promise<ActionResult> =>
    (await page.act(a).catch(() => null)) ?? { ok: false, action: a.type, message: "The page did not answer." };
  let hints: FormHints | undefined;
  const totalOf = (snap: Snapshot) => readTotal(snap.text, hints?.totalLabel);

  // The box, after clicking what shows it when it is hidden ("Have a promo code?").
  const open = async (start: Snapshot): Promise<{ snap: Snapshot; form: NonNullable<ReturnType<typeof findForm>> } | null> => {
    let snap = start;
    const clicked = new Set<string>();
    for (let round = 0; round < 3; round++) {
      const form = findForm(snap, hints);
      if (form) return { snap, form };
      const target = revealTargets(snap, hints).find((e) => !clicked.has(e.role + ":" + e.name));
      if (!target) return null;
      clicked.add(target.role + ":" + target.name);
      if (!(await act({ type: "click", ref: target.ref })).ok) continue;
      for (let waited = 0; waited < Math.max(times.quietMs, POLL_MS); waited += POLL_MS) {
        await pause(POLL_MS);
        const next = await look();
        if (!next) return null;
        snap = next;
        if (findForm(snap, hints)) break;
      }
    }
    const form = findForm(snap, hints);
    return form ? { snap, form } : null;
  };

  let first = await look();
  if (!first) return { error: "error", message: "Could not read the page." };
  if (detectCaptcha(first)) return { error: "captcha", message: "Stopped: the page asks for a CAPTCHA. Complete it yourself." };
  let opened = await open(first);
  // Rules found no box or no total: ask the model which controls they are, once.
  if ((!opened || !totalOf(opened.snap)) && locate) {
    hints = (await locate(opened?.snap ?? first).catch(() => null)) ?? undefined;
    if (hints) {
      first = (await look()) ?? first;
      opened = await open(first);
    }
  }
  if (!opened) return { error: "no_form", message: noBoxMessage(first) };
  const base = totalOf(opened.snap);
  if (!base) return { error: "error", message: "Could not read a total on this page, so savings cannot be measured." };
  const baseline = base.amount;
  const inputRef = opened.form.input.ref;

  // A code that lowered the total and is still on the order.
  let kept: { code: string; total: number } | null = null;
  // Slowest time the store took to answer a code (message or new total), once seen.
  let answerMs: number | null = null;

  // Clicks the control that removes `code` and waits for the total to go back.
  const takeOff = async (snap: Snapshot, code: string): Promise<Snapshot | null | "none"> => {
    const target = removeTarget(snap, code);
    if (!target) return "none";
    if (!(await act({ type: "click", ref: target.ref })).ok) return null;
    for (let waited = 0; waited < Math.max(times.maxMs, POLL_MS); waited += POLL_MS) {
      await pause(POLL_MS);
      const next = await look();
      if (!next) return null;
      const t = totalOf(next)?.amount;
      if (t !== undefined && Math.abs(t - baseline) <= EPS) return next;
    }
    return null;
  };

  const tryCode = async (code: string): Promise<TryResult> => {
    let before = await look();
    if (!before) return { total: null, accepted: null, note: "Could not read the page." };
    if (detectCaptcha(before)) return { total: null, accepted: null, captcha: true };
    // Measure codes one at a time: take the last working code off first. A
    // store with no remove control keeps it on; the read after Apply then
    // tells whether this code replaced it (see below).
    if (kept) {
      const off = await takeOff(before, kept.code);
      if (off === null) return { total: null, accepted: null, halt: true, note: REMOVE_FAILED_NOTE };
      if (off !== "none") {
        before = off;
        kept = null;
      }
    }
    const box = await open(before);
    if (!box) return { total: null, accepted: null, ...(kept ? { halt: true, note: BOX_GONE_NOTE } : { note: "The coupon box is gone." }) };
    const typed = await act({ type: "type", ref: box.form.input.ref, text: code, clear: true });
    if (!typed.ok) return { total: null, accepted: null, note: "Could not type the code: " + typed.message };
    // Some stores enable Apply only once a code is typed.
    const ready = await look();
    const now = ready ? findForm(ready, hints) : null;
    if (!ready || !now || now.apply.disabled) return { total: null, accepted: null, note: "The Apply button stayed disabled." };
    const preTotal = totalOf(ready)?.amount ?? baseline;
    const clicked = await act({ type: "click", ref: now.apply.ref });
    if (!clicked.ok) return { total: null, accepted: null, note: "Could not press Apply: " + clicked.message };

    // Wait for the store's answer: a message, or a total that changed and held.
    // Once the store has answered a code, quiet codes wait about twice its answer time.
    const quiet = answerMs === null ? times.quietMs : Math.min(times.quietMs, Math.max(MIN_QUIET_MS, 2 * answerMs + POLL_MS));
    let after = ready;
    let reply: StoreReply = null;
    let changed: number | null = null;
    let waited = 0;
    let answeredAt: number | null = null;
    for (let i = 0; ; i++) {
      const limit = reply === "busy" || reply === "accepted" ? Math.max(times.maxMs, quiet) : quiet;
      if (i > 0 && waited >= limit) break;
      const step = Math.min(POLL_MS, Math.max(limit - waited, 0));
      await pause(step);
      waited += step;
      const next = await look();
      if (!next) return { total: null, accepted: null, note: "Could not read the page after applying." };
      if (detectCaptcha(next)) return { total: null, accepted: null, captcha: true };
      after = next;
      reply = storeReply(newLines(ready.text, next.text)) ?? reply;
      const t = totalOf(next)?.amount ?? null;
      const moved = t !== null && Math.abs(t - preTotal) > EPS;
      if (answeredAt === null && (moved || (reply !== null && reply !== "busy"))) answeredAt = waited;
      if (moved) {
        if (changed !== null && Math.abs(t - changed) <= EPS) break;
        changed = t;
        continue;
      }
      changed = null;
      if (reply === "rejected") break;
    }
    if (answeredAt !== null) answerMs = Math.max(answerMs ?? 0, answeredAt);
    const total = totalOf(after)?.amount ?? null;
    if (total === null) return { total: null, accepted: null, note: "Total not readable after applying." };
    // The earlier code could not be taken off first (no remove control). Its
    // line gone from the page, with a different total or a sign this one was
    // taken, means the store swapped it for this code: this total is this
    // code's alone. Still listed with a lower total, the store stacked them,
    // and no single code can be measured here. Otherwise the store kept the
    // earlier code and did not take this one in its place.
    if (kept && kept.code !== code) {
      const keptOn = showsCode(after.text, kept.code);
      const same = Math.abs(total - kept.total) <= EPS;
      const back = Math.abs(total - baseline) <= EPS;
      const swapped = !keptOn && (back || (reply !== "rejected" && (!same || reply === "accepted" || showsCode(after.text, code))));
      if (!swapped) {
        if (keptOn && total < kept.total - EPS) return { total: null, accepted: null, halt: true, note: stackedNote(kept.code, code) };
        return { total: null, accepted: reply === "rejected" ? false : null, note: "The store kept " + kept.code + " on the order and did not take this code in its place." };
      }
    }
    const lowered = total < baseline - EPS;
    kept = lowered ? { code, total } : null;
    if (reply === "rejected" && !lowered) return { total, accepted: false, note: "Not accepted by the store." };
    return { total, accepted: reply === "accepted" ? true : null };
  };
  return {
    method: "page",
    baseline,
    ...(base.currency ? { currency: base.currency } : {}),
    tryCode,
    async apply(code) {
      if (kept?.code === code) {
        const snap = await look();
        return snap ? (totalOf(snap)?.amount ?? null) : null;
      }
      return (await tryCode(code)).total;
    },
    async finish(winner) {
      // The page path cannot take a rejected code's text out of the box
      // reliably on every store; it clears the box when nothing won so the
      // user is not left with a failed code typed in.
      if (winner === null && !kept) await act({ type: "type", ref: inputRef, text: "", clear: true });
    },
  };
}

export interface TesterOptions {
  /** Page path: how long a code that changed nothing gets before it counts as no saving (default 2500 ms). */
  settleMs?: number;
  /** Page path: longest wait while the store says it is applying the code (default 8000 ms). */
  maxSettleMs?: number;
  /** Page path: asks the model which controls are the coupon box, Apply, and the total, when the rules find none. */
  locate?: (snap: Snapshot) => Promise<FormHints | null>;
}

/**
 * Opens a way to test codes on this page: the store's cart API when it has
 * one, else its coupon box. Reads the baseline total. Done before the web
 * search, so a page with no coupon box fails fast.
 */
export async function openCouponTester(page: CouponPage, opts: TesterOptions = {}): Promise<CouponTester | TesterError> {
  const viaCart = page.cart ? await cartTester(page.cart).catch(() => null) : null;
  if (viaCart && !("error" in viaCart)) return viaCart;
  const quietMs = opts.settleMs ?? 2500;
  const viaPage = await pageTester(page, { quietMs, maxMs: Math.max(opts.maxSettleMs ?? 8000, quietMs) }, opts.locate);
  // A cart API that answers an empty cart on a page that shows an order (a
  // headless storefront's checkout, whose cart lives elsewhere) is not the
  // last word: the page's own coupon box and total still count. Only when
  // the page has neither does the empty cart explain the stop.
  if (viaCart && "error" in viaCart && "error" in viaPage && viaPage.error === "no_form") return viaCart;
  return viaPage;
}

export interface BatchState {
  /** Codes tested so far; none of them lowered the total. */
  tried: number;
}

/** Codes found while a search is still running, handed to the tester as they come. */
export class CodeQueue implements AsyncIterable<CouponCandidate[]> {
  private items: CouponCandidate[][] = [];
  private waiting: ((r: IteratorResult<CouponCandidate[]>) => void) | null = null;
  private closed = false;

  push(list: CouponCandidate[]): void {
    if (this.closed || list.length === 0) return;
    if (this.waiting) {
      const w = this.waiting;
      this.waiting = null;
      w({ value: list, done: false });
    } else this.items.push(list);
  }

  /** No more codes will come (the search ended or was stopped). */
  close(): void {
    this.closed = true;
    if (this.waiting) {
      const w = this.waiting;
      this.waiting = null;
      w({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<CouponCandidate[]> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item) return Promise.resolve({ value: item, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => (this.waiting = resolve));
      },
    };
  }
}

export interface CouponInput extends TesterOptions {
  page: CouponPage;
  /** An already opened tester (see `openCouponTester`); otherwise one is opened from `page`. */
  tester?: CouponTester;
  codes: CouponCandidate[];
  /** More codes from the search still running; each is tested as it arrives, and the first round ends when this does. */
  incoming?: AsyncIterable<CouponCandidate[]>;
  control?: AgentControl;
  signal?: AbortSignal;
  /** Pause between codes, to be gentle with the store. */
  delayMs?: number;
  /**
   * Asked after a round (every code one search found) in which no code saved
   * money, when more can be found; false stops. Absent: no further search.
   */
  askMore?: (s: BatchState) => Promise<boolean>;
  /** Finds codes not in `known` (a new web search). Used only after askMore says yes; a stream is tested as it arrives. */
  findMore?: (known: string[]) => Promise<CouponCandidate[]> | AsyncIterable<CouponCandidate[]>;
  /** Called just before each code is tried. */
  onTry?: (code: string) => void;
  /** `currency` as the store prints it, for showing amounts. */
  onAttempt?: (a: CouponAttempt, index: number, total: number, currency?: string) => void;
}

const attemptOf = (cand: CouponCandidate, r: { total: number | null; accepted: boolean | null }, saving: number | null, note: string): CouponAttempt => ({
  code: cand.code,
  origin: cand.origin,
  ...(cand.sourceUrl ? { sourceUrl: cand.sourceUrl } : {}),
  ...(cand.context ? { context: cand.context } : {}),
  ...(cand.conditions ? { conditions: cand.conditions } : {}),
  total: r.total,
  saving,
  accepted: r.accepted,
  note,
});

export async function runCouponSearch(input: CouponInput): Promise<CouponOutcome> {
  const { control, signal } = input;
  const attempts: CouponAttempt[] = [];
  const halted = (): boolean => control?.isStopped === true || signal?.aborted === true;

  const codes: CouponCandidate[] = [];
  const add = (list: CouponCandidate[]): void => {
    for (const c of list) {
      if (codes.length >= MAX_TOTAL) return;
      const code = c.code.trim().toUpperCase();
      if (!CODE_RE.test(code) || codes.some((x) => x.code === code)) continue;
      codes.push({ ...c, code });
    }
  };
  add(input.codes);

  const tester = input.tester ?? (await openCouponTester(input.page, input));
  if ("error" in tester) {
    return { status: tester.error, method: null, baseline: null, attempts, applied: false, untested: codes.length, message: tester.message };
  }
  const baseline = tester.baseline;
  let haltNote = "";
  const result = (status: CouponStatus, message: string, extra: Partial<CouponOutcome> = {}): CouponOutcome => {
    const best = bestOf(attempts);
    return {
      status,
      method: tester.method,
      baseline,
      ...(tester.currency ? { currency: tester.currency } : {}),
      ...(haltNote ? { note: haltNote } : {}),
      attempts,
      ...(best ? { best } : {}),
      applied: false,
      untested: Math.max(codes.length - attempts.filter((a) => !a.combo).length, 0),
      message,
      ...extra,
    };
  };
  if (codes.length === 0 && !input.incoming) {
    await tester.finish(null).catch(() => undefined);
    return result("no_codes", "No codes to try.");
  }
  const savingOf = (total: number | null): number | null => (total === null ? null : Math.round((baseline - total) * 100) / 100);
  const noteOf = (r: TryResult, saving: number | null): string =>
    r.note ??
    (r.accepted === false
      ? "Not accepted by the store."
      : saving !== null && saving > 0
        ? "Saves " + formatMoney(saving, tester.currency) + "."
        : r.accepted
          ? "Accepted, but no lower total."
          : "No saving.");

  let stoppedEarly: CouponStatus | null = null;
  let exhausted = false;
  let i = 0;
  // One round per search: the codes it found, tested as they arrive (owner,
  // 2026-10-17: test as many as the search found, not a fixed batch).
  let feed: AsyncIterator<CouponCandidate[]> | undefined = input.incoming?.[Symbol.asyncIterator]();
  /** How many codes were known when the latest extra search started. */
  let searchedFrom: number | null = null;
  outer: for (;;) {
    for (;;) {
      if (i >= codes.length) {
        if (!feed) break;
        const next = await feed.next();
        if (next.done) {
          feed = undefined;
          break;
        }
        add(next.value);
        continue;
      }
      const cand = codes[i]!;
      await control?.gate();
      if (halted()) {
        stoppedEarly = "stopped";
        break outer;
      }
      i++;
      input.onTry?.(cand.code);
      const r = await tester.tryCode(cand.code);
      if (r.captcha) {
        // Recorded so the user sees which code was being tried; then a hard stop.
        const attempt = attemptOf(cand, { total: null, accepted: null }, null, "The page asked for a CAPTCHA.");
        attempts.push(attempt);
        input.onAttempt?.(attempt, attempts.length, codes.length, tester.currency);
        stoppedEarly = "captcha";
        break outer;
      }
      if (r.rateLimited) {
        stoppedEarly = "rate_limited";
        break outer;
      }
      if (r.halt) {
        haltNote = r.note ?? "";
        break outer;
      }
      const saving = savingOf(r.total);
      const attempt = attemptOf(cand, r, saving, noteOf(r, saving));
      attempts.push(attempt);
      input.onAttempt?.(attempt, attempts.length, codes.length, tester.currency);
      if (input.delayMs) await new Promise((res) => setTimeout(res, input.delayMs));
    }
    if (halted()) {
      stoppedEarly = "stopped";
      break;
    }
    // A search after the first that added nothing new: nothing left to find.
    if (searchedFrom !== null && codes.length === searchedFrom) {
      exhausted = true;
      break;
    }
    // Once a code saves money no further search is offered: the "search
    // again" question is for runs where nothing has worked yet.
    if (bestOf(attempts) || !input.askMore || !input.findMore || codes.length >= MAX_TOTAL || codes.length === 0) break;
    const more = await input.askMore({ tried: i });
    if (!more || halted()) break;
    searchedFrom = codes.length;
    const found = input.findMore(codes.map((c) => c.code));
    if (Symbol.asyncIterator in found) feed = found[Symbol.asyncIterator]();
    else add(await found.catch(() => []));
  }
  if (feed) await feed.return?.();
  // Nothing found to test (a stop during the search included): the caller says why.
  if (attempts.length === 0 && codes.length === 0) {
    await tester.finish(null).catch(() => undefined);
    return result("no_codes", "No codes to try.");
  }

  // Stores whose cart API allows stacking: the best code with each of the next
  // best, kept only when the store takes both and the total drops further.
  if (!stoppedEarly && !haltNote && tester.tryCombo) {
    const winners = attempts.filter((a) => !a.combo && a.accepted !== false && a.saving !== null && a.saving > 0).sort((a, b) => (b.saving ?? 0) - (a.saving ?? 0));
    const top = winners[0];
    if (top) {
      for (const other of winners.slice(1, 1 + MAX_COMBOS)) {
        if (halted()) break;
        const combo = [top.code, other.code];
        const r = await tester.tryCombo(combo).catch((): TryResult => ({ total: null, accepted: null, note: "The store did not answer." }));
        if (r.rateLimited || r.captcha) break;
        const beats = r.accepted === true && r.total !== null && r.total < (top.total ?? baseline) - EPS;
        const saving = savingOf(r.total);
        const attempt: CouponAttempt = {
          code: combo.join(","),
          combo,
          origin: top.origin,
          total: r.total,
          saving,
          accepted: r.accepted === true ? (beats ? true : false) : r.accepted,
          note: beats ? "Together: saves " + formatMoney(saving ?? 0, tester.currency) + "." : r.accepted === true ? "Both accepted, but no lower total." : "The store does not combine these codes.",
        };
        attempts.push(attempt);
        input.onAttempt?.(attempt, attempts.length, codes.length, tester.currency);
      }
    }
  }

  const best = bestOf(attempts);
  if (stoppedEarly === "captcha") {
    return result("captcha", "Stopped: the page asks for a CAPTCHA. Complete it yourself.");
  }
  if (!best || best.total === null) {
    await tester.finish(null).catch(() => undefined);
    const message =
      stoppedEarly === "rate_limited"
        ? "The store asked to slow down."
        : exhausted
          ? "No code lowered the total, and no more codes were found."
          : "No code lowered the total.";
    return result(stoppedEarly ?? "done", message, exhausted ? { exhausted } : {});
  }
  // Apply the winner (later attempts replaced it) and confirm with a fresh read.
  const total = await tester.apply(best.code).catch(() => null);
  const applied = total !== null && total <= best.total + 0.005;
  await tester.finish(applied ? best.code : null).catch(() => undefined);
  const shown = best.combo ? best.combo.join(" + ") : best.code;
  return result(stoppedEarly ?? "done", applied ? "Best code " + shown + " applied." : "Best code " + shown + " could not be re-applied.", { applied });
}

/** "20% off" for the drop from `baseline` to `total`. */
export const percentOff = (baseline: number, total: number): string => {
  const p = baseline > 0 ? ((baseline - total) / baseline) * 100 : 0;
  return p >= 1 ? Math.round(p) + "% off" : "under 1% off";
};

/** What the web search found, for the summary's first line. */
export interface DiscoveryInfo {
  brand: string;
  searched: boolean;
  error?: { code: string; message: string };
  /** Codes from the store's own site. */
  store: number;
  verified: number;
  reported: number;
  masked: number;
  dropped: number;
  offers?: string[];
}

export const plural = (n: number, what: string): string => n + " " + what + (n === 1 ? "" : "s");

/** How the codes were found, in plain words. Built in code, not by the model. */
export function discoveryLine(d: DiscoveryInfo): string {
  const found = d.store + d.verified + d.reported;
  const parts: string[] = [];
  if (d.store) parts.push(plural(d.store, "code") + " on the store's own site");
  if (d.verified) parts.push(plural(d.verified, "code") + " read on the pages that post them");
  if (d.reported) parts.push(plural(d.reported, "code") + " the search reported from pages it returned");
  const list = parts.length > 1 ? parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1] : (parts[0] ?? "");
  let line = "";
  if (!d.searched) line = "I did not search the web.";
  else if (d.error) line = "The web search ended early (" + d.error.message.replace(/\.$/, "") + ").";
  else line = "I searched the web for " + d.brand + " codes.";
  line += found ? " Found " + (parts.length > 1 ? plural(found, "code") + ": " + list : list) + "." : " No code posted for " + d.brand + " could be found.";
  if (d.masked) line += " " + plural(d.masked, "code") + " shown masked or behind a button could not be read, so " + (d.masked === 1 ? "it was" : "they were") + " not tested.";
  if (d.dropped) line += " " + plural(d.dropped, "code") + " the search mentioned without a page it had opened " + (d.dropped === 1 ? "was" : "were") + " left out.";
  return line;
}

/**
 * Chat summary of a run: one to four sentences on what was done and what came
 * of it (owner, 2026-10-17). Each code's result stays in the Working card.
 * Built in code, not by the model.
 */
export function couponSummary(o: CouponOutcome, discovery?: DiscoveryInfo): string {
  const money = (v: number): string => formatMoney(v, o.currency);
  const n = o.attempts.filter((a) => !a.combo).length;
  const tested = "**" + plural(n, "code") + "**";
  if (o.status === "no_form" || o.status === "error" || o.status === "no_codes" || o.status === "search_failed" || (o.status === "stopped" && n === 0)) {
    const head = discovery ? discoveryLine(discovery) : "";
    return (head ? head + " " : "") + o.message;
  }
  const found = discovery?.searched ? " found online for " + discovery.brand : "";
  const out: string[] = [];
  if (o.status === "captcha") out.push("I stopped after " + tested + " because the page asked for a CAPTCHA. Complete it yourself, then try again.");
  else if (o.status === "rate_limited") out.push("I stopped after " + tested + " because the store asked to slow down. Try again in a few minutes.");
  if (o.best && o.best.total !== null && o.baseline !== null) {
    const shown = o.best.combo ? "**" + o.best.combo.join("** + **") + "** together" : "**" + o.best.code + "**";
    if (o.status !== "captcha" && o.status !== "rate_limited") out.push("I tested " + tested + found + ".");
    out.push(
      shown + " is the best: your total drops from **" + money(o.baseline) + "** to **" + money(o.best.total) + "** (you save " +
        money(o.baseline - o.best.total) + ", " + percentOff(o.baseline, o.best.total) + ").",
    );
    out.push(o.applied ? "It's applied to your cart, and I didn't go to checkout." : "I couldn't re-apply it, so enter it yourself in the coupon box.");
    if (o.best.conditions) out.push("Conditions seen with it: " + o.best.conditions + ".");
  } else if (o.status === "done" || o.status === "stopped") {
    out.push(
      "I tested " + tested + found + " and none lowered your total" + (o.baseline !== null ? " of " + money(o.baseline) : "") + ", so your cart is unchanged." +
        (o.exhausted ? " I couldn't find any more codes to try." : o.untested > 0 ? " " + o.untested + " more codes were left untested." : ""),
    );
    if (discovery?.error && discovery.error.code !== "stopped") out.push("The web search ended early, so other codes may exist.");
  }
  if (o.note) out.push(o.note);
  return out.join(" ");
}
