import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { applyLook, cachedLook, cacheLook, DEFAULT_LOOK, defaultLook, LOOK_CACHE_KEY, LOOKS, parseLook } from "../../src/panel/look";

// Looks are color schemes (owner 2026-11-10): Bumper green by default everywhere, the six earlier looks still in Settings.
describe("looks", () => {
  it("defaults to Bumper and keeps all six earlier looks on offer (owner 2026-11-10)", () => {
    expect(DEFAULT_LOOK).toBe("bumper");
    expect(LOOKS.map((l) => l.id)).toEqual(["bumper", "glasshouse", "apple", "bento", "pebble", "cinema", "nightops"]);
  });

  it("iPhone, iPad and Mac all open in Bumper (owner 2026-11-10); a passed fallback still wins", () => {
    expect(defaultLook(true)).toBe("bumper");
    expect(defaultLook(false)).toBe("bumper");
    expect(parseLook(undefined, "apple")).toBe("apple");
    expect(cachedLook({ getItem: () => null }, "apple")).toBe("apple");
    expect(cachedLook({ getItem: () => { throw new Error("blocked"); } }, "apple")).toBe("apple");
    expect(LOOKS.find((l) => l.id === "glasshouse")?.greeting).toEqual({ title: "Ask Scout anything", sub: "" });
  });

  it("reads only known looks; anything else is the default", () => {
    expect(parseLook("nightops")).toBe("nightops");
    expect(parseLook("glasshouse")).toBe("glasshouse");
    expect(parseLook("purple")).toBe("bumper");
    expect(parseLook(undefined)).toBe("bumper");
    expect(parseLook(42)).toBe("bumper");
  });

  it("uses the cached look, and the default when storage throws or is missing", () => {
    expect(cachedLook({ getItem: (k) => (k === LOOK_CACHE_KEY ? "pebble" : null) })).toBe("pebble");
    expect(cachedLook({ getItem: () => { throw new Error("blocked"); } })).toBe("bumper");
    expect(cachedLook(undefined)).toBe("bumper");
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

  it("every look has its own colors in the panel, light and dark, and the panel starts in Bumper", () => {
    const html = readFileSync(new URL("../../src/popup.html", import.meta.url).pathname, "utf8");
    expect(html).toMatch(/<html lang="en" data-look="bumper">/);
    for (const l of LOOKS) {
      expect(html).toContain(`:root[data-look="${l.id}"] {`);
      // A dark set for every look.
      expect(html).toMatch(new RegExp(`@media \\(prefers-color-scheme: dark\\) \\{\\s*:root\\[data-look="${l.id}"\\] \\{`));
    }
  });

  it("a look only sets colors: the Bumper structure is the same in every one, solid, with nothing blurred or fixed", () => {
    for (const file of ["popup.html", "app.html"]) {
      const html = readFileSync(new URL("../../src/" + file, import.meta.url).pathname, "utf8");
      // Every rule keyed on a look is a token block: the selector ends right at the brace.
      for (const m of html.matchAll(/:root\[data-look="\w+"\]([^\n]*)/g)) expect(m[1]).toBe(" {");
      const start = html.indexOf("Color schemes");
      expect(start).toBeGreaterThan(0);
      expect(html.slice(start, html.indexOf("</style>", start))).not.toMatch(/backdrop-filter|position:\s*fixed/);
    }
    for (const l of LOOKS) expect(l.greeting.sub).toBe("");
  });

  it("the confirm card offers Deny first, then Allow once, then Always allow (owner 2026-11-10)", () => {
    const html = readFileSync(new URL("../../src/popup.html", import.meta.url).pathname, "utf8");
    const card = html.slice(html.indexOf('<section id="confirm"'), html.indexOf('<section id="tool-ask"'));
    expect([...card.matchAll(/<button id="(confirm-\w+)"/g)].map((m) => m[1])).toEqual(["confirm-deny", "confirm-once", "confirm-always"]);
  });

  it("a removed look (Trailhead, Deal Hunter, Ink & Paper, Aurora, Classic) opens in the default, and its CSS is gone (owner 2026-10-26)", () => {
    const html = readFileSync(new URL("../../src/popup.html", import.meta.url).pathname, "utf8");
    for (const old of ["trailhead", "dealhunter", "ink", "aurora", "classic"]) {
      expect(parseLook(old)).toBe("bumper");
      expect(cachedLook({ getItem: () => old })).toBe("bumper");
      expect(html).not.toContain(`data-look="${old}"`);
    }
  });
});

describe("look shared with the Scout app (owner 2026-11-02)", () => {
  it("reads a known look from the shared Keychain item, and nothing else", async () => {
    const { readSharedLook, writeSharedLook, SHARED_LOOK_ACCOUNT } = await import("../../src/panel/look");
    const sent: unknown[] = [];
    expect(await readSharedLook(async (m) => (sent.push(m), { ok: true, value: "bento" }))).toBe("bento");
    expect(sent).toEqual([{ type: "keychain.get", account: SHARED_LOOK_ACCOUNT }]);
    expect(await readSharedLook(async () => ({ ok: true, value: "aurora" }))).toBeNull();
    expect(await readSharedLook(async () => ({ ok: true }))).toBeNull();
    expect(await readSharedLook(async () => ({ ok: false, error: "keychain_error" }))).toBeNull();
    expect(await readSharedLook(async () => { throw new Error("no native"); })).toBeNull();
    const written: unknown[] = [];
    await writeSharedLook(async (m) => (written.push(m), { ok: true }), "pebble");
    expect(written).toEqual([{ type: "keychain.set", account: "look", value: "pebble" }]);
    await expect(writeSharedLook(async () => { throw new Error("no native"); }, "pebble")).resolves.toBeUndefined();
  });
});
