import { describe, expect, it } from "vitest";
import { DRAG_SETTLE_MS, watchSheetDrag } from "../../src/panel/sheet-drag";

/** A window whose clock and timers the test drives by hand. */
function fakeWindow() {
  let now = 0;
  let listener = (): void => {};
  const timers = new Map<number, { at: number; cb: () => void }>();
  let next = 1;
  return {
    performance: { now: () => now },
    addEventListener: (_: "resize", l: () => void) => (listener = l),
    setTimeout: (cb: () => void, ms: number) => (timers.set(next, { at: now + ms, cb }), next++),
    clearTimeout: (id: number) => void timers.delete(id),
    resize(after: number) {
      this.advance(after);
      listener();
    },
    advance(ms: number) {
      now += ms;
      for (const [id, t] of [...timers]) if (t.at <= now) (timers.delete(id), t.cb());
    },
  };
}

describe("fade the starters while the iPhone sheet is dragged (owner choice, 2026-10-18)", () => {
  it("fades on a drag and comes back once the sheet settles", () => {
    const win = fakeWindow();
    const seen: boolean[] = [];
    watchSheetDrag(win, () => false, (on) => seen.push(on));
    win.resize(0);
    expect(seen).toEqual([]);
    win.resize(18);
    win.resize(18);
    win.resize(20);
    expect(seen).toEqual([true]);
    win.advance(DRAG_SETTLE_MS - 1);
    expect(seen).toEqual([true]);
    win.advance(2);
    expect(seen).toEqual([true, false]);
  });

  it("ignores single resizes such as the panel opening or a snap", () => {
    const win = fakeWindow();
    const seen: boolean[] = [];
    watchSheetDrag(win, () => false, (on) => seen.push(on));
    win.resize(0);
    win.resize(500);
    win.resize(900);
    expect(seen).toEqual([]);
  });

  it("does not fade while typing (the keyboard grows the sheet)", () => {
    const win = fakeWindow();
    const seen: boolean[] = [];
    watchSheetDrag(win, () => true, (on) => seen.push(on));
    win.resize(0);
    win.resize(16);
    win.resize(16);
    expect(seen).toEqual([]);
  });
});
