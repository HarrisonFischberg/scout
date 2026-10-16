// Coupon finder (T013, T031): try candidate codes one at a time against the
// real cart, keep the best, apply it, and never touch checkout. The try loop is
// plain code, not model-driven, so page content cannot steer it.
//
// Two ways to test a code:
//   shopify - the store's own cart endpoint (/cart/update.js), the same one its
//             Apply button uses, in the user's session. Fast and exact.
//   page    - type the code in the page's coupon box, press Apply, read the total.
// Codes are tested in batches (default 25). Owner, 2026-10-16: after a batch,
// a code that saves money is applied and the search ends; only when none does
// is the user asked whether to find and test 25 more.
import type { Action, ActionResult } from "../actions/executor";
import type { AgentControl } from "../agent/loop";
import { classifyAction, detectCaptcha } from "../safety/classifier";
import type { SnapElement, Snapshot } from "../snapshot/snapshot";
import { CODE_RE, originLabel, type CandidateOrigin, type CouponCandidate } from "./candidates";

export type { CouponCandidate } from "./candidates";

export interface CartState {
  /** Cart total in the store currency, already including any applied code. */
  total: number;
  currency: string | null;
  codes: Array<{ code: string; applicable: boolean }>;
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
  code: string;
  origin: CandidateOrigin;
  sourceUrl?: string;
  /** Total after applying the code, or null if unreadable. */
  total: number | null;
  /** Baseline total minus this total; 0 means no saving. */
  saving: number | null;
  /** Shopify: whether the store accepted the code. Page path: unknown (null). */
  accepted: boolean | null;
  note: string;
}

export type CouponStatus = "done" | "no_form" | "no_codes" | "captcha" | "stopped" | "rate_limited" | "error";

// Plain-language status line for the popup; never shows the internal code.
export function couponStatusText(status: CouponStatus): string {
  switch (status) {
    case "done": return "Coupon search finished.";
    case "no_form": return "Coupon search stopped: no coupon box on this page.";
    case "no_codes": return "Coupon search found no codes to try.";
    case "captcha": return "Coupon search stopped at a CAPTCHA.";
    case "stopped": return "Coupon search stopped.";
    case "rate_limited": return "Coupon search paused: the store asked to slow down.";
    case "error": return "Coupon search failed. Nothing was ordered.";
  }
}

