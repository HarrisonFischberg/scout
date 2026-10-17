// Sensitive actions (Part 3, spec 8.4): decided on the device by matching the
// action type and its target in the page's accessibility snapshot. The
// server's own opinion of an action ("pre-approved") is never read here, so
// the confirmation shows regardless of what it says. Pure functions over the
// snapshot, no DOM.
import type { SnapElement, Snapshot } from "../snapshot/snapshot";
import { targetsOf, type ScoutAction, type Target } from "./actions";

export const SENSITIVE_KINDS = ["submit", "purchase", "send", "delete", "sign_in", "account", "download"] as const;
export type SensitiveKind = (typeof SENSITIVE_KINDS)[number];

export interface Sensitivity {
  sensitive: boolean;
  kind?: SensitiveKind;
  /** What the confirmation says Scout wants to do, in plain language. */
  description?: string;
}

interface Rule {
  kind: SensitiveKind;
  test: RegExp;
}

// Order matters: the first matching rule names the kind.
const RULES: Rule[] = [
  { kind: "purchase", test: /\b(place\s+(your\s+)?order|buy(\s+now)?|pay(\s+now)?|purchase|complete\s+(order|purchase)|confirm\s+(order|purchase|payment)|check\s*out|subscribe|add\s+payment|donate)\b/i },
  { kind: "sign_in", test: /\b(sign\s*in|log\s*in|login|sign\s*up|register|create\s+(an\s+)?account|continue\s+with\s+(google|apple|facebook|microsoft)|reset\s+password|verify)\b/i },
  { kind: "account", test: /\b(change\s+(password|email|address|plan|settings)|update\s+(account|profile|settings|password|email)|save\s+(changes|settings|profile)|account\s+settings|two[-\s]?factor|security\s+settings|unsubscribe|close\s+account|deactivate|cancel\s+(subscription|plan|membership))\b/i },
  { kind: "delete", test: /\b(delete|remove|erase|discard|clear\s+all|empty\s+(trash|cart)|trash|permanently)\b/i },
  { kind: "send", test: /\b(send|post|publish|reply|tweet|share|comment|submit\s+(message|comment|review|post)|email|message)\b/i },
  { kind: "download", test: /\b(download|export|install|open\s+file|run|save\s+(as|file))\b/i },
  { kind: "submit", test: /\b(submit|apply|confirm|continue|proceed|next\s+step|finish|complete|agree|accept)\b/i },
];

