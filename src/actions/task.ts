// Scout mode action executor (Part 3, spec 8). Performs one allow-listed
// action (src/actions/vocabulary.ts) through a `TaskPage`, never the live DOM
// directly, so it unit-tests without a browser; src/actions/task-dom.ts is the
// content-script adapter. The permission gate and sensitive-action
// confirmation happen before this runs (src/agent/task.ts).
import { CLICK_TYPES, MAX_WAIT_MS, type ScrollDirection, type Target, type TaskAction } from "./vocabulary";

export type TaskErrorCode =
  | "unknown_action"
  | "bad_args"
  | "no_target"
  | "stale_ref"
  | "disabled"
  | "not_typeable"
  | "approval_denied"
  | "blocked"
  | "skipped"
  | "failed";

export interface TaskActionResult {
  ok: boolean;
  action: string;
  message: string;
  error?: TaskErrorCode;
}

/** What the page says sits at a target, used for the gate, the log, and the click marker. */
export interface ProbeResult {
  /** Center of the element, or the point itself, in CSS pixels of the viewport. */
  x: number;
  y: number;
  /** Accessible name (sensitive field values never appear here). */
  name: string;
  role: string;
  tag: string;
  type?: string;
  href?: string;
  /** A password, card, or similar field. */
  redacted?: boolean;
  disabled?: boolean;
  /** Inside a form, so Enter may submit it. */
  inForm?: boolean;
}

export interface TaskPage {
  /** Finds the element for a ref or at a point (CSS pixels). Null when nothing is there. */
  probe(target: Target | "focused"): ProbeResult | null;
  click(target: Target, kind: "click" | "double_click" | "right_click"): boolean;
  /** Appends `text` to the target (or the focused element). False when it accepts no text. */
  type(target: Target | undefined, text: string): boolean;
  /** Clears the field, then sets `value`. */
  fill(target: Target, value: string): boolean;
  key(target: Target | undefined, key: string, modifiers: readonly string[]): boolean;
  scroll(direction: ScrollDirection, amount: number | undefined, target: Target | undefined): boolean;
  scrollTo(target: Target): boolean;
  drag(from: Target, to: Target): boolean;
}

const fail = (action: string, error: TaskErrorCode, message: string): TaskActionResult => ({ ok: false, action, message, error });

/** Human wording for what the target is, for messages. */
export function targetLabel(target: Target | undefined): string {
  if (!target) return "the focused element";
  return "ref" in target ? target.ref : "(" + target.x + ", " + target.y + ")";
}

/**
 * Runs one action. `wait` is not performed here: the runner sleeps in the
 * worker so Take control and Stop can cut it short (src/agent/task.ts).
 * `screenshot` is answered by the runner too (the next observation carries one).
 */
export function performTaskAction(page: TaskPage, action: TaskAction): TaskActionResult {
  const name = action.type;
  try {
    if (CLICK_TYPES.has(action.type)) {
      const a = action as { type: "click" | "double_click" | "right_click"; target: Target };
      const el = page.probe(a.target);
      if (!el) return fail(name, "no_target", "Nothing is at " + targetLabel(a.target) + ". Take a new look at the page.");
      if (el.disabled) return fail(name, "disabled", "The element at " + targetLabel(a.target) + " is disabled.");
      if (!page.click(a.target, a.type)) return fail(name, "failed", "Could not " + a.type.replace("_", "-") + " " + targetLabel(a.target) + ".");
      return { ok: true, action: name, message: (a.type === "click" ? "Clicked " : a.type === "double_click" ? "Double-clicked " : "Right-clicked ") + targetLabel(a.target) + "." };
    }
    switch (action.type) {
      case "type": {
        const el = page.probe(action.target ?? "focused");
        if (!el) return fail(name, "no_target", action.target ? "Nothing is at " + targetLabel(action.target) + "." : "No element has focus. Click a field first.");
        if (el.disabled) return fail(name, "disabled", "That field is disabled.");
        if (!page.type(action.target, action.text)) return fail(name, "not_typeable", "That element does not accept text.");
        return { ok: true, action: name, message: "Typed " + action.text.length + " characters into " + targetLabel(action.target) + "." };
      }
      case "fill_field": {
        const el = page.probe(action.target);
        if (!el) return fail(name, "no_target", "Nothing is at " + targetLabel(action.target) + ".");
        if (el.disabled) return fail(name, "disabled", "That field is disabled.");
        if (!page.fill(action.target, action.value)) return fail(name, "not_typeable", "That element is not a field.");
        return { ok: true, action: name, message: "Filled " + targetLabel(action.target) + " with " + action.value.length + " characters." };
      }
      case "key": {
        if (action.target && !page.probe(action.target)) return fail(name, "no_target", "Nothing is at " + targetLabel(action.target) + ".");
        if (!page.key(action.target, action.key, action.modifiers)) return fail(name, "failed", "Could not press " + action.key + ".");
        return { ok: true, action: name, message: "Pressed " + (action.key === " " ? "Space" : action.key) + "." };
      }
      case "scroll": {
        if (action.target && !page.probe(action.target)) return fail(name, "no_target", "Nothing is at " + targetLabel(action.target) + ".");
        if (!page.scroll(action.direction, action.amount, action.target)) return fail(name, "failed", "Could not scroll.");
        return { ok: true, action: name, message: "Scrolled " + action.direction + "." };
      }
      case "scroll_to_element": {
        if (!page.probe(action.target)) return fail(name, "no_target", "Nothing is at " + targetLabel(action.target) + ".");
        if (!page.scrollTo(action.target)) return fail(name, "failed", "Could not scroll there.");
        return { ok: true, action: name, message: "Scrolled " + targetLabel(action.target) + " into view." };
      }
      case "drag": {
        if (!page.probe(action.from)) return fail(name, "no_target", "Nothing is at " + targetLabel(action.from) + ".");
        if (!page.drag(action.from, action.to)) return fail(name, "failed", "Could not drag.");
        return { ok: true, action: name, message: "Dragged " + targetLabel(action.from) + " to " + targetLabel(action.to) + "." };
      }
      case "wait":
        return { ok: true, action: name, message: "Waited " + Math.min(action.ms, MAX_WAIT_MS) + " ms." };
      case "screenshot":
        return { ok: true, action: name, message: "A screenshot comes with the next observation." };
      default:
        return fail(String((action as { type?: unknown }).type), "unknown_action", "Unknown action.");
    }
  } catch (err) {
    return fail(name, "failed", err instanceof Error ? err.message : "Action failed.");
  }
}
