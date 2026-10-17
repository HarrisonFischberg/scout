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
import { detectCaptcha } from "../safety/classifier";
import type { Snapshot } from "../snapshot/snapshot";
import { CODE_RE, originLabel, type CandidateOrigin, type CouponCandidate } from "./candidates";
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

export const BATCH_SIZE = 25;
export const MAX_TOTAL = 200;
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

interface TryResult {
  total: number | null;
  accepted: boolean | null;
  note?: string;
  captcha?: boolean;
  rateLimited?: boolean;
  /** No further code can be measured on this page; `note` says why. */
  halt?: boolean;
}

interface Tester {
  method: string;
  baseline: number;
  currency?: string;
  tryCode(code: string): Promise<TryResult>;
  /** Applies one code (or "" to clear) and returns the confirmed total. */
  apply(code: string): Promise<number | null>;
  /** Leaves the cart as the user expects: winner applied, or original codes back. */
  finish(winner: string | null): Promise<void>;
}

async function cartTester(cart: CartApi): Promise<Tester | null> {
  const start = await cart.info();
  // Only a real cart (numeric total) counts; anything else falls back to the page path.
  if (!start || typeof start.total !== "number" || !Array.isArray(start.codes)) return null;
  const original = start.codes.map((c) => c.code).join(",");
  return {
    method: start.platform ?? "shopify",
    baseline: start.total,
    ...(start.currency ? { currency: start.currency } : {}),
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

/** How long to wait for a store after pressing Apply (or a toggle), and how often to look. */
export interface SettleTimes {
  /** With no word from the store, a code that changed nothing is judged after this. */
  quietMs: number;
  /** Upper bound while the store says it is working or that the code applied. */
  maxMs: number;
}
const POLL_MS = 300;
const MIN_QUIET_MS = 600;
const EPS = 0.004;
const KEPT_NOTE = "The store kept the earlier code on the order and shows no remove button I can use safely, so I stopped testing there.";

async function pageTester(
  page: CouponPage,
  times: SettleTimes,
  locate?: (snap: Snapshot) => Promise<FormHints | null>,
): Promise<Tester | { error: CouponStatus; message: string }> {
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
  if (!opened) return { error: "no_form", message: "No coupon box found on this page. Open the cart or checkout page first." };
  const base = totalOf(opened.snap);
  if (!base) return { error: "error", message: "Could not read a total on this page, so savings cannot be measured." };
  const baseline = base.amount;

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
    // Measure codes one at a time: take the last working code off first.
    if (kept) {
      const off = await takeOff(before, kept.code);
      if (off === null) return { total: null, accepted: null, halt: true, note: KEPT_NOTE };
      if (off !== "none") {
        before = off;
        kept = null;
      }
    }
    const box = await open(before);
    if (!box) return { total: null, accepted: null, ...(kept ? { halt: true, note: KEPT_NOTE } : { note: "The coupon box is gone." }) };
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
    // The earlier code is still on (same total, or still listed) and nothing could
    // take it off: this total would count both codes, so stop measuring here.
    if (kept && kept.code !== code && (Math.abs(total - kept.total) <= EPS || showsCode(after.text, kept.code))) {
      return { total: null, accepted: null, halt: true, note: KEPT_NOTE };
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
  /** Page path: how long a code that changed nothing gets before it counts as no saving (default 2500 ms). */
  settleMs?: number;
  /** Page path: longest wait while the store says it is applying the code (default 8000 ms). */
  maxSettleMs?: number;
  /** Page path: asks the model which controls are the coupon box, Apply, and the total, when the rules find none. */
  locate?: (snap: Snapshot) => Promise<FormHints | null>;
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
  /** `currency` as the store prints it, for showing amounts. */
  onAttempt?: (a: CouponAttempt, index: number, total: number, currency?: string) => void;
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

  const viaCart = input.page.cart ? await cartTester(input.page.cart).catch(() => null) : null;
  const quietMs = input.settleMs ?? 2500;
  const tester = viaCart ?? (await pageTester(input.page, { quietMs, maxMs: Math.max(input.maxSettleMs ?? 8000, quietMs) }, input.locate));
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
      const saving = r.total === null ? null : Math.round((baseline - r.total) * 100) / 100;
      const note =
        r.note ??
        (r.accepted === false
          ? "Not accepted by the store."
          : saving !== null && saving > 0
            ? "Saves " + formatMoney(saving, tester.currency) + "."
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
      input.onAttempt?.(attempt, attempts.length, codes.length, tester.currency);
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


const percentOff = (baseline: number, total: number): string => {
  const p = baseline > 0 ? ((baseline - total) / baseline) * 100 : 0;
  return p >= 1 ? Math.round(p) + "% off" : "under 1% off";
};

/** Chat summary of a run, in the same plain style as other answers. Built in code, not by the model. */
export function couponSummary(o: CouponOutcome): string {
  const money = (v: number): string => formatMoney(v, o.currency);
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
  if (o.note) lines.push("", o.note);
  if (o.best) lines.push("", "Checkout can still change the final price, for example tax, shipping, or whether the code applies to later orders.");
  return lines.join("\n");
}
