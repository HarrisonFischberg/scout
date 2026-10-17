// Scout mode action executor (Part 3): performs one allow-listed action on the
// page with DOM events from the content script (platform note 11: Safari has
// no browser-level input automation, so this is the fallback column). Each
// click is announced by the overlay's ripple about 150 ms before it lands.
// Coordinates arrive already scaled to CSS viewport pixels by the worker.
//
// Talks to the DOM through `ExecDeps` so it can be exercised in Playwright;
// the pure parts (targets, descriptions) live in actions.ts and sensitive.ts.
import { MARKER_LEAD_MS } from "./overlay";
import type { ScoutAction, Target } from "./actions";

export type ScoutErrorCode =
  | "no_ref"
  | "stale_ref"
  | "disabled"
  | "not_typeable"
  | "no_option"
  | "offscreen"
  | "no_element"
  | "paused"
  | "stopped"
  | "bad_args"
  | "failed";

export interface ScoutResult {
  ok: boolean;
  action: string;
  message: string;
  error?: ScoutErrorCode;
  /** Where a pointer action landed (CSS px), for the log. */
  point?: { x: number; y: number };
}

export interface ExecDeps {
  doc: Document;
  win: Window;
  /** Elements by snapshot ref (from the last scout:snapshot). */
  resolve(ref: string): Element | undefined;
  /** Shows the click ripple (overlay). */
  marker(x: number, y: number): void;
  /** Aborted when the user takes control or stops: nothing more happens on the page. */
  signal?: AbortSignal;
}

const TYPEABLE_INPUT_TYPES = new Set(["text", "email", "search", "tel", "url", "number", "password", "date", "time", "month", "week", "datetime-local", ""]);
const KEY_CODES: Record<string, string> = {
  enter: "Enter",
  return: "Enter",
  escape: "Escape",
  esc: "Escape",
  tab: "Tab",
  backspace: "Backspace",
  delete: "Delete",
  space: "Space",
  arrowup: "ArrowUp",
  arrowdown: "ArrowDown",
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
};

