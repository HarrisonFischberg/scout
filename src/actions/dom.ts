// DOM adapter for the action executor (T009). Content script only; exercised
// by Playwright (tests/e2e/actions.spec.ts), not Vitest (no DOM there).
import type { ActionEl, ActionPage } from "./executor";

function fireInput(el: Element): void {
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function wrap(el: Element): ActionEl {
  const input = el as HTMLInputElement;
  return {
    tag: el.tagName.toLowerCase(),
    type: el instanceof HTMLInputElement ? el.type : undefined,
    get disabled() {
      return (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true";
    },
    get connected() {
      return el.isConnected;
    },
    click: () => (el as HTMLElement).click(),
    getValue: () => input.value ?? "",
    setValue(value: string) {
      // Use the prototype setter so frameworks that track the value see it.
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, value);
      else input.value = value;
      (el as HTMLElement).focus();
      fireInput(el);
    },
    select(value: string) {
      if (!(el instanceof HTMLSelectElement)) return false;
      const want = value.trim().toLowerCase();
      const opts = Array.from(el.options);
      const hit =
        opts.find((o) => o.value === value) ??
        opts.find((o) => o.text.trim().toLowerCase() === want) ??
        opts.find((o) => o.value.toLowerCase() === want);
      if (!hit || hit.disabled) return false;
      el.value = hit.value;
      fireInput(el);
      return true;
    },
    scrollIntoView: () => (el as HTMLElement).scrollIntoView({ block: "center" }),
  };
}

export function domPage(refs: Map<string, Element>, win: Window): ActionPage {
  return {
    baseUrl: win.location.href,
    resolve(ref) {
      const el = refs.get(ref);
      return el ? wrap(el) : undefined;
    },
    scroll(direction) {
      const h = win.document.documentElement.scrollHeight;
      const step = win.innerHeight * 0.8;
      if (direction === "top") win.scrollTo({ top: 0 });
      else if (direction === "bottom") win.scrollTo({ top: h });
      else win.scrollBy({ top: direction === "down" ? step : -step });
    },
    navigate(url) {
      win.location.assign(url);
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}
