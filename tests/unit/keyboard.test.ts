import { describe, expect, it } from "vitest";
import { editableFocused, fitAboveKeyboard, keyboardHeight, type ViewportLike } from "../../src/panel/keyboard";

/** A visual viewport the test resizes by hand, like the keyboard sliding up. */
class FakeViewport implements ViewportLike {
  height: number;
  offsetTop = 0;
  private listeners: Array<() => void> = [];
  constructor(height: number) {
    this.height = height;
  }
  addEventListener(_type: "resize" | "scroll", listener: () => void): void {
    this.listeners.push(listener);
  }
  show(height: number, offsetTop = 0): void {
    this.height = height;
    this.offsetTop = offsetTop;
    for (const l of this.listeners) l();
  }
}

describe("iPhone keyboard keeps the composer visible (owner bug, 2026-10-18)", () => {
  it("sizes the panel to the area above the keyboard, and back when it closes", () => {
    const win = { innerHeight: 800, scrolls: 0, scrollTo() { this.scrolls++; } };
    const view = new FakeViewport(800);
    const body = { style: { height: "" } };
    fitAboveKeyboard(win, view, body);
    expect(body.style.height).toBe("");

    view.show(430);
    expect(body.style.height).toBe("430px");

    view.show(430, 250);
    expect(body.style.height).toBe("430px");
    expect(win.scrolls).toBeGreaterThan(0);

    view.show(800);
    expect(body.style.height).toBe("");
  });

  it("ignores small differences that are not a keyboard", () => {
    expect(keyboardHeight(800, { height: 790 })).toBeNull();
    expect(keyboardHeight(800, { height: 500.4 })).toBe(500);
  });
});

describe("dragging the iPhone sheet stays smooth (owner bug, 2026-10-18)", () => {
  it("does not resize the panel while the sheet moves and no text field has focus", () => {
    const win = { innerHeight: 800, scrolls: 0, scrollTo() { this.scrolls++; } };
    const view = new FakeViewport(800);
    const body = { style: { height: "" } };
    let focused = false;
    fitAboveKeyboard(win, view, body, () => focused);
    // Mid-drag, the visual viewport lags innerHeight by more than a keyboard.
    win.innerHeight = 700;
    view.show(560, 12);
    expect(body.style.height).toBe("");
    expect(win.scrolls).toBe(0);

    focused = true;
    view.show(430);
    expect(body.style.height).toBe("430px");
  });

  it("folds viewport events into one update per frame", () => {
    const frames: Array<() => void> = [];
    let writes = 0;
    const style = { _h: "", get height() { return this._h; }, set height(v: string) { writes++; this._h = v; } };
    const win = { innerHeight: 800, scrollTo() {}, requestAnimationFrame: (cb: () => void) => frames.push(cb) };
    const view = new FakeViewport(800);
    fitAboveKeyboard(win, view, { style });
    view.show(500);
    view.show(450);
    view.show(430);
    expect(frames).toHaveLength(1);
    frames.shift()!();
    expect(style.height).toBe("430px");
    expect(writes).toBe(1);
  });

  it("knows which focused elements bring up the keyboard", () => {
    const el = (tagName: string, type?: string, editable = false) =>
      ({ tagName, getAttribute: () => type ?? null, isContentEditable: editable }) as unknown as Element;
    expect(editableFocused(null)).toBe(false);
    expect(editableFocused(el("TEXTAREA"))).toBe(true);
    expect(editableFocused(el("INPUT"))).toBe(true);
    expect(editableFocused(el("INPUT", "password"))).toBe(true);
    expect(editableFocused(el("INPUT", "checkbox"))).toBe(false);
    expect(editableFocused(el("BUTTON"))).toBe(false);
    expect(editableFocused(el("DIV", undefined, true))).toBe(true);
  });
});
