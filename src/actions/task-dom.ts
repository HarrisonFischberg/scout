// DOM adapter for Scout mode actions (Part 3, spec 11 fallback column: DOM
// events from a content script; Safari has no browser-level input automation
// for extensions). Content script only; exercised by Playwright
// (tests/e2e/overlay.spec.ts), not Vitest. Every action here is synchronous,
// so a Take control that lands between two actions never finds one half done.
import type { ProbeResult, TaskPage } from "./task";
import type { ScrollDirection, Target } from "./vocabulary";
import { isSensitiveField, type SnapNode } from "../snapshot/snapshot";

const TEXT_INPUT_TYPES = new Set(["text", "email", "search", "tel", "url", "number", "password", "date", "time", "month", "week", "datetime-local", ""]);
const MAX_NAME = 120;

const squash = (s: string): string => s.replace(/\s+/g, " ").trim().slice(0, MAX_NAME);

function roleOf(el: Element): string {
  const explicit = el.getAttribute("role");
  if (explicit) return explicit;
  const tag = el.tagName.toLowerCase();
  if (tag === "a") return el.hasAttribute("href") ? "link" : "generic";
  if (tag === "button" || tag === "summary") return "button";
  if (tag === "select") return "combobox";
  if (tag === "textarea") return "textbox";
  if (tag === "input") {
    const type = ((el as HTMLInputElement).type || "text").toLowerCase();
    return type === "submit" || type === "button" || type === "reset" || type === "image" ? "button" : type === "checkbox" || type === "radio" ? type : "textbox";
  }
  if ((el as HTMLElement).isContentEditable) return "textbox";
  return "generic";
}

function nameOf(el: Element): string {
  const a = el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("placeholder") || el.getAttribute("alt");
  if (a) return squash(a);
  const id = el.getAttribute("id");
  if (id) {
    const label = document.querySelector('label[for="' + CSS.escape(id) + '"]');
    if (label?.textContent) return squash(label.textContent);
  }
  if (el instanceof HTMLInputElement) {
    const type = (el.type || "text").toLowerCase();
    if (type === "submit" || type === "button" || type === "reset") return squash(el.value || "");
    return squash(el.closest("label")?.textContent ?? el.name ?? "");
  }
  return squash((el as HTMLElement).innerText ?? el.textContent ?? "");
}

function snapNode(el: Element): SnapNode {
  const attrs: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) attrs[a.name.toLowerCase()] = a.value;
  return { tag: el.tagName.toLowerCase(), attrs, children: [] };
}

/** The interactive element at or around a node: a click on a label's text hits the control. */
function interactive(el: Element): Element {
  return el.closest('a[href], button, input, select, textarea, summary, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="tab"], [role="menuitem"], [role="switch"], [role="textbox"], [contenteditable=""], [contenteditable="true"]') ?? el;
}

function describe(el: Element): ProbeResult {
  const r = el.getBoundingClientRect();
  const x = Math.round(Math.min(Math.max(r.left + r.width / 2, 0), window.innerWidth - 1));
  const y = Math.round(Math.min(Math.max(r.top + r.height / 2, 0), window.innerHeight - 1));
  const tag = el.tagName.toLowerCase();
  const redacted = isSensitiveField(snapNode(el));
  return {
    x,
    y,
    name: redacted && tag !== "input" ? "" : nameOf(el),
    role: roleOf(el),
    tag,
    ...(el instanceof HTMLInputElement ? { type: el.type.toLowerCase() } : {}),
    ...(el instanceof HTMLAnchorElement ? { href: el.href.slice(0, 200) } : {}),
    ...(redacted ? { redacted: true } : {}),
    ...((el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true" ? { disabled: true } : {}),
    ...(el.closest("form") ? { inForm: true } : {}),
  };
}

function fire(el: Element, type: string, init: MouseEventInit & { x?: number; y?: number } = {}): boolean {
  const { x, y, ...rest } = init;
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, ...rest });
  return el.dispatchEvent(ev);
}

function fireInput(el: Element): void {
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function setValue(el: Element, value: string): boolean {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    fireInput(el);
    return true;
  }
  if ((el as HTMLElement).isContentEditable) {
    (el as HTMLElement).textContent = value;
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    return true;
  }
  return false;
}

