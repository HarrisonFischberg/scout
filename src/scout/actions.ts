// Scout mode action vocabulary (Part 3, spec 8.2 and 8.3). The server may
// propose only these actions; anything else is rejected before it reaches the
// page and logged. Targets prefer an element ref from the page's accessibility
// snapshot; coordinates are a fallback and are given in screenshot pixels,
// which the client scales to the real viewport (scalePoint).
//
// Pure functions, no DOM: unit-tested without a browser.

export const SCOUT_ACTIONS = [
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
] as const;

export type ScoutActionType = (typeof SCOUT_ACTIONS)[number];

/** Where an action acts: a snapshot ref (preferred) or a point in the last screenshot. */
export interface Target {
  ref?: string;
  x?: number;
  y?: number;
}

export type ScoutAction =
  | { type: "click"; target: Target }
  | { type: "double_click"; target: Target }
  | { type: "right_click"; target: Target }
  | { type: "type"; target: Target; text: string; clear?: boolean }
  /** One key or chord, e.g. "Enter", "Escape", "Tab", "Meta+a". Optional target to focus first. */
  | { type: "key"; key: string; target?: Target }
  | { type: "scroll"; direction: "up" | "down" | "left" | "right"; amount?: number; target?: Target }
  | { type: "scroll_to_element"; target: Target }
  | { type: "drag"; from: Target; to: Target }
  /** Set a field's value in one go (select options, checkboxes, dates, text). */
  | { type: "fill_field"; target: Target; value: string }
  | { type: "wait"; ms: number }
  | { type: "screenshot" };

export const MAX_WAIT_MS = 10_000;
export const MAX_TEXT = 4000;
export const MAX_KEY = 40;
/** Actions per batch the client accepts; the rest of a longer batch is dropped. */
export const MAX_BATCH = 8;

export type ParseFailure = "not_an_object" | "unknown_action" | "bad_target" | "bad_args";

export type ParsedAction = { ok: true; action: ScoutAction } | { ok: false; error: ParseFailure; message: string; type: string };

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** A ref ("e12"), a point ({x, y} in screenshot pixels), or both. Null when neither is usable. */
export function parseTarget(raw: unknown): Target | null {
  if (typeof raw === "string") return /^e\d{1,4}$/.test(raw) ? { ref: raw } : null;
  if (!isObj(raw)) return null;
  const out: Target = {};
  if (typeof raw.ref === "string" && /^e\d{1,4}$/.test(raw.ref)) out.ref = raw.ref;
  if (num(raw.x) && num(raw.y) && raw.x >= 0 && raw.y >= 0) {
    out.x = raw.x;
    out.y = raw.y;
  }
  return out.ref !== undefined || out.x !== undefined ? out : null;
}

const fail = (type: string, error: ParseFailure, message: string): ParsedAction => ({ ok: false, error, message, type });

/** Reads one proposed action. Unknown types and malformed arguments are refused, never guessed at. */
export function parseAction(raw: unknown): ParsedAction {
  if (!isObj(raw)) return fail("", "not_an_object", "An action must be an object.");
  const type = typeof raw.type === "string" ? raw.type.slice(0, 40) : "";
  if (!(SCOUT_ACTIONS as readonly string[]).includes(type)) {
    return fail(type, "unknown_action", 'Unknown action "' + type + '". Allowed: ' + SCOUT_ACTIONS.join(", ") + ".");
  }
  const t = type as ScoutActionType;
  const target = parseTarget(raw.target);
  const needTarget = (): ParsedAction | null => (target ? null : fail(t, "bad_target", t + " needs a target: an element ref or {x, y}."));
  switch (t) {
    case "click":
    case "double_click":
    case "right_click":
    case "scroll_to_element": {
      const bad = needTarget();
      return bad ?? { ok: true, action: { type: t, target: target! } };
    }
    case "type": {
      const bad = needTarget();
      if (bad) return bad;
      if (typeof raw.text !== "string") return fail(t, "bad_args", "type needs text.");
      return { ok: true, action: { type: t, target: target!, text: raw.text.slice(0, MAX_TEXT), ...(raw.clear === false ? { clear: false } : {}) } };
    }
    case "fill_field": {
      const bad = needTarget();
      if (bad) return bad;
      if (typeof raw.value !== "string") return fail(t, "bad_args", "fill_field needs a value.");
      return { ok: true, action: { type: t, target: target!, value: raw.value.slice(0, MAX_TEXT) } };
    }
    case "key": {
      if (typeof raw.key !== "string" || !raw.key.trim() || raw.key.length > MAX_KEY) return fail(t, "bad_args", "key needs a key name such as Enter.");
      if (raw.target !== undefined && !target) return fail(t, "bad_target", "key target must be an element ref or {x, y}.");
      return { ok: true, action: { type: t, key: raw.key.trim(), ...(target ? { target } : {}) } };
    }
    case "scroll": {
      const d = raw.direction;
      if (d !== "up" && d !== "down" && d !== "left" && d !== "right") return fail(t, "bad_args", "scroll direction must be up, down, left or right.");
      if (raw.target !== undefined && !target) return fail(t, "bad_target", "scroll target must be an element ref or {x, y}.");
      const amount = num(raw.amount) && raw.amount > 0 ? Math.min(raw.amount, 10_000) : undefined;
      return { ok: true, action: { type: t, direction: d, ...(amount !== undefined ? { amount } : {}), ...(target ? { target } : {}) } };
    }
    case "drag": {
      const from = parseTarget(raw.from);
      const to = parseTarget(raw.to);
      if (!from || !to) return fail(t, "bad_target", "drag needs from and to targets.");
      return { ok: true, action: { type: t, from, to } };
    }
    case "wait": {
      if (!num(raw.ms) || raw.ms < 0) return fail(t, "bad_args", "wait needs ms (0 to " + MAX_WAIT_MS + ").");
      return { ok: true, action: { type: t, ms: Math.min(raw.ms, MAX_WAIT_MS) } };
    }
    case "screenshot":
      return { ok: true, action: { type: t } };
  }
}

/** Reads a batch. Keeps the order; items past MAX_BATCH are dropped (the server is told). */
export function parseBatch(raw: unknown): { items: ParsedAction[]; dropped: number } {
  const list = Array.isArray(raw) ? raw : [];
  return { items: list.slice(0, MAX_BATCH).map(parseAction), dropped: Math.max(0, list.length - MAX_BATCH) };
}

/** Every target an action names, for the gate and the log. */
export function targetsOf(action: ScoutAction): Target[] {
  switch (action.type) {
    case "click":
    case "double_click":
    case "right_click":
    case "scroll_to_element":
    case "type":
    case "fill_field":
      return [action.target];
    case "key":
    case "scroll":
      return action.target ? [action.target] : [];
    case "drag":
      return [action.from, action.to];
    case "wait":
    case "screenshot":
      return [];
  }
}

export interface Size {
  width: number;
  height: number;
}

/**
 * Screenshot pixels to CSS viewport pixels (spec 8.3). The screenshot may be
 * scaled down for the provider and is in device pixels, so one factor per
 * axis maps it back. Points outside the viewport are clamped to its edge.
 */
export function scalePoint(p: { x: number; y: number }, shot: Size, viewport: Size): { x: number; y: number } {
  const sx = shot.width > 0 ? viewport.width / shot.width : 1;
  const sy = shot.height > 0 ? viewport.height / shot.height : 1;
  const clamp = (v: number, max: number): number => Math.min(Math.max(0, v), Math.max(0, max));
  return { x: clamp(Math.round(p.x * sx), viewport.width), y: clamp(Math.round(p.y * sy), viewport.height) };
}
