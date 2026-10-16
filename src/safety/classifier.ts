// Safety layer (T011): decides which agent actions need user approval and
// when to hard-stop. Pure functions over the snapshot, no DOM, so it unit-tests
// without a browser. The loop denies a sensitive action unless approved.
import type { Action } from "../actions/executor";
import type { SnapElement, Snapshot } from "../snapshot/snapshot";

export type SensitiveKind = "payment" | "login" | "send" | "personal_data" | "destructive" | "download";

export interface Classification {
  sensitive: boolean;
  kind?: SensitiveKind;
  /** Short user-facing reason shown in the approval sheet. */
  reason?: string;
}

const RULES: Array<{ kind: SensitiveKind; reason: string; test: RegExp }> = [
  {
    kind: "payment",
    reason: "This looks like it places an order or makes a payment.",
    test: /\b(place\s+(your\s+)?order|buy\s+now|pay(\s+now)?|purchase|complete\s+(order|purchase)|confirm\s+(order|purchase|payment)|checkout|subscribe)\b/i,
  },
  {
    kind: "login",
    reason: "This looks like it signs in or changes a password.",
    test: /\b(sign\s*in|log\s*in|login|sign\s*up|register|create\s+account|reset\s+password)\b/i,
  },
  {
    kind: "destructive",
    reason: "This looks like it deletes or closes something.",
    test: /\b(delete|remove\s+account|close\s+account|deactivate|erase|cancel\s+(subscription|account|order))\b/i,
  },
  {
    kind: "send",
    reason: "This looks like it sends or publishes something.",
    test: /\b(send|post|publish|reply|tweet|share|submit\s+(message|comment|review)|email)\b/i,
  },
  {
    kind: "download",
    reason: "This looks like it downloads a file.",
    test: /\b(download|export)\b/i,
  },
];

const CAPTCHA = /captcha|not\s+a\s+robot|verify\s+(that\s+)?you\s+are\s+(a\s+)?human|are\s+you\s+a\s+human/i;

export function detectCaptcha(snap: Snapshot): boolean {
  if (CAPTCHA.test(snap.title) || CAPTCHA.test(snap.text)) return true;
  return snap.elements.some((e) => CAPTCHA.test(e.name) || (e.href !== undefined && /captcha/i.test(e.href)));
}

function classifyElement(action: Action, el: SnapElement): Classification {
  const typing = action.type === "type" || action.type === "select";
  if (typing && el.redacted) {
    return { sensitive: true, kind: "login", reason: "This field holds a password, card number, or similar secret." };
  }
  if (typing) return { sensitive: false };
  const label = el.name + " " + (el.href ?? "");
  for (const rule of RULES) {
    if (rule.test.test(label)) return { sensitive: true, kind: rule.kind, reason: rule.reason };
  }
  if (el.type === "submit") {
    return {
      sensitive: true,
      kind: "personal_data",
      reason: "This submits a form, which may send personal information.",
    };
  }
  if (el.href !== undefined && /\.(pdf|zip|dmg|pkg|exe|csv|xlsx?|docx?)(\?|#|$)/i.test(el.href)) {
    return { sensitive: true, kind: "download", reason: "This looks like it downloads a file." };
  }
  return { sensitive: false };
}

/**
 * Navigate, scroll, and wait never need approval. A ref the snapshot lacks acts
 * on nothing (the executor reports no_ref), so it needs no approval either.
 */
export function classifyAction(action: Action, snap: Snapshot): Classification {
  if (action.type === "navigate" || action.type === "scroll" || action.type === "wait") return { sensitive: false };
  const el = snap.elements.find((e) => e.ref === action.ref);
  return el ? classifyElement(action, el) : { sensitive: false };
}
