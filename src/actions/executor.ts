// Action executor (T009). Acts on elements by snapshot ref and reports a
// structured result. It talks to an `ActionPage`, never the live DOM directly,
// so it unit-tests without a browser. Approval and sensitivity checks belong to
// the safety layer (T011); this module only performs allowlisted actions.

export type Action =
  | { type: "click"; ref: string }
  | { type: "type"; ref: string; text: string; clear?: boolean }
  | { type: "select"; ref: string; value: string }
  | { type: "scroll"; direction: "up" | "down" | "top" | "bottom"; ref?: string }
  | { type: "navigate"; url: string }
  | { type: "wait"; ms: number };

export type ActionErrorCode =
  | "unknown_action"
  | "bad_args"
  | "no_ref"
  | "stale_ref"
  | "disabled"
  | "not_typeable"
  | "not_selectable"
  | "no_option"
  | "blocked_url"
  | "failed";

export interface ActionResult {
  ok: boolean;
  action: string;
  ref?: string;
  message: string;
  error?: ActionErrorCode;
}

export interface ActionEl {
  tag: string;
  type?: string;
  disabled: boolean;
  /** False once the element left the document since the snapshot. */
  connected: boolean;
  click(): void;
  setValue(value: string): void;
  getValue(): string;
  /** Pick an option by value or visible label. Returns false if none matches. */
  select(value: string): boolean;
  scrollIntoView(): void;
}

export interface ActionPage {
  resolve(ref: string): ActionEl | undefined;
  scroll(direction: "up" | "down" | "top" | "bottom"): void;
  navigate(url: string): void;
  sleep(ms: number): Promise<void>;
  /** Used to resolve relative navigate targets. */
  baseUrl: string;
}

export const MAX_WAIT_MS = 10_000;
const TYPEABLE_INPUT_TYPES = new Set([
  "text", "email", "search", "tel", "url", "number", "date", "time", "month", "week",
  "datetime-local", "",
]);

const fail = (action: string, error: ActionErrorCode, message: string, ref?: string): ActionResult => ({
  ok: false,
  action,
  ...(ref ? { ref } : {}),
  message,
  error,
});

const isResult = (v: ActionEl | ActionResult): v is ActionResult => "ok" in v;

function lookup(page: ActionPage, action: string, ref: unknown): ActionEl | ActionResult {
  if (typeof ref !== "string" || ref === "") return fail(action, "bad_args", "ref is required");
  const el = page.resolve(ref);
  if (!el) return fail(action, "no_ref", `No element with ref ${ref}. Take a new snapshot.`, ref);
  if (!el.connected) return fail(action, "stale_ref", `Element ${ref} is no longer on the page. Take a new snapshot.`, ref);
  return el;
}

export async function executeAction(page: ActionPage, action: Action): Promise<ActionResult> {
  const kind = (action as { type?: unknown }).type;
  try {
    switch (action.type) {
      case "click": {
        const el = lookup(page, "click", action.ref);
        if (isResult(el)) return el;
        if (el.disabled) return fail("click", "disabled", `Element ${action.ref} is disabled.`, action.ref);
        el.scrollIntoView();
        el.click();
        return { ok: true, action: "click", ref: action.ref, message: `Clicked ${action.ref}.` };
      }
      case "type": {
        if (typeof action.text !== "string") return fail("type", "bad_args", "text is required", action.ref);
        const el = lookup(page, "type", action.ref);
        if (isResult(el)) return el;
        if (el.disabled) return fail("type", "disabled", `Element ${action.ref} is disabled.`, action.ref);
        const typeable =
          el.tag === "textarea" || (el.tag === "input" && TYPEABLE_INPUT_TYPES.has((el.type ?? "").toLowerCase()));
        if (!typeable) return fail("type", "not_typeable", `Element ${action.ref} does not accept text.`, action.ref);
        el.scrollIntoView();
        el.setValue(action.clear === false ? el.getValue() + action.text : action.text);
        return {
          ok: true,
          action: "type",
          ref: action.ref,
          message: `Typed ${action.text.length} characters into ${action.ref}.`,
        };
      }
      case "select": {
        if (typeof action.value !== "string") return fail("select", "bad_args", "value is required", action.ref);
        const el = lookup(page, "select", action.ref);
        if (isResult(el)) return el;
        if (el.disabled) return fail("select", "disabled", `Element ${action.ref} is disabled.`, action.ref);
        if (el.tag !== "select") return fail("select", "not_selectable", `Element ${action.ref} is not a select.`, action.ref);
        if (!el.select(action.value)) return fail("select", "no_option", `No option matches "${action.value}".`, action.ref);
        return { ok: true, action: "select", ref: action.ref, message: `Selected "${action.value}" in ${action.ref}.` };
      }
      case "scroll": {
        if (!["up", "down", "top", "bottom"].includes(action.direction)) {
          return fail("scroll", "bad_args", "direction must be up, down, top or bottom");
        }
        if (action.ref !== undefined) {
          const el = lookup(page, "scroll", action.ref);
          if (isResult(el)) return el;
          el.scrollIntoView();
          return { ok: true, action: "scroll", ref: action.ref, message: `Scrolled ${action.ref} into view.` };
        }
        page.scroll(action.direction);
        return { ok: true, action: "scroll", message: `Scrolled ${action.direction}.` };
      }
      case "navigate": {
        if (typeof action.url !== "string" || action.url === "") return fail("navigate", "bad_args", "url is required");
        let target: URL;
        try {
          target = new URL(action.url, page.baseUrl);
        } catch {
          return fail("navigate", "bad_args", `Not a valid URL: ${action.url}`);
        }
        if (target.protocol !== "http:" && target.protocol !== "https:") {
          return fail("navigate", "blocked_url", `Only http and https pages can be opened, not ${target.protocol}`);
        }
        page.navigate(target.href);
        return { ok: true, action: "navigate", message: `Navigating to ${target.href}.` };
      }
      case "wait": {
        if (typeof action.ms !== "number" || !Number.isFinite(action.ms) || action.ms < 0) {
          return fail("wait", "bad_args", "ms must be a non-negative number");
        }
        const ms = Math.min(action.ms, MAX_WAIT_MS);
        await page.sleep(ms);
        return { ok: true, action: "wait", message: `Waited ${ms} ms.` };
      }
      default:
        return fail(String(kind), "unknown_action", `Unknown action: ${String(kind)}`);
    }
  } catch (err) {
    return fail(String(kind), "failed", err instanceof Error ? err.message : "Action failed.");
  }
}