function typeable(el: Element): boolean {
  if (el instanceof HTMLTextAreaElement || (el as HTMLElement).isContentEditable) return true;
  return el instanceof HTMLInputElement && TEXT_INPUT_TYPES.has((el.type || "").toLowerCase());
}

const KEY_CODES: Record<string, string> = { Enter: "Enter", Tab: "Tab", Escape: "Escape", Backspace: "Backspace", Delete: "Delete", " ": "Space" };

export function taskDomPage(refs: Map<string, Element>, win: Window): TaskPage {
  const doc = win.document;
  const find = (target: Target | "focused"): Element | null => {
    if (target === "focused") return doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : null;
    if ("ref" in target) {
      const el = refs.get(target.ref);
      return el && el.isConnected ? el : null;
    }
    const hit = doc.elementFromPoint(target.x, target.y);
    return hit ? interactive(hit) : null;
  };
  const point = (target: Target, el: Element): { x: number; y: number } => {
    if ("ref" in target) {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    return { x: target.x, y: target.y };
  };
  return {
    probe(target) {
      const el = find(target);
      return el ? describe(el) : null;
    },
    click(target, kind) {
      const el = find(target);
      if (!el) return false;
      (el as HTMLElement).scrollIntoView?.({ block: "center", inline: "nearest" });
      const p = point(target, el);
      const common = { x: p.x, y: p.y };
      if (kind === "right_click") {
        fire(el, "pointerdown", { ...common, button: 2, buttons: 2 });
        fire(el, "mousedown", { ...common, button: 2, buttons: 2 });
        fire(el, "pointerup", { ...common, button: 2 });
        fire(el, "mouseup", { ...common, button: 2 });
        fire(el, "contextmenu", { ...common, button: 2 });
        return true;
      }
      fire(el, "pointerdown", { ...common, button: 0, buttons: 1 });
      fire(el, "mousedown", { ...common, button: 0, buttons: 1 });
      if (el instanceof HTMLElement && typeof el.focus === "function") el.focus({ preventScroll: true });
      fire(el, "pointerup", { ...common, button: 0 });
      fire(el, "mouseup", { ...common, button: 0 });
      // HTMLElement.click() runs the element's activation behavior (links,
      // submit buttons, checkboxes), which a synthetic click event alone does not.
      if (el instanceof HTMLElement) el.click();
      else fire(el, "click", common);
      if (kind === "double_click") {
        fire(el, "mousedown", { ...common, button: 0, buttons: 1, detail: 2 });
        fire(el, "mouseup", { ...common, button: 0, detail: 2 });
        fire(el, "click", { ...common, detail: 2 });
        fire(el, "dblclick", { ...common, detail: 2 });
      }
      return true;
    },
    type(target, text) {
      const el = target ? find(target) : find("focused");
      if (!el || !typeable(el)) return false;
      (el as HTMLElement).focus?.({ preventScroll: true });
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return setValue(el, el.value + text);
      (el as HTMLElement).textContent = ((el as HTMLElement).textContent ?? "") + text;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      return true;
    },
    fill(target, value) {
      const el = find(target);
      if (!el) return false;
      if (el instanceof HTMLSelectElement) {
        const want = value.trim().toLowerCase();
        const opts = Array.from(el.options);
        const hit = opts.find((o) => o.value === value) ?? opts.find((o) => o.text.trim().toLowerCase() === want) ?? opts.find((o) => o.value.toLowerCase() === want);
        if (!hit || hit.disabled) return false;
        el.value = hit.value;
        fireInput(el);
        return true;
      }
      if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
        const on = /^(true|yes|on|1|checked)$/i.test(value.trim());
        if (el.checked !== on) el.click();
        return true;
      }
      if (!typeable(el)) return false;
      (el as HTMLElement).focus?.({ preventScroll: true });
      return setValue(el, value);
    },
    key(target, key, modifiers) {
      const el = target ? find(target) : (find("focused") ?? doc.body);
      if (!el) return false;
      const init: KeyboardEventInit = {
        key,
        code: KEY_CODES[key] ?? (key.length === 1 ? "Key" + key.toUpperCase() : key),
        bubbles: true,
        cancelable: true,
        composed: true,
        shiftKey: modifiers.includes("shift"),
        ctrlKey: modifiers.includes("control"),
        altKey: modifiers.includes("alt"),
        metaKey: modifiers.includes("meta"),
      };
      const down = el.dispatchEvent(new KeyboardEvent("keydown", init));
      if (down && key.length === 1 && typeable(el) && !modifiers.includes("control") && !modifiers.includes("meta")) {
        el.dispatchEvent(new KeyboardEvent("keypress", init));
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) setValue(el, el.value + key);
      } else if (down && key === "Enter") {
        // Enter in a form field submits the form, as the browser would.
        const form = el instanceof HTMLInputElement && !(el.type === "textarea") ? el.form : null;
        if (form) form.requestSubmit?.() ?? form.submit();
        else if (el instanceof HTMLElement && (el.tagName === "BUTTON" || el.tagName === "A")) el.click();
      } else if (down && key === " " && el instanceof HTMLElement && (el.tagName === "BUTTON" || el.getAttribute("role") === "button" || el.getAttribute("role") === "checkbox")) {
        el.click();
      } else if (down && key === "Backspace" && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
        // Synthetic key events have no default action: emulate the ones a task needs.
        setValue(el, el.value.slice(0, -1));
      } else if (down && key === "Tab") {
        const focusables = Array.from(doc.querySelectorAll<HTMLElement>("a[href],button,input,select,textarea,[tabindex]:not([tabindex='-1'])")).filter(
          (f) => !(f as HTMLButtonElement).disabled && f.getClientRects().length > 0,
        );
        const i = focusables.indexOf(el as HTMLElement);
        const next = modifiers.includes("shift") ? (i - 1 + focusables.length) % Math.max(1, focusables.length) : (i + 1) % Math.max(1, focusables.length);
        focusables[next]?.focus();
      }
      el.dispatchEvent(new KeyboardEvent("keyup", init));
      return true;
    },
    scroll(direction: ScrollDirection, amount, target) {
      const el = target ? find(target) : null;
      const box = el && el !== doc.documentElement && el !== doc.body ? el : null;
      const stepY = amount ?? win.innerHeight * 0.8;
      const stepX = amount ?? win.innerWidth * 0.8;
      const delta =
        direction === "down" ? { top: stepY } : direction === "up" ? { top: -stepY } : direction === "right" ? { left: stepX } : direction === "left" ? { left: -stepX } : null;
      if (box) {
        if (direction === "top") box.scrollTop = 0;
        else if (direction === "bottom") box.scrollTop = box.scrollHeight;
        else if (delta) box.scrollBy(delta);
        return true;
      }
      if (direction === "top") win.scrollTo({ top: 0 });
      else if (direction === "bottom") win.scrollTo({ top: doc.documentElement.scrollHeight });
      else if (delta) win.scrollBy(delta);
      return true;
    },
    scrollTo(target) {
      const el = find(target);
      if (!el) return false;
      (el as HTMLElement).scrollIntoView?.({ block: "center", inline: "nearest" });
      return true;
    },
    drag(from, to) {
      const el = find(from);
      if (!el) return false;
      const a = point(from, el);
      const dest = find(to);
      const b = "ref" in to ? (dest ? point(to, dest) : null) : { x: to.x, y: to.y };
      if (!b) return false;
      const over = doc.elementFromPoint(b.x, b.y) ?? doc.body;
      fire(el, "pointerdown", { x: a.x, y: a.y, button: 0, buttons: 1 });
      fire(el, "mousedown", { x: a.x, y: a.y, button: 0, buttons: 1 });
      el.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, clientX: a.x, clientY: a.y }));
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      for (const p of [mid, b]) {
        fire(over, "pointermove", { x: p.x, y: p.y, buttons: 1 });
        fire(over, "mousemove", { x: p.x, y: p.y, buttons: 1 });
        over.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y }));
      }
      over.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, clientX: b.x, clientY: b.y }));
      el.dispatchEvent(new DragEvent("dragend", { bubbles: true, clientX: b.x, clientY: b.y }));
      fire(over, "pointerup", { x: b.x, y: b.y, button: 0 });
      fire(over, "mouseup", { x: b.x, y: b.y, button: 0 });
      return true;
    },
  };
}
