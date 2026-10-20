// Safety layer (T011, Part 3 spec 8.4): decides which actions need the user's
// confirmation and when to hard-stop. Pure functions over what the page
// reports for the target (the snapshot element, or the probe for a
// coordinate click), no DOM, so it unit-tests without a browser. The decision
// is made here on the device, by the action type and its target; a server
// "pre-approved" flag never skips it.
import type { Action } from "../actions/executor";
import type { TaskAction } from "../actions/vocabulary";
import type { SnapElement, Snapshot } from "../snapshot/snapshot";

export type SensitiveKind = "payment" | "login" | "send" | "personal_data" | "destructive" | "download" | "account";

export interface Classification {
  sensitive: boolean;
  kind?: SensitiveKind;
  /** Short user-facing reason shown in the confirmation. */
  reason?: string;
}

/** What is known about the element an action targets. */
export interface TargetInfo {
  name: string;
  role?: string;
  tag?: string;
  type?: string;
  href?: string;
  redacted?: boolean;
  inForm?: boolean;
}

export const KIND_LABEL: Record<SensitiveKind, string> = {
  payment: "purchases and payments",
  login: "signing in and passwords",
  send: "sending and posting",
  personal_data: "submitting forms",
  destructive: "deleting",
  download: "downloads",
  account: "account settings",
};

const RULES: Array<{ kind: SensitiveKind; reason: string; test: RegExp }> = [
  {
    kind: "payment",
    reason: "This looks like it places an order or makes a payment.",
    test: /\b(place\s+(your\s+)?order|buy\s+now|pay(\s+now)?|purchase|complete\s+(order|purchase)|confirm\s+(order|purchase|payment)|checkout|subscribe|add\s+payment|donate)\b/i,
  },
  {
    kind: "login",
    reason: "This looks like it signs in, signs up, or changes a password.",
    test: /\b(sign\s*in|log\s*in|login|sign\s*up|register|create\s+account|reset\s+password|change\s+password|new\s+password|log\s*out|sign\s*out)\b/i,
  },
  {
    kind: "destructive",
    reason: "This looks like it deletes or closes something.",
    test: /\b(delete|remove\s+account|close\s+account|deactivate|erase|discard|cancel\s+(subscription|account|order|plan))\b/i,
  },
  {
    kind: "account",
    reason: "This looks like it changes account settings.",
    test: /\b(save\s+(settings|changes|profile|preferences)|update\s+(account|profile|settings|email|address)|change\s+(email|address|plan|settings)|account\s+settings)\b/i,
  },
  {
    kind: "send",
    reason: "This looks like it sends or publishes something.",
    test: /\b(send|post|publish|reply|tweet|share|submit\s+(message|comment|review)|email|comment)\b/i,
  },
  {
    kind: "download",
    reason: "This looks like it downloads or runs a file.",
    test: /\b(download|export|install|open\s+file|run)\b/i,
  },
];

const FILE_HREF = /\.(pdf|zip|dmg|pkg|exe|msi|csv|xlsx?|docx?|apk|sh|ipa)(\?|#|$)/i;

const CAPTCHA = /captcha|not\s+a\s+robot|verify\s+(that\s+)?you\s+are\s+(a\s+)?human|are\s+you\s+a\s+human/i;

export function detectCaptcha(snap: Snapshot): boolean {
  if (CAPTCHA.test(snap.title) || CAPTCHA.test(snap.text)) return true;
  return snap.elements.some((e) => CAPTCHA.test(e.name) || (e.href !== undefined && /captcha/i.test(e.href)));
}

const ACTIVATES = new Set(["click", "double_click", "right_click"]);
const INPUTS = new Set(["type", "fill_field"]);

/** Activating this element (click, Enter) does something sensitive? */
export function classifyActivation(el: TargetInfo): Classification {
  const label = el.name + " " + (el.href ?? "");
  for (const rule of RULES) {
    if (rule.test.test(label)) return { sensitive: true, kind: rule.kind, reason: rule.reason };
  }
  if (el.type === "submit" || (el.role === "button" && el.inForm && /\b(submit|continue|next|apply|save|confirm|go)\b/i.test(el.name))) {
    return { sensitive: true, kind: "personal_data", reason: "This submits a form, which may send personal information." };
  }
  if (el.href !== undefined && FILE_HREF.test(el.href)) {
    return { sensitive: true, kind: "download", reason: "This looks like it downloads a file." };
  }
  return { sensitive: false };
}

/** A snapshot element as the classifier's target description. */
export function targetFromElement(el: SnapElement): TargetInfo {
  return {
    name: el.name,
    role: el.role,
    tag: el.tag,
    ...(el.type !== undefined ? { type: el.type } : {}),
    ...(el.href !== undefined ? { href: el.href } : {}),
    ...(el.redacted ? { redacted: true } : {}),
  };
}

/**
 * Classifies a coupon-finder action (src/actions/executor.ts) by its ref in
 * the snapshot. Navigate, scroll, and wait never need approval; a ref the
 * snapshot lacks acts on nothing, so it needs none either.
 */
export function classifyAction(action: Action, snap: Snapshot): Classification {
  if (action.type === "navigate" || action.type === "scroll" || action.type === "wait") return { sensitive: false };
  const el = snap.elements.find((e) => e.ref === action.ref);
  if (!el) return { sensitive: false };
  if (action.type === "type" || action.type === "select") {
    return el.redacted ? { sensitive: true, kind: "login", reason: "This field holds a password, card number, or similar secret." } : { sensitive: false };
  }
  return classifyActivation(targetFromElement(el));
}

/**
 * Classifies a Scout mode action from what the page reports about its target.
 * Scrolling, waiting, screenshots, dragging, and opening an address never
 * need confirmation (blocked sites are refused before navigate runs).
 * Typing into a password, card, or similar field does; so does Enter inside a
 * form, which submits it. A missing target acts on nothing, so it needs no
 * confirmation either (the executor reports no_target).
 */
export function classifyTaskAction(action: TaskAction, target: TargetInfo | null): Classification {
  if (action.type === "right_click") return { sensitive: false };
  if (ACTIVATES.has(action.type)) {
    if (!target) return { sensitive: false };
    const c = classifyActivation(target);
    // A coordinate click on something the page's structure cannot name: there
    // was no way to check it, so ask (ported from the parallel Part 3 branch).
    const t = (action as { target?: unknown }).target;
    if (!c.sensitive && typeof t === "object" && t !== null && "x" in t && !target.name.trim()) {
      return { sensitive: true, kind: "personal_data", reason: "This clicks something the page's structure does not identify." };
    }
    return c;
  }
  if (INPUTS.has(action.type)) {
    if (target?.redacted) return { sensitive: true, kind: "login", reason: "This field holds a password, card number, or similar secret." };
    return { sensitive: false };
  }
  if (action.type === "key" && action.key === "Enter" && target?.inForm && !/^(textarea)$/i.test(target.tag ?? "")) {
    return { sensitive: true, kind: "personal_data", reason: "Pressing Enter here submits the form." };
  }
  return { sensitive: false };
}