export interface CouponOutcome {
  status: CouponStatus;
  method: "shopify" | "page" | null;
  baseline: number | null;
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

export const BATCH_SIZE = 25;
export const MAX_TOTAL = 200;
const INPUT_NAME = /coupon|promo|discount|voucher|gift\s*card|reduction|code/i;
const STRONG_INPUT = /coupon|promo|discount|voucher|reduction/i;
// Fields named "code" that are not coupon boxes: never type a coupon there.
const NOT_COUPON_INPUT = /zip|postal|post\s*code|area\s*code|country\s*code|phone|verif|security|one[-\s]?time|sms|access\s*code|tracking/i;
const TEXT_TYPES = new Set(["text", "search", ""]);
const APPLY_NAME = /^(apply|redeem|add|use)\b|apply\s+(code|coupon|discount)/i;
const NOT_APPLY = /\bto\s+(cart|bag|basket|wish\s*list|order)\b/i;
// "Total" then up to one line of words (a currency code, "1 item") before the
// amount; "Total savings" and "Total discount" are not the total.
const TOTAL_RE =
  /(?:^|[^a-z])(?:order\s+|grand\s+|new\s+)?total\b(?!\s*(?:savings?|saved|discounts?|off)\b)[^$\d]{0,24}?(?:\d+\s+items?\b[^$\d]{0,12}?)?\$\s*([\d,]+(?:\.\d{1,2})?)/gi;
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

/** Last "Total: $x" on the page that is not a subtotal, in dollars. */
export function parseTotal(text: string): number | null {
  let last: number | null = null;
  for (const m of text.matchAll(TOTAL_RE)) {
    const n = Number((m[1] ?? "").replace(/,/g, ""));
    if (Number.isFinite(n)) last = n;
  }
  return last;
}

function isOrderLike(el: SnapElement, snap: Snapshot): boolean {
  const c = classifyAction({ type: "click", ref: el.ref }, snap);
  return c.sensitive && c.kind !== "personal_data";
}

function findForm(snap: Snapshot): { input: SnapElement; apply: SnapElement } | null {
  const inputs = snap.elements.filter(
    (e) =>
      e.tag === "input" &&
      !e.redacted &&
      !e.disabled &&
      TEXT_TYPES.has(e.type ?? "text") &&
      INPUT_NAME.test(e.name) &&
      !NOT_COUPON_INPUT.test(e.name),
  );
  const input = inputs.find((e) => STRONG_INPUT.test(e.name)) ?? inputs[0];
  if (!input) return null;
  const at = snap.elements.indexOf(input);
  // Never the order button: payment, login, and similar targets are refused.
  const buttons = snap.elements.filter(
    (e) =>
      (e.tag === "button" || e.role === "button") &&
      APPLY_NAME.test(e.name.trim()) &&
      !NOT_APPLY.test(e.name) &&
      !isOrderLike(e, snap),
  );
  // The box's own button follows it and may stay disabled until a code is
  // typed (Shopify checkout); otherwise the nearest enabled one before it.
  const apply = buttons.find((e) => snap.elements.indexOf(e) > at) ?? buttons.filter((e) => !e.disabled).pop();
  return apply ? { input, apply } : null;
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

interface TryResult {
  total: number | null;
  accepted: boolean | null;
  note?: string;
  captcha?: boolean;
  rateLimited?: boolean;
}

interface Tester {
  method: "shopify" | "page";
  baseline: number;
  tryCode(code: string): Promise<TryResult>;
  /** Applies one code (or "" to clear) and returns the confirmed total. */
  apply(code: string): Promise<number | null>;
  /** Leaves the cart as the user expects: winner applied, or original codes back. */
  finish(winner: string | null): Promise<void>;
}

async function shopifyTester(cart: CartApi): Promise<Tester | null> {
  const start = await cart.info();
  // Only a real cart (numeric total) counts; anything else falls back to the page path.
  if (!start || typeof start.total !== "number" || !Array.isArray(start.codes)) return null;
  const original = start.codes.map((c) => c.code).join(",");
  return {
    method: "shopify",
    baseline: start.total,
    async tryCode(code) {
      const r = await cart.update(code);
      if (!r) return { total: null, accepted: null, note: "The store did not answer." };
      if ("rateLimited" in r) return { total: null, accepted: null, rateLimited: true, note: "The store asked to slow down." };
      const hit = r.codes.find((c) => c.code.toUpperCase() === code.toUpperCase());
      return { total: r.total, accepted: hit ? hit.applicable : false };
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

async function pageTester(page: CouponPage, settleMs: number): Promise<Tester | { error: CouponStatus; message: string }> {
  let snap: Snapshot;
  try {
    snap = await page.snapshot();
  } catch {
    return { error: "error", message: "Could not read the page." };
  }
  if (detectCaptcha(snap)) return { error: "captcha", message: "Stopped: the page asks for a CAPTCHA. Complete it yourself." };
  if (!findForm(snap)) return { error: "no_form", message: "No coupon box found on this page. Open the cart or checkout page first." };
  const baseline = parseTotal(snap.text);
  if (baseline === null) return { error: "error", message: "Could not read a total on this page, so savings cannot be measured." };
  // Refs last one snapshot, and the page changes after each code, so look again each time.
  const look = async (): Promise<Snapshot | null> => {
    try {
      return await page.snapshot();
    } catch {
      return null;
    }
  };
  const tryCode = async (code: string): Promise<TryResult> => {
    const before = await look();
    if (!before) return { total: null, accepted: null, note: "Could not read the page." };
    if (detectCaptcha(before)) return { total: null, accepted: null, captcha: true };
    const form = findForm(before);
    if (!form) return { total: null, accepted: null, note: "The coupon box is gone." };
    const typed = await page.act({ type: "type", ref: form.input.ref, text: code, clear: true });
    if (!typed.ok) return { total: null, accepted: null, note: "Could not type the code: " + typed.message };
    // Some stores enable Apply only once a code is typed.
    const ready = await look();
    const now = ready ? findForm(ready) : null;
    if (!now || now.apply.disabled) return { total: null, accepted: null, note: "The Apply button stayed disabled." };
    const clicked = await page.act({ type: "click", ref: now.apply.ref });
    if (!clicked.ok) return { total: null, accepted: null, note: "Could not press Apply: " + clicked.message };
    await page.act({ type: "wait", ms: settleMs });
    const after = await look();
    if (!after) return { total: null, accepted: null, note: "Could not read the page after applying." };
    if (detectCaptcha(after)) return { total: null, accepted: null, captcha: true };
    const total = parseTotal(after.text);
    return total === null ? { total: null, accepted: null, note: "Total not readable after applying." } : { total, accepted: null };
  };
  return {
    method: "page",
    baseline,
    tryCode,
    async apply(code) {
      return (await tryCode(code)).total;
    },
    async finish() {
      // The page path cannot clear a typed code reliably; the last one stays in the box.
    },
  };
}

export interface BatchState {
  tried: number;
  /** Codes already found and not yet tried. */
  remaining: number;
  /** How many the next batch tests; when few remain, more are searched for first. */
  next: number;
}

export interface CouponInput {
  page: CouponPage;
  codes: CouponCandidate[];
  control?: AgentControl;
  signal?: AbortSignal;
  settleMs?: number;
  /** Pause between codes, to be gentle with the store. */
  delayMs?: number;
  batchSize?: number;
  /**
   * Asked after a batch in which no code saved money, while codes remain or
   * more can be found; false stops. Absent: test every code given, no prompt.
   */
  askMore?: (s: BatchState) => Promise<boolean>;
  /** Finds codes not in `known` (new web search, more guesses). Used only after askMore says yes. */
  findMore?: (known: string[]) => Promise<CouponCandidate[]>;
  onAttempt?: (a: CouponAttempt, index: number, total: number) => void;
}

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

  const shopify = input.page.cart ? await shopifyTester(input.page.cart).catch(() => null) : null;
  const tester = shopify ?? (await pageTester(input.page, input.settleMs ?? 400));
  if ("error" in tester) {
    return { status: tester.error, method: null, baseline: null, attempts, applied: false, untested: codes.length, message: tester.message };
  }
  const baseline = tester.baseline;
  const result = (status: CouponStatus, message: string, extra: Partial<CouponOutcome> = {}): CouponOutcome => {
    const best = bestOf(attempts);
    return {
      status,
      method: tester.method,
      baseline,
      attempts,
      ...(best ? { best } : {}),
      applied: false,
      untested: codes.length - attempts.length,
      message,
      ...extra,
    };
  };
  if (codes.length === 0) return result("no_codes", "No codes to try.");

  const size = Math.max(1, input.batchSize ?? BATCH_SIZE);
  let stoppedEarly: CouponStatus | null = null;
  let exhausted = false;
  let i = 0;
  outer: while (i < codes.length) {
    const batch = codes.slice(i, i + size);
    for (const cand of batch) {
      await control?.gate();
      if (halted()) {
        stoppedEarly = "stopped";
        break outer;
      }
      const r = await tester.tryCode(cand.code);
      if (r.captcha) {
        // Recorded so the user sees which code was being tried; then a hard stop.
        const attempt: CouponAttempt = {
          code: cand.code,
          origin: cand.origin,
          ...(cand.sourceUrl ? { sourceUrl: cand.sourceUrl } : {}),
          total: null,
          saving: null,
          accepted: null,
          note: "The page asked for a CAPTCHA.",
        };
        attempts.push(attempt);
        input.onAttempt?.(attempt, attempts.length, codes.length);
        stoppedEarly = "captcha";
        break outer;
      }
      if (r.rateLimited) {
        stoppedEarly = "rate_limited";
        break outer;
      }
      const saving = r.total === null ? null : Math.round((baseline - r.total) * 100) / 100;
      const note =
        r.note ??
        (r.accepted === false
          ? "Not accepted by the store."
          : saving !== null && saving > 0
            ? "Saves $" + saving.toFixed(2) + "."
            : r.accepted
              ? "Accepted, but no lower total."
              : "No saving.");
      const attempt: CouponAttempt = {
        code: cand.code,
        origin: cand.origin,
        ...(cand.sourceUrl ? { sourceUrl: cand.sourceUrl } : {}),
        total: r.total,
        saving,
        accepted: r.accepted,
        note,
      };
      attempts.push(attempt);
      input.onAttempt?.(attempt, attempts.length, codes.length);
      if (input.delayMs) await new Promise((res) => setTimeout(res, input.delayMs));
    }
    i += batch.length;
    // A code that saves money ends the search; the best one is applied below.
    if (bestOf(attempts)) break;
    if (!input.askMore) continue;
    const canFind = input.findMore !== undefined && codes.length < MAX_TOTAL;
    if (i >= codes.length && !canFind) break;
    const next = canFind ? size : Math.min(size, codes.length - i);
    const more = await input.askMore({ tried: i, remaining: codes.length - i, next });
    if (!more || halted()) break;
    if (canFind && codes.length - i < size) {
      add(await input.findMore!(codes.map((c) => c.code)).catch(() => []));
      if (halted()) {
        stoppedEarly = "stopped";
        break;
      }
      if (i >= codes.length) exhausted = true;
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
  return result(stoppedEarly ?? "done", applied ? "Best code " + best.code + " applied." : "Best code " + best.code + " could not be re-applied.", { applied });
}

const money = (n: number): string => "$" + n.toFixed(2);
const percentOff = (baseline: number, total: number): string => {
  const p = baseline > 0 ? ((baseline - total) / baseline) * 100 : 0;
  return p >= 1 ? Math.round(p) + "% off" : "under 1% off";
};

/** Chat summary of a run, in the same plain style as other answers. Built in code, not by the model. */
export function couponSummary(o: CouponOutcome): string {
  const n = o.attempts.length;
  const tested = "**" + n + " code" + (n === 1 ? "" : "s") + "**";
  const lines: string[] = [];
  if (o.status === "no_form" || o.status === "error" || o.status === "no_codes") return o.message;
  if (o.status === "captcha") lines.push("I stopped after " + tested + " because the page asked for a CAPTCHA. Complete it yourself, then try again.");
  else if (o.status === "rate_limited") lines.push("I stopped after " + tested + " because the store asked to slow down. Try again in a few minutes.");
  if (o.best && o.best.total !== null && o.baseline !== null) {
    const head =
      "I tested " + tested + ". **" + o.best.code + "** is the best: your total drops from **" + money(o.baseline) + "** to **" +
      money(o.best.total) + "** (you save " + money(o.baseline - o.best.total) + ", " + percentOff(o.baseline, o.best.total) + ").";
    lines.unshift(
      head +
        (o.applied ? " It's applied to your cart, and I didn't go to checkout." : " I couldn't re-apply it, so enter it yourself in the coupon box."),
    );
  } else if (o.status === "done" || o.status === "stopped") {
    lines.unshift(
      "I tested " + tested + " and none lowered your total" + (o.baseline !== null ? " of " + money(o.baseline) : "") + "." +
        (o.exhausted
          ? " I couldn't find any more codes to try."
          : o.untested > 0
            ? " " + o.untested + " more codes were left untested."
            : ""),
    );
  }
  const worked = o.attempts.filter((a) => a.saving !== null && a.saving > 0 && a.accepted !== false).sort((a, b) => (b.saving ?? 0) - (a.saving ?? 0));
  if (worked.length) {
    lines.push("", "| Code | Result | Where it came from |", "|---|---|---|");
    for (const a of worked) {
      const where = a.sourceUrl && (a.origin === "sourced" || a.origin === "unverified") ? "[" + originLabel(a) + "](" + a.sourceUrl + ")" : originLabel(a);
      lines.push("| " + a.code + " | saves " + money(a.saving ?? 0) + ", total " + money(a.total ?? 0) + " | " + where + " |");
    }
  }
  const failed = o.attempts.filter((a) => !worked.includes(a));
  if (failed.length) {
    const named = failed.filter((a) => a.origin === "sourced" || a.origin === "unverified").map((a) => a.code);
    const guesses = failed.length - named.length;
    const parts: string[] = [];
    if (named.length) parts.push(named.slice(0, 8).join(", ") + (named.length > 8 ? " and " + (named.length - 8) + " more found online" : ""));
    if (guesses) parts.push(guesses + " guessed code" + (guesses === 1 ? "" : "s"));
    lines.push("", "Didn't work: " + parts.join(", plus ") + ".");
  }
  if (o.best) lines.push("", "Checkout can still change the final price, for example tax, shipping, or whether the code applies to later orders.");
  return lines.join("\n");
}
