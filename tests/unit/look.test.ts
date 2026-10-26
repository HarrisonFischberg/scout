import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { applyLook, cachedLook, cacheLook, DEFAULT_LOOK, defaultLook, LOOK_CACHE_KEY, LOOKS, parseLook } from "../../src/panel/look";

// Looks (owner choices 2026-10-19 and 2026-10-26): Glasshouse by default everywhere, five others in Settings.
describe("looks", () => {
  it("defaults to Glasshouse and keeps the other five on offer (owner 2026-10-26)", () => {
    expect(DEFAULT_LOOK).toBe("glasshouse");
    expect(LOOKS.map((l) => l.id)).toEqual(["glasshouse", "apple", "bento", "pebble", "cinema", "nightops"]);
  });

  it("iPhone, iPad and Mac all open in Glasshouse (owner 2026-10-26); a passed fallback still wins", () => {
    expect(defaultLook(true)).toBe("glasshouse");
    expect(defaultLook(false)).toBe("glasshouse");
    expect(parseLook(undefined, "apple")).toBe("apple");
    expect(cachedLook({ getItem: () => null }, "apple")).toBe("apple");
    expect(cachedLook({ getItem: () => { throw new Error("blocked"); } }, "apple")).toBe("apple");
    expect(LOOKS.find((l) => l.id === "glasshouse")?.greeting).toEqual({ title: "Ask Scout anything", sub: "" });
  });

  it("reads only known looks; anything else is the default", () => {
    expect(parseLook("nightops")).toBe("nightops");
    expect(parseLook("purple")).toBe("glasshouse");
    expect(parseLook(undefined)).toBe("glasshouse");
    expect(parseLook(42)).toBe("glasshouse");
  });

  it("uses the cached look, and the default when storage throws or is missing", () => {
    expect(cachedLook({ getItem: (k) => (k === LOOK_CACHE_KEY ? "pebble" : null) })).toBe("pebble");
    expect(cachedLook({ getItem: () => { throw new Error("blocked"); } })).toBe("glasshouse");
    expect(cachedLook(undefined)).toBe("glasshouse");
    const saved: Record<string, string> = {};
    cacheLook({ setItem: (k, v) => void (saved[k] = v) }, "apple");
    expect(saved).toEqual({ [LOOK_CACHE_KEY]: "apple" });
    expect(() => cacheLook({ setItem: () => { throw new Error("quota"); } }, "apple")).not.toThrow();
  });

  it("sets the page attribute and the greeting", () => {
    const nodes: Record<string, { textContent: string; hidden: boolean }> = {
      "greeting-title": { textContent: "", hidden: false },
      "greeting-sub": { textContent: "", hidden: false },
      greeting: { textContent: "", hidden: false },
    };
    const doc = { documentElement: { dataset: {} as Record<string, string> }, getElementById: (id: string) => nodes[id] ?? null } as unknown as Document;
    applyLook(doc, "bento");
    expect(doc.documentElement.dataset.look).toBe("bento");
    expect(nodes["greeting-title"].textContent).toBe("Pick a start");
    expect(nodes.greeting.hidden).toBe(false);
  });

  it("every look has its own CSS in the panel, and the panel starts in Glasshouse", () => {
    const html = readFileSync(new URL("../../src/popup.html", import.meta.url).pathname, "utf8");
    expect(html).toMatch(/<html lang="en" data-look="glasshouse">/);
    for (const l of LOOKS) {
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
    for (const id of ["glasshouse", "bento", "pebble", "cinema"] as const) {
      expect(LOOKS.find((l) => l.id === id)?.greeting.sub).toBe("");
    }
  });

  it("a removed look (Trailhead, Deal Hunter, Ink & Paper, Aurora, Classic) opens in Glasshouse, and its CSS is gone (owner 2026-10-26)", () => {
    const html = readFileSync(new URL("../../src/popup.html", import.meta.url).pathname, "utf8");
    for (const old of ["trailhead", "dealhunter", "ink", "aurora", "classic"]) {
      expect(parseLook(old)).toBe("glasshouse");
      expect(cachedLook({ getItem: () => old })).toBe("glasshouse");
      expect(html).not.toContain(`data-look="${old}"`);
    }
  });
});
