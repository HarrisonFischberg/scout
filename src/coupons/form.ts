// Finding and working a store's coupon box from a page snapshot (coupon
// finder page path). Pure functions over snapshots, so they unit-test without
// a browser. Every control the finder clicks comes from here, and none may be
// an order, payment, or sign-in control: the safety classifier decides that.
import { classifyAction } from "../safety/classifier";
import type { SnapElement, Snapshot } from "../snapshot/snapshot";

const INPUT_NAME =
  /coupon|promo|discount|voucher|gift\s*card|reduction|code|gutschein|rabatt|c[oó]digo|cup[oó]n|codice|sconto|korting|kupon|rabat|r[eé]duction/i;
const STRONG_INPUT = /coupon|promo|discount|voucher|reduction|gutschein|rabatt|cup[oó]n|sconto|korting|kupon|rabat/i;
// Fields named "code" that are not coupon boxes: never type a coupon there.
const NOT_COUPON_INPUT =
  /zip|postal|post\s*code|postcode|area\s*code|country\s*code|phone|verif|security|one[-\s]?time|sms|access\s*code|tracking|search|e-?mail|referral\s+e-?mail/i;
const TEXT_TYPES = new Set(["text", "search", ""]);
const APPLY_NAME =
  /^(apply|redeem|add|use|anwenden|einl[oö]sen|appliquer|aplicar|applica|toepassen|zastosuj|utiliser|usar|valider)\b|apply\s+(code|coupon|discount|promo)/i;
const NOT_APPLY = /\bto\s+(cart|bag|basket|wish\s*list|order)\b|remove|delete|cancel|clear/i;

// Controls that show a hidden coupon box: "Have a promo code?", "Add discount",
// "Apply a coupon", "Coupon code", a "Gift card or discount code" toggle.
const REVEAL_NAME =
  /\b(?:have|got|add|enter|apply|use|redeem|show)\s+(?:a|an|your)?\s*(?:promo(?:tion(?:al)?)?|coupon|discount|voucher|gift\s*card|offer)|^\W*(?:promo(?:tion(?:al)?)?|coupon|discount|voucher|offer)\s*(?:codes?)?\W*$|(?:discount|promo|coupon)\s+code|enter\s+(?:your|a)\s+code|gift\s*card\s+or\s+discount|gutschein|code\s+promo|c[oó]digo\s+(?:promocional|de\s+descuento)|cup[oó]n|codice\s+sconto|kortingscode/i;
// A collapsed order summary (Shopify checkout on phones) can hold the box.
const SUMMARY_TOGGLE = /order\s+summary|show\s+summary|view\s+summary/i;

// Controls that take an applied code off: they must name the code or a coupon
// word, so "Remove" next to a product is never clicked.
const REMOVE_WORD = /\b(remove|delete|clear|cancel)\b|^[×✕✖x]$/i;
const COUPON_WORD = /coupon|discount|promo|code|voucher|reduction/i;
const REMOVE_HREF = /remove[_-]?coupon|coupon.{0,20}remove|remove.{0,20}(coupon|discount|promo)/i;

