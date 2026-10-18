import { describe, expect, it } from "vitest";
import { DRAG_QUIET_MS, probeDrag, summarizeDrag } from "../../src/panel/drag-probe";

describe("debug drag probe for the iPhone sheet (owner bug, 2026-10-18)", () => {
  it("sums up a drag in one line", () => {
    const line = summarizeDrag(
      [
        { at: 0, height: 400, view: 400, gap: 120 },
        { at: 16, height: 420, view: 410, gap: 118 },
        { at: 66, height: 480, view: 480, gap: 120 },
      ],
      [16, 17, 40, 16],
    );
    expect(line).toBe(
      "drag: 3 resizes over 66 ms, height 400->480, resize gap avg 33 max 50 ms, frames 4 slow 1 max 40 ms, viewport off by up to 10px, starters 118-120px from bottom",
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
      performance: { now: () => now },
      requestAnimationFrame: (cb: (t: number) => void) => frames.push(cb),
      addEventListener: (_: string, l: () => void) => listeners.push(l),
    } as unknown as Window;
    const lines: string[] = [];
    probeDrag(win, () => null, (l) => lines.push(l));
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
    expect(lines[0]).toMatch(/^drag: 3 resizes over 32 ms, height 420->460, .*starters hidden$/);
  });
});