const ok = (action: string, message: string, extra: Partial<ScoutResult> = {}): ScoutResult => ({ ok: true, action, message, ...extra });
const fail = (action: string, error: ScoutErrorCode, message: string): ScoutResult => ({ ok: false, action, message, error });

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(t);
      reject(new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

function isDisabled(el: Element): boolean {
  return (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true";
}

function center(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
}

function fireInput(el: Element): void {
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function setValue(el: Element, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else (el as HTMLInputElement).value = value;
  fireInput(el);
}

function typeable(el: Element): boolean {
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return TYPEABLE_INPUT_TYPES.has(el.type.toLowerCase());
  return (el as HTMLElement).isContentEditable === true;
}

interface Resolved {
  el: Element;
  point: { x: number; y: number };
}

/**
 * Finds the element and point for a target: a ref from the snapshot
 * (scrolled into view first), else the element under the given viewport
 * point. A ref that left the document is stale.
 */
function resolveTarget(deps: ExecDeps, t: Target, action: string): Resolved | ScoutResult {
  if (t.ref !== undefined) {
    const el = deps.resolve(t.ref);
    if (!el) return fail(action, "no_ref", "No element with ref " + t.ref + ". Take a new snapshot.");
    if (!el.isConnected) return fail(action, "stale_ref", "Element " + t.ref + " is no longer on the page. Take a new snapshot.");
    (el as HTMLElement).scrollIntoView?.({ block: "center", inline: "nearest" });
    const p = center(el);
    if (p.x < 0 || p.y < 0 || p.x > deps.win.innerWidth || p.y > deps.win.innerHeight) {
      return fail(action, "offscreen", "Element " + t.ref + " could not be brought into view.");
    }
    return { el, point: p };
  }
  const x = t.x ?? 0;
  const y = t.y ?? 0;
  const el = deps.doc.elementFromPoint(x, y);
  if (!el) return fail(action, "no_element", "Nothing is at (" + x + ", " + y + ").");
  return { el, point: { x, y } };
}

const isResult = (v: Resolved | ScoutResult): v is ScoutResult => "ok" in v;

function pointerEvent(type: string, p: { x: number; y: number }, extra: MouseEventInit = {}): MouseEvent {
  const init: MouseEventInit & PointerEventInit = { bubbles: true, cancelable: true, composed: true, clientX: p.x, clientY: p.y, view: window, ...extra };
  if (type.startsWith("pointer") && typeof PointerEvent === "function") return new PointerEvent(type, { ...init, pointerId: 1, pointerType: "mouse", isPrimary: true });
  return new MouseEvent(type, init);
}

/** pointerdown/mousedown/pointerup/mouseup/click on the element at the point, then the element's own click(). */
function press(el: Element, p: { x: number; y: number }, button = 0): void {
  const target = el;
  const extra: MouseEventInit = { button, buttons: button === 2 ? 2 : 1 };
  target.dispatchEvent(pointerEvent("pointerdown", p, extra));
  target.dispatchEvent(pointerEvent("mousedown", p, extra));
  (target as HTMLElement).focus?.();
  target.dispatchEvent(pointerEvent("pointerup", p, extra));
  target.dispatchEvent(pointerEvent("mouseup", p, extra));
  if (button === 2) target.dispatchEvent(pointerEvent("contextmenu", p, extra));
  else if (typeof (target as HTMLElement).click === "function") (target as HTMLElement).click();
  else target.dispatchEvent(pointerEvent("click", p, extra));
}

function keyEvents(target: Element, key: string, modifiers: Set<string>): boolean {
  const init: KeyboardEventInit = {
    key,
    code: key.length === 1 ? "Key" + key.toUpperCase() : key,
    bubbles: true,
    cancelable: true,
    composed: true,
    metaKey: modifiers.has("meta") || modifiers.has("cmd") || modifiers.has("command"),
    ctrlKey: modifiers.has("ctrl") || modifiers.has("control"),
    altKey: modifiers.has("alt") || modifiers.has("option"),
    shiftKey: modifiers.has("shift"),
  };
  const down = target.dispatchEvent(new KeyboardEvent("keydown", init));
  if (key.length === 1 && down) target.dispatchEvent(new KeyboardEvent("keypress", init));
  target.dispatchEvent(new KeyboardEvent("keyup", init));
  return down;
}

/** Synthetic keys have no default action, so the common ones are performed here. */
function keyDefault(deps: ExecDeps, target: Element, key: string): void {
  const el = target as HTMLElement;
  if (key === "Enter") {
    if (el instanceof HTMLButtonElement || el instanceof HTMLAnchorElement || el.getAttribute("role") === "button") el.click();
    else if (el instanceof HTMLInputElement && el.form) {
      if (typeof el.form.requestSubmit === "function") el.form.requestSubmit();
      else el.form.submit();
    }
    else if (el instanceof HTMLTextAreaElement) insertText(deps, el, "\n");
  } else if (key === "Backspace" && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
    setValue(el, el.value.slice(0, -1));
  } else if (key === "Tab") {
    const focusables = Array.from(deps.doc.querySelectorAll<HTMLElement>("a[href],button,input,select,textarea,[tabindex]:not([tabindex='-1'])")).filter(
      (f) => !isDisabled(f) && f.getClientRects().length > 0,
    );
    const i = focusables.indexOf(el);
    focusables[(i + 1) % Math.max(1, focusables.length)]?.focus();
  } else if (key === "Space" && (el instanceof HTMLButtonElement || (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")))) {
    el.click();
  }
}

function insertText(deps: ExecDeps, el: Element, text: string): void {
  (el as HTMLElement).focus?.();
  // execCommand fires beforeinput/input the way real typing does (Safari and
  // Chromium keep it for this); fall back to the value setter.
  let inserted = false;
  try {
    inserted = deps.doc.execCommand("insertText", false, text);
  } catch {
    inserted = false;
  }
  if (!inserted) {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) setValue(el, el.value + text);
    else (el as HTMLElement).textContent = ((el as HTMLElement).textContent ?? "") + text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

function pickOption(el: HTMLSelectElement, value: string): boolean {
  const want = value.trim().toLowerCase();
  const opts = Array.from(el.options);
  const hit = opts.find((o) => o.value === value) ?? opts.find((o) => o.text.trim().toLowerCase() === want) ?? opts.find((o) => o.value.toLowerCase() === want);
  if (!hit || hit.disabled) return false;
  el.value = hit.value;
  fireInput(el);
  return true;
}

async function clickAt(deps: ExecDeps, r: Resolved, action: string, button: number, times: number): Promise<ScoutResult> {
  if (isDisabled(r.el)) return fail(action, "disabled", "That element is disabled.");
  // The ripple shows first, then the click lands (spec 9).
  deps.marker(r.point.x, r.point.y);
  await sleep(MARKER_LEAD_MS, deps.signal);
  if (deps.signal?.aborted) return fail(action, "paused", "Stopped before the click.");
  for (let i = 0; i < times; i++) press(r.el, r.point, button);
  if (times === 2) r.el.dispatchEvent(pointerEvent("dblclick", r.point, { detail: 2 }));
  const what = action === "click" ? "Clicked" : action === "double_click" ? "Double-clicked" : "Right-clicked";
  return ok(action, what + " at (" + r.point.x + ", " + r.point.y + ").", { point: r.point });
}

async function drag(deps: ExecDeps, from: Resolved, to: Resolved): Promise<ScoutResult> {
  deps.marker(from.point.x, from.point.y);
  await sleep(MARKER_LEAD_MS, deps.signal);
  from.el.dispatchEvent(pointerEvent("pointerdown", from.point, { buttons: 1 }));
  from.el.dispatchEvent(pointerEvent("mousedown", from.point, { buttons: 1 }));
  const dt = typeof DataTransfer === "function" ? new DataTransfer() : undefined;
  const dragEvent = (type: string, p: { x: number; y: number }): DragEvent | MouseEvent =>
    typeof DragEvent === "function" ? new DragEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: p.x, clientY: p.y, dataTransfer: dt }) : pointerEvent(type, p);
  from.el.dispatchEvent(dragEvent("dragstart", from.point));
  const steps = 6;
  for (let i = 1; i <= steps; i++) {
    const p = { x: Math.round(from.point.x + ((to.point.x - from.point.x) * i) / steps), y: Math.round(from.point.y + ((to.point.y - from.point.y) * i) / steps) };
    const over = deps.doc.elementFromPoint(p.x, p.y) ?? to.el;
    over.dispatchEvent(pointerEvent("pointermove", p, { buttons: 1 }));
    over.dispatchEvent(pointerEvent("mousemove", p, { buttons: 1 }));
    over.dispatchEvent(dragEvent("dragover", p));
    await sleep(16, deps.signal);
  }
  to.el.dispatchEvent(dragEvent("drop", to.point));
  to.el.dispatchEvent(pointerEvent("pointerup", to.point));
  to.el.dispatchEvent(pointerEvent("mouseup", to.point));
  from.el.dispatchEvent(dragEvent("dragend", to.point));
  return ok("drag", "Dragged from (" + from.point.x + ", " + from.point.y + ") to (" + to.point.x + ", " + to.point.y + ").", { point: to.point });
}

export async function executeScoutAction(deps: ExecDeps, action: ScoutAction): Promise<ScoutResult> {
  const type = action.type;
  if (deps.signal?.aborted) return fail(type, "stopped", "Stopped.");
  try {
    switch (action.type) {
      case "click":
      case "double_click":
      case "right_click": {
        const r = resolveTarget(deps, action.target, type);
        if (isResult(r)) return r;
        return await clickAt(deps, r, type, action.type === "right_click" ? 2 : 0, action.type === "double_click" ? 2 : 1);
      }
      case "type": {
        const r = resolveTarget(deps, action.target, type);
        if (isResult(r)) return r;
        if (isDisabled(r.el)) return fail(type, "disabled", "That field is disabled.");
        if (!typeable(r.el)) return fail(type, "not_typeable", "That element does not accept text.");
        const el = r.el;
        (el as HTMLElement).focus?.();
        if (action.clear !== false && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) setValue(el, "");
        const lines = action.text.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (deps.signal?.aborted) return fail(type, "paused", "Stopped while typing.");
          if (lines[i]) insertText(deps, el, lines[i]!);
          if (i < lines.length - 1) {
            keyEvents(el, "Enter", new Set());
            keyDefault(deps, el, "Enter");
          }
        }
        return ok(type, "Typed " + action.text.length + " characters.", { point: r.point });
      }
      case "fill_field": {
        const r = resolveTarget(deps, action.target, type);
        if (isResult(r)) return r;
        const el = r.el;
        if (isDisabled(el)) return fail(type, "disabled", "That field is disabled.");
        if (el instanceof HTMLSelectElement) {
          if (!pickOption(el, action.value)) return fail(type, "no_option", 'No option matches "' + action.value + '".');
          return ok(type, 'Selected "' + action.value + '".');
        }
        if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
          const want = !/^(false|off|0|no|unchecked)$/i.test(action.value.trim());
          if (el.checked !== want) el.click();
          return ok(type, (want ? "Checked " : "Unchecked ") + (el.type === "radio" ? "the option." : "the box."));
        }
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          (el as HTMLElement).focus();
          setValue(el, action.value);
          return ok(type, "Filled the field with " + action.value.length + " characters.");
        }
        if ((el as HTMLElement).isContentEditable) {
          (el as HTMLElement).textContent = "";
          insertText(deps, el, action.value);
          return ok(type, "Filled the editor with " + action.value.length + " characters.");
        }
        return fail(type, "not_typeable", "That element is not a form field.");
      }
      case "key": {
        let target: Element | null = deps.doc.activeElement;
        if (action.target) {
          const r = resolveTarget(deps, action.target, type);
          if (isResult(r)) return r;
          (r.el as HTMLElement).focus?.();
          target = r.el;
        }
        target ??= deps.doc.body;
        const parts = action.key.split("+").map((p) => p.trim()).filter(Boolean);
        const last = parts.pop() ?? "";
        const key = KEY_CODES[last.toLowerCase()] ?? last;
        const modifiers = new Set(parts.map((p) => p.toLowerCase()));
        const notPrevented = keyEvents(target, key === "Space" ? " " : key, modifiers);
        if (notPrevented && modifiers.size === 0) keyDefault(deps, target, key);
        return ok(type, "Pressed " + action.key + ".");
      }
      case "scroll": {
        const amount = action.amount ?? Math.round((action.direction === "up" || action.direction === "down" ? deps.win.innerHeight : deps.win.innerWidth) * 0.8);
        const dx = action.direction === "left" ? -amount : action.direction === "right" ? amount : 0;
        const dy = action.direction === "up" ? -amount : action.direction === "down" ? amount : 0;
        if (action.target) {
          const r = resolveTarget(deps, action.target, type);
          if (isResult(r)) return r;
          // Scroll the nearest scrollable ancestor of the target, else the window.
          let node: Element | null = r.el;
          while (node && node !== deps.doc.documentElement) {
            const cs = deps.win.getComputedStyle(node);
            if (/(auto|scroll)/.test(cs.overflowY + cs.overflowX) && (node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth)) break;
            node = node.parentElement;
          }
          if (node && node !== deps.doc.documentElement) {
            node.scrollBy({ left: dx, top: dy });
            return ok(type, "Scrolled " + action.direction + " inside the element.");
          }
        }
        deps.win.scrollBy({ left: dx, top: dy });
        return ok(type, "Scrolled " + action.direction + " by " + amount + " px.");
      }
      case "scroll_to_element": {
        const r = resolveTarget(deps, action.target, type);
        if (isResult(r)) return r;
        (r.el as HTMLElement).scrollIntoView?.({ block: "center", inline: "nearest" });
        return ok(type, "Scrolled the element into view.", { point: center(r.el) });
      }
      case "drag": {
        const from = resolveTarget(deps, action.from, type);
        if (isResult(from)) return from;
        const to = resolveTarget(deps, action.to, type);
        if (isResult(to)) return to;
        return await drag(deps, from, to);
      }
      case "wait":
        await sleep(action.ms, deps.signal);
        return ok(type, "Waited " + action.ms + " ms.");
      case "screenshot":
        // Captured by the worker (tabs.captureVisibleTab); nothing happens on the page.
        return ok(type, "Screenshot requested.");
    }
  } catch (err) {
    if (deps.signal?.aborted) return fail(type, "paused", "Stopped.");
    return fail(type, "failed", err instanceof Error ? err.message.slice(0, 200) : "Action failed.");
  }
}
