import { describe, expect, it } from "vitest";
import { fitAboveKeyboard, keyboardHeight, type ViewportLike } from "../../src/panel/keyboard";

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
