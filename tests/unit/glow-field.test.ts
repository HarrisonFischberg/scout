// Procedural glow field for the overlay: counts, bounds, edge bias, and a new
// pattern per run. Seeded generator, no DOM.
import { describe, expect, it } from "vitest";
import { GLOW_COLORS, ORBS, SPARKLE_COLORS, SPARKLES, glowField, type Rng } from "../../src/glow-field";

function seeded(seed: number): Rng {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("glow field", () => {
  it("lays out the right number of orbs and sparkles for Mac and iPhone", () => {
    const mac = glowField(seeded(1), false);
    const phone = glowField(seeded(1), true);
    expect(mac.orbs).toHaveLength(ORBS.mac);
    expect(mac.sparkles).toHaveLength(SPARKLES.mac);
    expect(phone.orbs).toHaveLength(ORBS.phone);
    expect(phone.sparkles).toHaveLength(SPARKLES.phone);
  });

  it("keeps everything near the edges, in range, and in the blue palette", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const { orbs, sparkles } = glowField(seeded(seed), seed % 2 === 0);
      for (const o of orbs) {
        expect(Math.min(o.x, 100 - o.x, o.y, 100 - o.y)).toBeLessThanOrEqual(18);
        expect(o.x).toBeGreaterThanOrEqual(-5);
        expect(o.x).toBeLessThanOrEqual(105);
        expect(o.duration).toBeGreaterThanOrEqual(5000);
        expect(o.duration).toBeLessThanOrEqual(12000);
        expect(o.delay).toBeLessThanOrEqual(0);
        expect(o.peak).toBeGreaterThanOrEqual(0.3);
        expect(o.peak).toBeLessThanOrEqual(0.55);
        expect(GLOW_COLORS).toContain(o.color);
      }
      for (const p of sparkles) {
        expect(Math.min(p.x, 100 - p.x, p.y, 100 - p.y)).toBeLessThanOrEqual(24);
        expect(p.x).toBeGreaterThanOrEqual(1);
        expect(p.y).toBeLessThanOrEqual(99);
        expect(SPARKLE_COLORS).toContain(p.color);
      }
    }
  });

  it("is the same for the same seed and different for another", () => {
    expect(glowField(seeded(7), false)).toEqual(glowField(seeded(7), false));
    expect(glowField(seeded(7), false)).not.toEqual(glowField(seeded(8), false));
  });
});
