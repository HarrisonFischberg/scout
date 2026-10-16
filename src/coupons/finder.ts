// Coupon finder (T013): try candidate codes one at a time on the cart page,
// read the real total after each, keep the best, and stop before the order.
// Codes come from the caller (model suggestions today; see activity.md). The
// try loop is plain code, not model-driven, so the page cannot steer it.
import type { Action, ActionResult } from "../actions/executor";
import type { AgentControl } from "../agent/loop";
import { classifyAction, detectCaptcha } from "../safety/classifier";
import type { SnapElement, Snapshot } from "../snapshot/snapshot";

export interface CouponPage {
  snapshot(): Promise<Snapshot>;
  act(action: Action): Promise<ActionResult>;
}

export interface CouponAttempt {
  code: string;
  /** Total read from the page after applying the code, or null if unreadable. */
  total: number | null;
  /** Baseline total minus this total; 0 means no saving. */
  saving: number | null;
  note: string;
}

export type CouponStatus = "done" | "no_form" | "no_codes" | "captcha" | "stopped" | "error";

export interface CouponOutcome {
  status: CouponStatus;
  baseline: number | null;
  attempts: CouponAttempt[];
  best?: CouponAttempt;
  /** True when the best code was re-applied and the page total matched. */
  applied: boolean;
  message: string;
}

export const MAX_CODES = 10;
const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{2,19}$/;
// Words a model tends to put in capitals that are not codes.
const STOPWORDS = new Set(["NONE", "N/A", "CODE", "CODES", "COUPON", "SORRY", "NOTE", "THE", "AND"]);
const INPUT_NAME = /coupon|promo|discount|voucher|gift\s*card|code/i;
const APPLY_NAME = /^(apply|redeem|add|use)\b|apply\s+(code|coupon)/i;
const TOTAL_RE = /(?:^|[^a-z])(?:order\s+|grand\s+|new\s+)?total\b[^$\d\n]{0,20}\$\s*([\d,]+(?:\.\d{1,2})?)/gi;

/** Candidate codes from free text: one per token, upper-cased, deduped, capped. */
export function parseCodes(text: string, max = MAX_CODES): string[] {
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
  const input = snap.elements.find(
    (e) => e.tag === "input" && !e.redacted && !e.disabled && e.type !== "password" && INPUT_NAME.test(e.name),
  );
  if (!input) return null;
  // Never the order button: payment, login, and similar targets are refused.
  const apply = snap.elements.find(
    (e) =>
      (e.tag === "button" || e.role === "button") &&
      !e.disabled &&
      APPLY_NAME.test(e.name.trim()) &&
      !isOrderLike(e, snap),
  );
  return apply ? { input, apply } : null;
}

/** Largest positive saving; the earliest code wins ties. */
export function bestOf(attempts: CouponAttempt[]): CouponAttempt | undefined {
  let best: CouponAttempt | undefined;
  for (const a of attempts) {
    if (a.saving !== null && a.saving > 0 && (!best || a.saving > (best.saving ?? 0))) best = a;
  }
  return best;
}

export interface CouponInput {
  page: CouponPage;
  codes: string[];
  control?: AgentControl;
  signal?: AbortSignal;
  settleMs?: number;
  onAttempt?: (a: CouponAttempt) => void;
}

export async function runCouponSearch(input: CouponInput): Promise<CouponOutcome> {
  const { page, control, signal } = input;
  const attempts: CouponAttempt[] = [];
  const stop = (status: CouponStatus, message: string, baseline: number | null = null): CouponOutcome => {
    const best = bestOf(attempts);
    return { status, baseline, attempts, ...(best ? { best } : {}), applied: false, message };
  };
  const halted = (): boolean => control?.isStopped === true || signal?.aborted === true;

  let snap: Snapshot;
  try {
    snap = await page.snapshot();
  } catch {
    return stop("error", "Could not read the page.");
  }
  if (detectCaptcha(snap)) return stop("captcha", "Stopped: the page asks for a CAPTCHA. Complete it yourself.");
  const form = findForm(snap);
  if (!form) return stop("no_form", "No coupon box found on this page. Open the cart or checkout page first.");
  const baseline = parseTotal(snap.text);
  if (baseline === null) return stop("error", "Could not read a total on this page, so savings cannot be measured.");
  const codes = [...new Set(input.codes.map((c) => c.trim().toUpperCase()).filter((c) => CODE_RE.test(c)))].slice(
    0,
    MAX_CODES,
  );
  if (codes.length === 0) return stop("no_codes", "No codes to try.", baseline);

  // Each reading is compared to the baseline, so a code that did nothing shows
  // saving 0. Returns the post-apply snapshot for the CAPTCHA check.
  const tryCode = async (code: string): Promise<{ attempt: CouponAttempt; after?: Snapshot }> => {
    const typed = await page.act({ type: "type", ref: form.input.ref, text: code, clear: true });
    if (!typed.ok) return { attempt: { code, total: null, saving: null, note: "Could not type the code: " + typed.message } };
    const clicked = await page.act({ type: "click", ref: form.apply.ref });
    if (!clicked.ok) return { attempt: { code, total: null, saving: null, note: "Could not press Apply: " + clicked.message } };
    await page.act({ type: "wait", ms: input.settleMs ?? 400 });
    let after: Snapshot;
    try {
      after = await page.snapshot();
    } catch {
      return { attempt: { code, total: null, saving: null, note: "Could not read the page after applying." } };
    }
    const total = parseTotal(after.text);
    if (total === null) return { attempt: { code, total: null, saving: null, note: "Total not readable after applying." }, after };
    const saving = Math.round((baseline - total) * 100) / 100;
    return {
      attempt: { code, total, saving, note: saving > 0 ? "Saved $" + saving.toFixed(2) + "." : "No saving." },
      after,
    };
  };

  for (const code of codes) {
    await control?.gate();
    if (halted()) return stop("stopped", "Stopped.", baseline);
    const { attempt, after } = await tryCode(code);
    attempts.push(attempt);
    input.onAttempt?.(attempt);
    // A CAPTCHA appearing mid-run is a hard stop; never solved or bypassed.
    if (after && detectCaptcha(after)) {
      return stop("captcha", "Stopped: the page asks for a CAPTCHA. Complete it yourself.", baseline);
    }
  }

  const best = bestOf(attempts);
  if (!best || best.total === null || best.saving === null) {
    return { status: "done", baseline, attempts, applied: false, message: "No code lowered the total." };
  }
  // Re-apply the winner: later attempts replaced it in the box. Verified by a
  // fresh read, never assumed. The order button is never touched.
  const again = await tryCode(best.code);
  const applied = again.attempt.total !== null && again.attempt.total <= best.total + 0.005;
  return {
    status: "done",
    baseline,
    attempts,
    best,
    applied,
    message: applied
      ? "Best code " + best.code + " applied: total $" + best.total.toFixed(2) + ". Review the cart and place the order yourself."
      : "Best code " + best.code + " would save $" + best.saving.toFixed(2) + " but could not be re-applied. Enter it yourself.",
  };
}
