import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { applyLook, cachedLook, cacheLook, DEFAULT_LOOK, defaultLook, LOOK_CACHE_KEY, LOOKS, parseLook } from "../../src/panel/look";

// Looks (owner choice 2026-10-19): Trailhead by default, five others in Settings.
describe("looks", () => {
  it("defaults to Trailhead and keeps the other ten on offer (five more 2026-10-26)", () => {
    expect(DEFAULT_LOOK).toBe("trailhead");
    expect(LOOKS.map((l) => l.id)).toEqual(["trailhead", "apple", "glasshouse", "aurora", "bento", "pebble", "cinema", "nightops", "dealhunter", "ink", "classic"]);
  });

  it("iPhone and iPad open in Pure Apple, with only \"Ask Scout\" above the starters (owner 2026-10-19)", () => {
    expect(defaultLook(true)).toBe("apple");
    expect(defaultLook(false)).toBe("trailhead");
    expect(parseLook(undefined, "apple")).toBe("apple");
    expect(cachedLook({ getItem: () => null }, "apple")).toBe("apple");
    expect(cachedLook({ getItem: () => { throw new Error("blocked"); } }, "apple")).toBe("apple");
    expect(LOOKS.find((l) => l.id === "apple")?.greeting).toEqual({ title: "Ask Scout", sub: "" });
  });

  it("reads only known looks; anything else is the default", () => {
    expect(parseLook("nightops")).toBe("nightops");
    expect(parseLook("purple")).toBe("trailhead");
    expect(parseLook(undefined)).toBe("trailhead");
    expect(parseLook(42)).toBe("trailhead");
  });

  it("uses the cached look, and the default when storage throws or is missing", () => {
    expect(cachedLook({ getItem: (k) => (k === LOOK_CACHE_KEY ? "ink" : null) })).toBe("ink");
    expect(cachedLook({ getItem: () => { throw new Error("blocked"); } })).toBe("trailhead");
    expect(cachedLook(undefined)).toBe("trailhead");
    const saved: Record<string, string> = {};
    cacheLook({ setItem: (k, v) => void (saved[k] = v) }, "apple");
    expect(saved).toEqual({ [LOOK_CACHE_KEY]: "apple" });
    expect(() => cacheLook({ setItem: () => { throw new Error("quota"); } }, "apple")).not.toThrow();
  });

  it("sets the page attribute and the greeting; Classic has no greeting", () => {
    const nodes: Record<string, { textContent: string; hidden: boolean }> = {
      "greeting-title": { textContent: "", hidden: false },
      "greeting-sub": { textContent: "", hidden: false },
      greeting: { textContent: "", hidden: false },
    };
    const doc = { documentElement: { dataset: {} as Record<string, string> }, getElementById: (id: string) => nodes[id] ?? null } as unknown as Document;
    applyLook(doc, "dealhunter");
    expect(doc.documentElement.dataset.look).toBe("dealhunter");
    expect(nodes["greeting-title"].textContent).toBe("What are we hunting?");
    expect(nodes.greeting.hidden).toBe(false);
    applyLook(doc, "classic");
    expect(nodes.greeting.hidden).toBe(true);
  });

  it("every look but Classic has its own CSS in the panel, and the panel starts in Trailhead", () => {
    const html = readFileSync(new URL("../../src/popup.html", import.meta.url).pathname, "utf8");
    expect(html).toMatch(/<html lang="en" data-look="trailhead">/);
    for (const l of LOOKS.filter((x) => x.id !== "classic")) {
      expect(html).toContain(`:root[data-look="${l.id}"] {`);
      // A dark set for every look.
      expect(html).toMatch(new RegExp(`@media \\(prefers-color-scheme: dark\\) \\{\\s*:root\\[data-look="${l.id}"\\] \\{`));
    }
  });

  it("round-two looks have no subtitle and stay solid: no blur and nothing fixed in their CSS", () => {
    const html = readFileSync(new URL("../../src/popup.html", import.meta.url).pathname, "utf8");
    const start = html.indexOf("Looks, round two");
    expect(start).toBeGreaterThan(0);
    const css = html.slice(start, html.indexOf("</style>", start));
    expect(css).not.toMatch(/backdrop-filter|position:\s*fixed|@keyframes/);
    for (const id of ["glasshouse", "aurora", "bento", "pebble", "cinema"] as const) {
      expect(LOOKS.find((l) => l.id === id)?.greeting.sub).toBe("");
    }
  });
});
