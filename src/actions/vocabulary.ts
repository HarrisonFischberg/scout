// Scout mode action vocabulary (Part 3, spec 8.2 and 8.3). The server (the
// model, through the Scout server in the worker) proposes actions; the client
// accepts only these types with these arguments and rejects anything else.
// Targets prefer element refs from the page's accessibility structure
// (src/snapshot/snapshot.ts); coordinates are a fallback, given in screenshot
// pixels and scaled to the real viewport here on the device.

export const ACTION_TYPES = [
  "click",
  "double_click",
  "right_click",
  "type",
  "key",
  "scroll",
  "scroll_to_element",
  "drag",
  "fill_field",
  "wait",
  "screenshot",
  "navigate",
] as const;

export type ActionType = (typeof ACTION_TYPES)[number];

/** An element ref ("e12") from the snapshot, or a point in screenshot pixels. */
export type Target = { ref: string } | { x: number; y: number };

export type ScrollDirection = "up" | "down" | "left" | "right" | "top" | "bottom";

export type TaskAction =
  | { type: "click" | "double_click" | "right_click"; target: Target }
  /** Types into `target`, or into the focused element when no target is given. */
  | { type: "type"; text: string; target?: Target }
  | { type: "key"; key: string; modifiers: KeyModifier[]; target?: Target }
  | { type: "scroll"; direction: ScrollDirection; amount?: number; target?: Target }
  | { type: "scroll_to_element"; target: Target }
  | { type: "drag"; from: Target; to: Target }
  /** Replaces the field's value (clears first). */
  | { type: "fill_field"; target: Target; value: string }
  | { type: "wait"; ms: number }
  | { type: "screenshot" }
  /** Opens an address in the tab Scout controls (the worker sets the tab's URL; page keys cannot reach the address bar). */
  | { type: "navigate"; url: string };

export const KEY_MODIFIERS = ["shift", "control", "alt", "meta"] as const;
export type KeyModifier = (typeof KEY_MODIFIERS)[number];

export const MAX_WAIT_MS = 10_000;
export const MAX_TEXT = 5_000;
export const MAX_BATCH = 5;

/** Keys accepted by the `key` action, as KeyboardEvent.key values. */
export const KEY_NAMES = new Set([
  "Enter", "Tab", "Escape", "Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "Home", "End", "PageUp", "PageDown", "Space", " ",
]);

/**
 * An address the model gave ("google.com", "https://example.com/a") as an
 * http or https URL, or null. Bare hosts get https://.
 */
