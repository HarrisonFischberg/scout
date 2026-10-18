import { describe, expect, it } from "vitest";
import { cutAt, MAX_LAG_MS, nextShown, TYPING_CPS } from "../../src/panel/typing";

describe("steady reveal of a streamed answer", () => {
  it("types at the gentle pace when close behind the stream", () => {
    // 1 s of frames with 20 characters waiting: 20 shown, not more.
    let shown = 0;
    for (let i = 0; i < 60; i++) shown = nextShown(shown, 20, 1000 / 60);
    expect(shown).toBe(20);
    // A burst of 500 characters is not shown in one frame.
    expect(nextShown(0, 500, 16)).toBeLessThan(5);
    expect(nextShown(0, 40, 1000)).toBe(40);
    expect(nextShown(0, 1000, 100)).toBeGreaterThanOrEqual((TYPING_CPS * 100) / 1000);
  });

  it("catches up so it is never far behind once the answer finishes", () => {
    let shown = 0;
    let t = 0;
    while (shown < 4000 && t < 60_000) {
      shown = nextShown(shown, 4000, 16);
      t += 16;
    }
    // A 4,000-character answer that arrived all at once finishes within ~MAX_LAG plus the tail at TYPING_CPS.
    expect(shown).toBe(4000);
    expect(t).toBeLessThan(MAX_LAG_MS * 6);
  });

  it("shows everything after a long pause (hidden panel)", () => {
    expect(nextShown(3, 900, 5000)).toBe(900);
  });

  it("never splits an emoji", () => {
    const s = "Hi 👋 there";
    expect(cutAt(s, 4)).toBe(5);
    expect(cutAt(s, 3.7)).toBe(3);
    expect(cutAt(s, 99)).toBe(s.length);
  });
});
