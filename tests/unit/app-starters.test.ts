// Fresh starter questions on each app launch (owner request 2026-11-02).
import { describe, expect, it } from "vitest";
import { STARTERS, STARTER_COUNT, pickStarters } from "../../src/app/starters";

function seeded(seed: number): () => number {
  return () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
}

describe("app starter questions", () => {
  it("has a large pool with no duplicates", () => {
    expect(STARTERS.length).toBeGreaterThanOrEqual(50);
    expect(new Set(STARTERS.map((s) => s.text)).size).toBe(STARTERS.length);
  });

  it("picks four from four different topics", () => {
    for (let i = 1; i < 50; i++) {
      const picked = pickStarters({ web: true }, seeded(i));
      expect(picked).toHaveLength(STARTER_COUNT);
      const topics = picked.map((t) => STARTERS.find((s) => s.text === t)!.topic);
      expect(new Set(topics).size).toBe(STARTER_COUNT);
    }
  });

  it("changes between loads and avoids the last set", () => {
    let last: string[] = [];
    const seen = new Set<string>();
    for (let i = 1; i < 20; i++) {
      const picked = pickStarters({ web: true, avoid: last }, seeded(i));
      for (const t of picked) expect(last).not.toContain(t);
      picked.forEach((t) => seen.add(t));
      last = picked;
    }
    expect(seen.size).toBeGreaterThan(30);
  });

  it("offers web questions like the news only when Claude can search", () => {
    const web = new Set(STARTERS.filter((s) => s.web).map((s) => s.text));
    expect(web.has("What happened in the news today?")).toBe(true);
    for (let i = 1; i < 100; i++) {
      for (const t of pickStarters({ web: false }, seeded(i))) expect(web.has(t)).toBe(false);
    }
  });
});