export function navigableUrl(raw: string): string | null {
  const text = raw.trim();
  if (!text || text.length > 2048 || /\s/.test(text)) return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) && !/^[^/:]+:\d+(\/|$)/.test(text);
  let url: URL;
  try {
    url = new URL(hasScheme ? text : "https://" + text.replace(/^\/\//, ""));
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname || (!hasScheme && !url.hostname.includes(".") && url.hostname !== "localhost")) return null;
  return url.href;
}

export type ParsedAction =
  | {
      ok: true;
      action: TaskAction;
      /** The server marked it pre-approved. Ignored for the gate; kept for the log. */
      preapproved: boolean;
    }
  | { ok: false; type: string; reason: "unknown_action" | "bad_args"; message: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function parseTarget(v: unknown): Target | null {
  if (!isObj(v)) return null;
  if (typeof v.ref === "string" && /^e\d{1,4}$/.test(v.ref)) return { ref: v.ref };
  if (typeof v.x === "number" && typeof v.y === "number" && Number.isFinite(v.x) && Number.isFinite(v.y) && v.x >= 0 && v.y >= 0) {
    return { x: v.x, y: v.y };
  }
  return null;
}

function bad(type: string, message: string): ParsedAction {
  return { ok: false, type, reason: "bad_args", message };
}

/**
 * Checks one proposed action against the allow-list. Unknown types and bad
 * arguments are rejected (never run). Any `approved` / `pre_approved` flag is
 * noted and otherwise ignored: the sensitive-action gate decides on the device.
 */
export function parseTaskAction(raw: unknown): ParsedAction {
  if (!isObj(raw) || typeof raw.type !== "string") {
    return { ok: false, type: "", reason: "unknown_action", message: "Each action needs a type." };
  }
  const type = raw.type.slice(0, 40);
  if (!(ACTION_TYPES as readonly string[]).includes(type)) {
    return { ok: false, type, reason: "unknown_action", message: "Unknown action " + JSON.stringify(type) + ". Allowed: " + ACTION_TYPES.join(", ") + "." };
  }
  const preapproved = raw.approved === true || raw.pre_approved === true || raw.preapproved === true;
  const target = parseTarget(raw.target);
  const done = (action: TaskAction): ParsedAction => ({ ok: true, action, preapproved });
  switch (type as ActionType) {
    case "click":
    case "double_click":
    case "right_click":
    case "scroll_to_element":
      if (!target) return bad(type, type + " needs a target: an element ref like e12, or x and y in screenshot pixels.");
      return done({ type: type as "click", target });
    case "type": {
      if (typeof raw.text !== "string" || raw.text === "") return bad(type, "type needs text.");
      return done({ type: "type", text: raw.text.slice(0, MAX_TEXT), ...(target ? { target } : {}) });
    }
    case "key": {
      const key = typeof raw.key === "string" ? raw.key : "";
      const single = key.length === 1;
      if (!single && !KEY_NAMES.has(key)) return bad(type, "key must be a single character or one of " + [...KEY_NAMES].filter((k) => k !== " ").join(", ") + ".");
      const mods = Array.isArray(raw.modifiers) ? raw.modifiers : [];
      if (!mods.every((m) => (KEY_MODIFIERS as readonly unknown[]).includes(m))) return bad(type, "modifiers may only be " + KEY_MODIFIERS.join(", ") + ".");
      return done({ type: "key", key: key === "Space" ? " " : key, modifiers: mods as KeyModifier[], ...(target ? { target } : {}) });
    }
    case "scroll": {
      const dir = raw.direction;
      if (dir !== "up" && dir !== "down" && dir !== "left" && dir !== "right" && dir !== "top" && dir !== "bottom") {
        return bad(type, "scroll needs a direction: up, down, left, right, top or bottom.");
      }
      const amount = typeof raw.amount === "number" && Number.isFinite(raw.amount) && raw.amount > 0 ? Math.min(raw.amount, 20_000) : undefined;
      return done({ type: "scroll", direction: dir, ...(amount !== undefined ? { amount } : {}), ...(target ? { target } : {}) });
    }
    case "drag": {
      const from = parseTarget(raw.from);
      const to = parseTarget(raw.to);
      if (!from || !to) return bad(type, "drag needs from and to targets.");
      return done({ type: "drag", from, to });
    }
    case "fill_field": {
      if (typeof raw.value !== "string") return bad(type, "fill_field needs a value.");
      if (!target) return bad(type, "fill_field needs a target.");
      return done({ type: "fill_field", target, value: raw.value.slice(0, MAX_TEXT) });
    }
    case "wait": {
      if (typeof raw.ms !== "number" || !Number.isFinite(raw.ms) || raw.ms < 0) return bad(type, "wait needs ms, a non-negative number.");
      return done({ type: "wait", ms: Math.min(raw.ms, MAX_WAIT_MS) });
    }
    case "screenshot":
      return done({ type: "screenshot" });
    case "navigate": {
      if (typeof raw.url !== "string" || raw.url.trim() === "") return bad(type, "navigate needs a url, for example https://www.google.com.");
      const url = navigableUrl(raw.url);
      if (!url) return bad(type, "navigate can open only http and https addresses, for example https://www.google.com.");
      return done({ type: "navigate", url });
    }
  }
}

/** Parses a batch. Stops at the first rejected action; the rest are not looked at. */
export function parseBatch(raw: unknown): ParsedAction[] {
  const list = Array.isArray(raw) ? raw.slice(0, MAX_BATCH) : [];
  const out: ParsedAction[] = [];
  for (const item of list) {
    const p = parseTaskAction(item);
    out.push(p);
    if (!p.ok) break;
  }
  return out;
}

/** The target an action acts on, if any (drag: where it starts). */
export function targetOf(action: TaskAction): Target | undefined {
  switch (action.type) {
    case "click":
    case "double_click":
    case "right_click":
    case "scroll_to_element":
    case "fill_field":
      return action.target;
    case "type":
    case "key":
    case "scroll":
      return action.target;
    case "drag":
      return action.from;
    default:
      return undefined;
  }
}

export const CLICK_TYPES = new Set<ActionType>(["click", "double_click", "right_click"]);

/** A point in screenshot pixels scaled to CSS pixels of the real viewport. */
export function scaleToViewport(
  point: { x: number; y: number },
  image: { width: number; height: number } | null,
  viewport: { width: number; height: number },
): { x: number; y: number } {
  if (!image || image.width <= 0 || image.height <= 0) return { x: Math.round(point.x), y: Math.round(point.y) };
  const sx = viewport.width / image.width;
  const sy = viewport.height / image.height;
  return {
    x: Math.min(viewport.width - 1, Math.max(0, Math.round(point.x * sx))),
    y: Math.min(viewport.height - 1, Math.max(0, Math.round(point.y * sy))),
  };
}

function shortHost(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

const quote = (s: string): string => '“' + s.replace(/\s+/g, " ").trim().slice(0, 60) + '”';

/** Plain-language description for the action log and the confirmation prompt. */
export function describeAction(action: TaskAction, targetName?: string): string {
  const t = targetName ? " " + quote(targetName) : "";
  switch (action.type) {
    case "click":
      return "click" + t;
    case "double_click":
      return "double-click" + t;
    case "right_click":
      return "right-click" + t;
    case "type":
      return "type " + action.text.length + (action.text.length === 1 ? " character" : " characters") + (t ? " into" + t : "");
    case "key":
      return "press " + [...action.modifiers.map((m) => m[0]!.toUpperCase() + m.slice(1)), action.key === " " ? "Space" : action.key].join("-") + (t ? " in" + t : "");
    case "scroll":
      return "scroll " + (action.direction === "top" ? "to the top" : action.direction === "bottom" ? "to the bottom" : action.direction) + (t ? " in" + t : "");
    case "scroll_to_element":
      return "scroll to" + t;
    case "drag":
      return "drag" + t + " to another spot";
    case "fill_field":
      return "fill" + (t || " a field") + " with " + action.value.length + (action.value.length === 1 ? " character" : " characters");
    case "wait":
      return "wait " + (action.ms >= 1000 ? (action.ms / 1000).toFixed(1).replace(/\.0$/, "") + " s" : action.ms + " ms");
    case "screenshot":
      return "take a screenshot";
    case "navigate":
      return "go to " + (shortHost(action.url) ?? action.url.slice(0, 60));
  }
}
