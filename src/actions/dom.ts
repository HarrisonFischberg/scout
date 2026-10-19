// DOM adapter for the action executor (T009). Content script only; exercised
// by Playwright (tests/e2e/actions.spec.ts), not Vitest (no DOM there).
import type { ActionEl, ActionPage } from "./executor";
import { aboveSheetScroll, type Pointer } from "./pointer";

function fireInput(el: Element): void {
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/** `aboveSheet`: iPhone, where Safari's sheet covers the bottom half of the page (pointer.ts). */
function wrap(el: Element, pointer?: Pointer, aboveSheet = false): ActionEl {
  const input = el as HTMLInputElement;
  const setValue = (value: string): void => {
    // Use the prototype setter so frameworks that track the value see it.
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else input.value = value;
    (el as HTMLElement).focus();
    fireInput(el);
  };
  const visible: Pick<ActionEl, "showClick" | "typeVisibly"> = pointer
    ? {
        async showClick() {
          await pointer.moveTo(el);
          await pointer.press();
        },
        async typeVisibly(start, text) {
          await pointer.moveTo(el);
          await pointer.press();
          // Each character is a real value change with its input event, as a person typing would make.
          let value = start;
          setValue(value);
          for (const ch of text) {
            await pointer.keyPause();
            if (!el.isConnected) break;
            value += ch;
            setValue(value);
          }
        },
      }
    : {};
  return {
    ...visible,
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
    setValue,
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
    scrollIntoView() {
      if (!aboveSheet) return (el as HTMLElement).scrollIntoView({ block: "center" });
      // Instant, so the box is measured where it ends up (a page may scroll smoothly by default).
      (el as HTMLElement).scrollIntoView({ block: "center", behavior: "instant" });
      const r = el.getBoundingClientRect();
      const by = aboveSheetScroll(r.top, r.bottom, el.ownerDocument.defaultView?.innerHeight ?? 0);
      if (by) el.ownerDocument.defaultView?.scrollBy({ top: by, behavior: "instant" });
    },
  };
}

/** `pointer`: coupon runs show a pointer moving, pressing and typing on the page. */
export function domPage(refs: Map<string, Element>, win: Window, pointer?: Pointer, aboveSheet = false): ActionPage {
  return {
    baseUrl: win.location.href,
    resolve(ref) {
      const el = refs.get(ref);
      return el ? wrap(el, pointer, aboveSheet) : undefined;
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
