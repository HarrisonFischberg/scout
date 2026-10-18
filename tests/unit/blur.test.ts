import { afterEach, describe, expect, it, vi } from "vitest";
import { PANEL_EVENTS, checkSchema } from "../../src/bridge/messages";
import { addPageBlur, BLUR_PING_MS, BLUR_TIMEOUT_MS, PAGE_BLUR_BOTTOM_GAP_PX, PAGE_BLUR_PX, PAGE_DIM, wantsPageBlur } from "../../src/panel/blur";

describe("page blur behind the panel (owner design 2026-10-17)", () => {
  it("only on a phone-sized touch screen", () => {
    expect(wantsPageBlur(true, 390)).toBe(true);
    expect(wantsPageBlur(true, 820)).toBe(false); // iPad: a popover, the page stays clear
    expect(wantsPageBlur(false, 390)).toBe(false); // Mac
  });

  it("panel.hello may say the page was blurred", () => {
    expect(checkSchema(PANEL_EVENTS["panel.hello"], { tabId: 1, blur: true })).toBeNull();
    expect(checkSchema(PANEL_EVENTS["panel.hello"], { tabId: 1 })).toBeNull();
    expect(checkSchema(PANEL_EVENTS["panel.hello"], { tabId: 1, blur: "yes" })).not.toBeNull();
  });

  it("is at least 35% lighter than the first design (owner, 2026-10-18)", () => {
    expect(parseFloat(PAGE_DIM)).toBeLessThanOrEqual(18 * 0.65);
    expect(PAGE_BLUR_PX).toBeLessThanOrEqual(14 * 0.65);
    // addPageBlur is injected on its own, so it spells the values out; keep them in step.
    const src = addPageBlur.toString();
    expect(src).toContain(`rgb(0 0 0 / ${PAGE_DIM})`);
    expect(src).toContain(`blur(${PAGE_BLUR_PX}px)`);
  });

  // Owner bug report 2026-10-18: closing Scout flashed a solid strip under
  // Safari's bottom bar while the full-screen layer was still on the page.
  it("stops above the bottom edge, so Safari never paints a solid strip under its bar", () => {
    const src = addPageBlur.toString();
    expect(PAGE_BLUR_BOTTOM_GAP_PX).toBeGreaterThanOrEqual(64);
    expect(src).toContain(`bottom: ${PAGE_BLUR_BOTTOM_GAP_PX}px`);
    expect(src).not.toMatch(/inset:\s*0/);
  });

  // Owner bug report 2026-10-18: after closing Scout the page stayed frosted
  // until the worker woke up to remove the layer.
  describe("clears itself when the panel closes", () => {
    const ID = "__safari-scout-blur";
    let listener: ((m: unknown) => void) | null = null;
    let layer: { id: string; removed: boolean } | null = null;
    const fakePage = (): void => {
      listener = null;
      layer = null;
      const el = { id: "", removed: false, style: { cssText: "" }, setAttribute() {}, remove() { el.removed = true; layer = null; } };
      vi.stubGlobal("document", {
        getElementById: (id: string) => (layer && layer.id === id ? el : null),
        createElement: () => {
          el.removed = false;
          return el;
        },
        body: { appendChild: (x: typeof el) => (layer = x) },
      });
      vi.stubGlobal("browser", { runtime: { onMessage: { addListener: (f: (m: unknown) => void) => (listener = f) } } });
      delete (globalThis as { __scoutBlur?: unknown }).__scoutBlur;
    };
    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it("stays while the panel pings it, and goes the moment the panel says goodbye", () => {
      vi.useFakeTimers();
      fakePage();
      addPageBlur(ID, BLUR_TIMEOUT_MS);
      expect(layer).not.toBeNull();
      for (let t = 0; t < 3000; t += BLUR_PING_MS) {
        vi.advanceTimersByTime(BLUR_PING_MS);
        listener?.({ blur: ID, alive: true });
      }
      expect(layer).not.toBeNull();
      listener?.({ blur: ID, alive: false });
      expect(layer).toBeNull();
    });

    it("takes itself off when the panel goes quiet, even if nobody removes it", () => {
      vi.useFakeTimers();
      fakePage();
      addPageBlur(ID, BLUR_TIMEOUT_MS);
      vi.advanceTimersByTime(BLUR_TIMEOUT_MS - 1);
      expect(layer).not.toBeNull();
      vi.advanceTimersByTime(2);
      expect(layer).toBeNull();
      expect(BLUR_TIMEOUT_MS).toBeGreaterThanOrEqual(BLUR_PING_MS * 3);
      expect(BLUR_TIMEOUT_MS).toBeLessThanOrEqual(1000);
    });

    it("ignores messages that are not its own", () => {
      vi.useFakeTimers();
      fakePage();
      addPageBlur(ID, BLUR_TIMEOUT_MS);
      listener?.({ blur: "other", alive: false });
      listener?.("hello");
      listener?.(null);
      expect(layer).not.toBeNull();
    });
  });
});
