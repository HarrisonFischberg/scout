import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clampY, coversAllSites, edgeMatches, isDrag, parsePageButton, reachText, sameMatches, snapSide, Y_MAX, Y_MIN } from "../../src/panel/edge";
import { openPanel } from "../../src/panel/toolbar";

describe("page button settings", () => {
  it("is off by default and drops malformed stored values", () => {
    expect(parsePageButton(undefined)).toEqual({ on: false, side: "right", y: 0.45 });
    expect(parsePageButton({ on: "yes", side: "top", y: "middle" })).toEqual({ on: false, side: "right", y: 0.45 });
    expect(parsePageButton({ on: true, side: "left", y: 0.3 })).toEqual({ on: true, side: "left", y: 0.3 });
  });

  it("keeps the tab clear of the page header and Safari's bottom bar", () => {
    expect(clampY(0)).toBe(Y_MIN);
    expect(clampY(1)).toBe(Y_MAX);
    expect(clampY(Number.NaN)).toBe(0.45);
    expect(parsePageButton({ on: true, y: 5 }).y).toBe(Y_MAX);
  });

  it("snaps a dragged tab to the nearer edge and tells taps from drags", () => {
    expect(snapSide(100, 390)).toBe("left");
    expect(snapSide(300, 390)).toBe("right");
    expect(isDrag(3, 4)).toBe(false);
    expect(isDrag(6, 6)).toBe(true);
  });
});

describe("where the edge script runs", () => {
  it("uses only granted web origins, never the AI provider hosts", () => {
    expect(
      edgeMatches(["https://shop.test/*", "https://api.anthropic.com/*", "https://api.openai.com/*", "file:///*", "not a pattern"]),
    ).toEqual(["https://shop.test/*"]);
    expect(edgeMatches(["<all_urls>"])).toEqual(["http://*/*", "https://*/*"]);
    expect(edgeMatches(["*://*.news.test/*"])).toEqual(["*://*.news.test/*"]);
  });

  it("compares registrations without caring about order", () => {
    expect(sameMatches(["b", "a"], ["a", "b"])).toBe(true);
    expect(sameMatches(["a"], ["a", "b"])).toBe(false);
  });

  it("describes where the button shows", () => {
    expect(coversAllSites(["http://*/*", "https://*/*"])).toBe(true);
    expect(coversAllSites(["https://*/*"])).toBe(false);
    expect(reachText(false, ["https://*/*"])).toBe("Off.");
    expect(reachText(true, ["*://*/*"])).toBe("On for every website.");
    expect(reachText(true, ["https://shop.test/*"])).toMatch(/^On for 1 site /);
    expect(reachText(true, [])).toMatch(/after you let Scout for Safari access it/);
  });
});

// Owner bug report 2026-10-16: tapping the page button crashed the page on
// iPhone. Safari ran the in-page sheet (an extension page in an iframe) in the
// page's own process, and WebKit kills that process when such a frame calls
// tabs.query ("Received an invalid message WebExtensionContext_TabsQuery").
// Expected: tapping opens Scout as a working chat. The tab now asks Safari to
// open the toolbar panel instead, and no extension page can be framed by sites.
describe("page button opens Scout's own panel", () => {
  it("opens the toolbar panel through Safari", async () => {
    let calls = 0;
    expect(await openPanel({ openPopup: async () => void (calls += 1) })).toEqual({ opened: true });
    expect(calls).toBe(1);
  });

  it("reports when Safari cannot open it, so the tab can point to the page menu", async () => {
    expect(await openPanel(undefined)).toEqual({ opened: false });
    expect(await openPanel({})).toEqual({ opened: false });
    expect(await openPanel({ openPopup: async () => Promise.reject(new Error("no window")) })).toEqual({ opened: false });
  });

  it("exposes no extension page to websites", () => {
    const manifest = JSON.parse(readFileSync(new URL("../../src/manifest.json", import.meta.url).pathname, "utf8")) as Record<string, unknown>;
    // Frameable extension pages run in the page's process on iOS and crash it
    // when they use extension APIs; the entry also makes Safari ask for site
    // access before Scout opens.
    expect(manifest.web_accessible_resources).toBeUndefined();
  });
});
