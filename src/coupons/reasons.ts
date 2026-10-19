// Why the store turned a code down, in its own words (owner request
// 2026-10-19, from a run of another tool on Birdcall: "only valid Tuesday",
// "not active yet", "used up", "only at the Cherrywood Square store",
// "expired"). The words come from the message the store showed right after
// Apply; the kind groups them for the summary and steers the next search
// (mostly expired codes -> look for this month's promotions).

export type RejectKind = "expired" | "not_yet" | "used" | "schedule" | "location" | "minimum" | "items" | "combine" | "account" | "invalid" | "other";

const KINDS: Array<[RejectKind, RegExp]> = [
  ["not_yet", /\b(?:not\s+(?:yet\s+)?(?:active|started|begun)\s*yet|not\s+active\s+yet|not\s+yet\s+(?:active|valid|available)|starts?\s+on|begins?\s+on|upcoming)\b/i],
  ["expired", /\b(?:expired|no\s+longer\s+(?:valid|active|available)|has\s+ended|ended\s+on)\b/i],
  ["used", /\b(?:already\s+(?:been\s+)?(?:used|redeemed|applied)|used\s+up|usage\s+limit|limit\s+(?:has\s+been\s+)?reached|maximum\s+(?:number\s+of\s+)?uses|once\s+per\s+customer|one\s+use)\b/i],
  ["schedule", /\b(?:only\s+(?:valid|available|redeemable)\s+(?:on|during|between|from)|(?:mon|tues|wednes|thurs|fri|satur|sun)days?\b|happy\s+hour|between\s+\d)/i],
  ["location", /\b(?:only\s+(?:valid|available)\s+at|this\s+(?:location|store|restaurant)|participating\s+(?:locations?|stores?)|other\s+locations?|not\s+valid\s+at)\b/i],
  ["minimum", /\b(?:minimum|at\s+least|spend\s+(?:\$|€|£)?\d|orders?\s+(?:of|over|above)\s+(?:\$|€|£)?\d)\b/i],
  ["items", /\b(?:(?:not\s+)?(?:valid|eligible|applicable)\s+(?:for|on|with)\s+(?:the\s+)?(?:items?|products?|this\s+item|subscription|sale)|no\s+eligible|excluded|qualifying\s+(?:items?|products?))\b/i],
  ["combine", /\b(?:combin|stack|another\s+(?:discount|code|coupon)|one\s+(?:discount|code|coupon)\s+per)/i],
  ["account", /\b(?:sign\s*in|log\s*in|account|members?\s+only|new\s+customers?\s+only|first\s+(?:order|purchase)\s+only|email)\b/i],
  ["invalid", /\b(?:invalid|not\s+(?:a\s+)?valid|isn['’]t\s+(?:a\s+)?valid|does\s*n['’]?o?t\s+exist|doesn['’]t\s+exist|not\s+(?:found|recogni[sz]ed)|unknown|incorrect|enter\s+a\s+valid|ung[uü]ltig|invalide|no\s+(?:es\s+)?v[aá]lido|non\s+valido|ongeldig)\b/i],
];

/** The group a store's message belongs to; "other" when none fits. */
export function rejectKind(message: string): RejectKind {
  for (const [kind, re] of KINDS) if (re.test(message)) return kind;
  return "other";
}

/** Plain words for each group, as the summary lists them. */
export const KIND_LABEL: Record<RejectKind, string> = {
  expired: "Expired",
  not_yet: "Not active yet",
  used: "Already used or used up",
  schedule: "Only on certain days or times",
  location: "Only at another location",
  minimum: "Needs a bigger order",
  items: "Not valid for these items",
  combine: "Can't be combined",
  account: "Needs an account or a first order",
  invalid: "Not a code this store knows",
  other: "Turned down for another reason",
};

const MAX_MESSAGE = 140;

/**
 * The store's own message about a code, from the lines it just showed: the
 * first one that reads as a reply (matches `isReply`), cut to a short line.
 * Null when there is none. Page text: shown to the user, never put in
 * diagnostics.
 */
export function storeMessage(fresh: string, isReply: (line: string) => boolean): string | null {
  for (const raw of fresh.split("\n")) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (line.length < 4 || !isReply(line)) continue;
    return line.length > MAX_MESSAGE ? line.slice(0, MAX_MESSAGE - 1).trimEnd() + "…" : line;
  }
  return null;
}

/** Codes by group, in the order groups first appeared. */
export function groupByKind(items: Array<{ code: string; kind?: RejectKind }>): Array<{ kind: RejectKind; codes: string[] }> {
  const out: Array<{ kind: RejectKind; codes: string[] }> = [];
  for (const it of items) {
    if (!it.kind) continue;
    const g = out.find((x) => x.kind === it.kind);
    if (g) {
      if (!g.codes.includes(it.code)) g.codes.push(it.code);
    } else out.push({ kind: it.kind, codes: [it.code] });
  }
  return out;
}

/** True when most turned-down codes had expired or ended: worth a search for this month's promotions. */
export function mostlyExpired(kinds: RejectKind[]): boolean {
  const told = kinds.filter((k) => k !== "other" && k !== "invalid");
  if (told.length < 3) return false;
  return told.filter((k) => k === "expired").length * 2 > told.length;
}