const FILE_HREF = /\.(pdf|zip|dmg|pkg|exe|msi|app|sh|csv|xlsx?|docx?|pptx?|apk|ipa|tar|gz|7z|rar)(\?|#|$)/i;
const PAYMENT_FIELD = /card|cc[-_ ]?(num|number|exp|csc)|cvv|cvc|csc|iban|routing|account\s*number|sort\s*code|expir/i;

const DESCRIBE: Record<SensitiveKind, string> = {
  submit: "submit a form",
  purchase: "place an order or make a payment",
  send: "send or publish something",
  delete: "delete or remove something",
  sign_in: "sign in or create an account",
  account: "change account settings",
  download: "download, install or run a file",
};

function elementOf(snap: Snapshot, t: Target): SnapElement | undefined {
  return t.ref ? snap.elements.find((e) => e.ref === t.ref) : undefined;
}

function nameOf(el: SnapElement | undefined, t: Target): string {
  if (el?.name) return '"' + el.name + '"';
  if (el) return "the " + el.role;
  if (t.x !== undefined) return "the point (" + t.x + ", " + t.y + ")";
  return "an element";
}

function kindOfElement(el: SnapElement): SensitiveKind | null {
  const label = el.name + " " + (el.href ?? "");
  for (const r of RULES) if (r.test.test(label)) return r.kind;
  if (el.href !== undefined && FILE_HREF.test(el.href)) return "download";
  if (el.tag === "input" && el.type === "submit") return "submit";
  return null;
}

/** An activation (click, double click, Enter) of a button, link or submit control. */
function activation(el: SnapElement | undefined, t: Target, verb: string): Sensitivity {
  if (!el) {
    // A coordinate click lands on something the snapshot could not name: ask,
    // since the page's accessibility structure gave no way to check it.
    return t.x !== undefined
      ? { sensitive: true, kind: "submit", description: verb + " " + nameOf(el, t) + ", which the page's structure does not identify" }
      : { sensitive: false };
  }
  const kind = kindOfElement(el);
  if (!kind) return { sensitive: false };
  return { sensitive: true, kind, description: verb + " " + nameOf(el, t) + " to " + DESCRIBE[kind] };
}

/**
 * Decides whether an action needs the user's confirmation and what to tell
 * them. Scroll, wait and screenshot never do. Typing into a password or
 * payment field, pressing Enter in a form field, and activating a control that
 * submits, pays, sends, deletes, signs in, changes account settings or
 * downloads a file always do.
 */
export function classify(action: ScoutAction, snap: Snapshot): Sensitivity {
  switch (action.type) {
    case "wait":
    case "screenshot":
    case "scroll":
    case "scroll_to_element":
      return { sensitive: false };
    case "click":
    case "double_click":
    case "right_click": {
      const el = elementOf(snap, action.target);
      // A context menu on its own changes nothing; what it opens is checked later.
      if (action.type === "right_click") return { sensitive: false };
      return activation(el, action.target, action.type === "double_click" ? "double-click" : "click");
    }
    case "type":
    case "fill_field": {
      const el = elementOf(snap, action.target);
      const text = action.type === "type" ? action.text : action.value;
      if (el?.redacted || (el && PAYMENT_FIELD.test(el.name))) {
        const kind: SensitiveKind = el.type === "password" || /passw|pin|otp|one[-\s]?time/i.test(el.name) ? "sign_in" : "purchase";
        return { sensitive: true, kind, description: "enter text into " + nameOf(el, action.target) + ", a " + (kind === "sign_in" ? "password" : "payment") + " field" };
      }
      // Enter typed into a single-line field submits the form around it.
      if (action.type === "type" && /\n/.test(text) && el?.tag !== "textarea" && el?.inForm) {
        return { sensitive: true, kind: "submit", description: "press Enter in " + nameOf(el, action.target) + ", which submits the form" };
      }
      return { sensitive: false };
    }
    case "key": {
      const key = action.key.toLowerCase();
      const el = action.target ? elementOf(snap, action.target) : undefined;
      if (key === "enter" || key === "return") {
        if (el && el.role !== "textbox" && el.role !== "searchbox" && el.role !== "combobox") return activation(el, action.target!, "activate");
        if (!el || el.inForm) return { sensitive: true, kind: "submit", description: "press Enter" + (el ? " in " + nameOf(el, action.target!) : "") + ", which may submit a form" };
      }
      return { sensitive: false };
    }
    case "drag":
      return { sensitive: false };
  }
}

/** Plain-language line for the action log (spec 8.5), never page text beyond the target's name. */
export function describeAction(action: ScoutAction, snap: Snapshot | null): string {
  const name = (t: Target): string => nameOf(snap ? elementOf(snap, t) : undefined, t);
  switch (action.type) {
    case "click":
      return "Click " + name(action.target);
    case "double_click":
      return "Double-click " + name(action.target);
    case "right_click":
      return "Right-click " + name(action.target);
    case "type":
      return "Type " + action.text.length + (action.text.length === 1 ? " character" : " characters") + " into " + name(action.target);
    case "fill_field":
      return "Fill " + name(action.target);
    case "key":
      return "Press " + action.key + (action.target ? " in " + name(action.target) : "");
    case "scroll":
      return "Scroll " + action.direction + (action.target ? " in " + name(action.target) : "");
    case "scroll_to_element":
      return "Scroll to " + name(action.target);
    case "drag":
      return "Drag " + name(action.from) + " to " + name(action.to);
    case "wait":
      return "Wait " + (action.ms / 1000).toFixed(action.ms % 1000 ? 1 : 0) + " s";
    case "screenshot":
      return "Take a screenshot";
  }
}

/** Sites an action touches: the page itself (links may lead elsewhere, which the next round sees). */
export function hasTarget(action: ScoutAction): boolean {
  return targetsOf(action).length > 0;
}