// What stores say when a code fails, and when it works.
const REJECT_RE =
  /\b(?:invalid|not\s+(?:a\s+)?valid|isn['’]t\s+(?:a\s+)?valid|expired|not\s+(?:be\s+)?applied|(?:can['’]?t|cannot|could\s*n['’]?o?t|unable\s+to)\s+(?:be\s+)?(?:apply|applied|use|used|find|found|redeem|combine|combined)|does\s*n['’]?o?t\s+exist|doesn['’]t\s+(?:exist|apply)|not\s+(?:found|recogni[sz]ed|eligible|applicable|available|active)|no\s+longer|minimum|enter\s+a\s+valid|incorrect|unknown\s+(?:code|coupon)|ung[uü]ltig|invalide|no\s+(?:es\s+)?v[aá]lido|non\s+valido|ongeldig|nieprawid[lł]owy)/i;
const ACCEPT_RE = /\b(?:applied|added|redeemed|success|activated|you\s+(?:saved?|get))\b/i;
const BUSY_RE = /\b(?:applying|loading|please\s+wait|processing|updating)\b/i;

export interface CouponForm {
  input: SnapElement;
  apply: SnapElement;
}

/** Element names the model picked for a page the rules could not read (see `FormHints`). */
export interface FormHints {
  input?: string;
  apply?: string;
  reveal?: string;
  totalLabel?: string;
}

export function isOrderLike(el: SnapElement, snap: Snapshot): boolean {
  const c = classifyAction({ type: "click", ref: el.ref }, snap);
  return c.sensitive && c.kind !== "personal_data";
}

const isButton = (e: SnapElement): boolean => e.tag === "button" || e.role === "button";

function isTextInput(e: SnapElement): boolean {
  return (e.tag === "input" || e.tag === "textarea") && !e.redacted && !e.disabled && TEXT_TYPES.has(e.type ?? (e.tag === "textarea" ? "" : "text"));
}

/** A link that would leave the page; clicking one is never a way to reveal a box. */
function navigates(e: SnapElement): boolean {
  if (e.tag !== "a") return false;
  const h = (e.href ?? "").trim();
  return h !== "" && !h.startsWith("#") && !/^javascript:/i.test(h);
}

/** The coupon box and its Apply button, or null. `hints` are names the model picked, used when the rules find nothing. */
export function findForm(snap: Snapshot, hints?: FormHints): CouponForm | null {
  const els = snap.elements;
  const inputs = els.filter((e) => isTextInput(e) && INPUT_NAME.test(e.name) && !NOT_COUPON_INPUT.test(e.name));
  let input: SnapElement | undefined = inputs.find((e) => STRONG_INPUT.test(e.name)) ?? inputs[0];
  if (!input && hints?.input) input = els.find((e) => isTextInput(e) && e.name === hints.input);
  if (!input) return null;
  const at = els.indexOf(input);
  const usable = (e: SnapElement): boolean => isButton(e) && !NOT_APPLY.test(e.name) && !isOrderLike(e, snap);
  const named = els.filter((e) => usable(e) && APPLY_NAME.test(e.name.trim()));
  // The box's own button follows it and may stay disabled until a code is
  // typed (Shopify checkout); otherwise the nearest enabled one before it.
  let apply: SnapElement | undefined = named.find((e) => els.indexOf(e) > at) ?? named.filter((e) => !e.disabled).pop();
  if (!apply && hints?.apply) apply = els.find((e) => usable(e) && e.name === hints.apply);
  // An unnamed or icon button right after the box ("→").
  if (!apply) apply = els.slice(at + 1, at + 3).find((e) => usable(e) && e.name.trim().length <= 3);
  return apply ? { input, apply } : null;
}

/** A control that shows a hidden coupon box, best first; never one that leaves the page or orders. */
export function revealTargets(snap: Snapshot, hints?: FormHints): SnapElement[] {
  const ok = (e: SnapElement): boolean =>
    (isButton(e) || e.role === "link" || e.role === "checkbox" || e.role === "tab") && !e.disabled && !navigates(e) && !isOrderLike(e, snap);
  const named = snap.elements.filter((e) => ok(e) && REVEAL_NAME.test(e.name) && !REMOVE_WORD.test(e.name));
  const hinted = hints?.reveal ? snap.elements.filter((e) => ok(e) && e.name === hints.reveal) : [];
  const summary = snap.elements.filter((e) => ok(e) && e.expanded === false && SUMMARY_TOGGLE.test(e.name));
  return [...new Set([...named, ...hinted, ...summary])];
}

/** The control that removes `code` (or any applied coupon) from the order, or null when none is safe to click. */
export function removeTarget(snap: Snapshot, code: string): SnapElement | null {
  const want = code.toUpperCase();
  const candidates = snap.elements.filter(
    (e) =>
      (isButton(e) || e.role === "link") &&
      !e.disabled &&
      (REMOVE_WORD.test(e.name.trim()) || REMOVE_HREF.test(e.href ?? "")) &&
      (e.name.toUpperCase().includes(want) || COUPON_WORD.test(e.name) || REMOVE_HREF.test(e.href ?? "")) &&
      !isOrderLike(e, snap),
  );
  return candidates.find((e) => e.name.toUpperCase().includes(want)) ?? candidates[0] ?? null;
}

/** Lines in `after` that were not in `before`: messages the store just showed. */
export function newLines(before: string, after: string): string {
  const old = new Set(before.split("\n").map((l) => l.trim()));
  return after
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !old.has(l))
    .join("\n");
}

export type StoreReply = "rejected" | "accepted" | "busy" | null;

/** How the store answered, from the messages it just showed. */
export function storeReply(fresh: string): StoreReply {
  if (REJECT_RE.test(fresh)) return "rejected";
  if (BUSY_RE.test(fresh)) return "busy";
  if (ACCEPT_RE.test(fresh)) return "accepted";
  return null;
}

/** Whether `code` still shows on the page (an applied-discount line), as a whole word. */
export function showsCode(text: string, code: string): boolean {
  const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("(^|[^A-Z0-9])" + escaped + "([^A-Z0-9]|$)", "i").test(text);
}
