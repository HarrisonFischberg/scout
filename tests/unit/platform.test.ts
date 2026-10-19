import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyBrowserText, browserName, keyPlace, siteAccessSettings } from "../../src/platform";

describe("per-browser wording", () => {
  it("names the browser and where the key is kept", () => {
    expect(browserName("safari")).toBe("Safari");
    expect(browserName("chrome")).toBe("Chrome");
    expect(browserName("firefox")).toBe("Firefox");
    expect(keyPlace("safari")).toBe("your Keychain");
    expect(keyPlace("chrome")).toBe("this browser");
    expect(keyPlace("firefox")).toBe("this browser");
  });

  it("defaults to Safari when no build target is defined (tests, older bundles)", () => {
    expect(browserName()).toBe("Safari");
    expect(keyPlace()).toBe("your Keychain");
  });

  it("points to each browser's own site access settings", () => {
    expect(siteAccessSettings("safari")).toContain("Safari > Settings > Extensions");
    expect(siteAccessSettings("chrome")).toContain("Site access");
    expect(siteAccessSettings("firefox")).toContain("Add-ons and themes");
  });

  function fakeRoot(items: { text: string; other: string }[]) {
    const els = items.map((i) => ({ textContent: i.text, dataset: { otherBrowsers: i.other } }));
    return { els, root: { querySelectorAll: () => els } as unknown as ParentNode };
  }

  it("swaps static panel text on Chrome and Firefox only", () => {
    const safari = fakeRoot([{ text: "kept in your Keychain", other: "kept in {browser}" }]);
    applyBrowserText(safari.root, "safari");
    expect(safari.els[0].textContent).toBe("kept in your Keychain");
    const chrome = fakeRoot([{ text: "kept in your Keychain", other: "kept in {browser}, in {browser}'s storage" }]);
    applyBrowserText(chrome.root, "chrome");
    expect(chrome.els[0].textContent).toBe("kept in Chrome, in Chrome's storage");
  });

  it("every Keychain mention in the panel has Chrome/Firefox wording", () => {
    const html = readFileSync(new URL("../../src/popup.html", import.meta.url).pathname, "utf8");
    const visible = html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!--[\s\S]*?-->/g, "");
    for (const m of visible.matchAll(/<(\w+)[^>]*>[^<]*Keychain[^<]*</g)) {
      expect(m[0], "Keychain text without data-other-browsers").toContain("data-other-browsers=");
    }
  });
});
