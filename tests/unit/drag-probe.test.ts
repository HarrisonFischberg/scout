import { describe, expect, it } from "vitest";
import { DRAG_QUIET_MS, followSheetHeight, parseSheetHeightMode, probeDrag, sheetBodyHeight, summarizeDrag, type SheetHeightMode } from "../../src/panel/drag-probe";
import { fitAboveKeyboard, type ViewportLike } from "../../src/panel/keyboard";

describe("debug drag probe for the iPhone sheet (owner bug, 2026-10-18)", () => {
  it("sums up a drag in one line under the stage limit", () => {
    const line = summarizeDrag(
      [
        { at: 0, height: 400, view: 400, page: 400, gap: 136, composer: 10 },
        { at: 16, height: 420, view: 410, page: 400, gap: 116, composer: -10 },
        { at: 66, height: 480, view: 480, page: 616, gap: 0, composer: -126 },
      ],
      [16, 17, 40, 16],
      "window",
    );
    expect(line).toBe(
      "drag[window]: 3 resizes/66 ms, h 400->480, gap 33/50 ms, frames 4 slow 1 max 40, view-win -10..0, page-win -20..136, composer -126..10, starters 0..136",
    );
    expect(line.length).toBeLessThan(300);
  });

  it("logs once the sheet has been still for a moment", () => {
    let now = 0;
    const frames: Array<(t: number) => void> = [];
    const listeners: Array<() => void> = [];
    const win = {
      innerHeight: 400,
      visualViewport: { height: 400 },
      document: { documentElement: { clientHeight: 400 } },
      performance: { now: () => now },
      requestAnimationFrame: (cb: (t: number) => void) => frames.push(cb),
      addEventListener: (_: string, l: () => void) => listeners.push(l),
    } as unknown as Window;
    const lines: string[] = [];
    probeDrag(win, { starters: () => null, composer: () => null, mode: () => "page" }, (l) => lines.push(l));
    for (const h of [420, 440, 460]) {
      (win as { innerHeight: number }).innerHeight = h;
      now += 16;
      for (const l of listeners) l();
      frames.shift()?.(now);
    }
    expect(lines).toEqual([]);
    now += DRAG_QUIET_MS + 1;
    frames.shift()?.(now);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^drag\[page\]: 3 resizes\/32 ms, h 420->460, .*page-win -60\.\.-20, composer n\/a, starters n\/a$/);
  });
});

describe("debug panel height experiment (owner bug, 2026-10-18)", () => {
  it("reads only known modes", () => {
    expect(parseSheetHeightMode("window")).toBe("window");
    expect(parseSheetHeightMode("visible")).toBe("visible");
    expect(parseSheetHeightMode(null)).toBe("page");
    expect(parseSheetHeightMode("tall")).toBe("page");
  });

  it("sizes the body from the chosen source on every resize, but not while typing", () => {
    const listeners: Array<() => void> = [];
    const win = {
      innerHeight: 500,
      visualViewport: { height: 470, addEventListener: (_: string, l: () => void) => listeners.push(l) },
      addEventListener: (_: string, l: () => void) => listeners.push(l),
    } as unknown as Window;
    const body = { style: { height: "" } };
    let mode: SheetHeightMode = "page";
    let typing = false;
    followSheetHeight(win, body, () => mode, () => typing);
    expect(body.style.height).toBe("");
    mode = "window";
    (win as { innerHeight: number }).innerHeight = 620;
    listeners[0]!();
    expect(body.style.height).toBe("620px");
    mode = "visible";
    listeners[0]!();
    expect(body.style.height).toBe("470px");
    typing = true;
    body.style.height = "300px";
    listeners[0]!();
    expect(body.style.height).toBe("300px");
    expect(sheetBodyHeight("page", 1, 1)).toBe("");
  });

  it("the keyboard fit goes back to the experiment's height, not the stylesheet's", () => {
    const listeners: Array<() => void> = [];
    const view: ViewportLike = { height: 800, offsetTop: 0, addEventListener: (_t, l) => listeners.push(l) };
    const body = { style: { height: "" } };
    fitAboveKeyboard({ innerHeight: 800, scrollTo() {} }, view, body, () => false, () => "800px");
    expect(body.style.height).toBe("800px");
  });
});
