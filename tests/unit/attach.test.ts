// Part 2 panel helpers: @ tab suggestions, the Shared line, Activity rows.
import { describe, expect, it } from "vitest";
import { activityLine, dropMention, mentionAt, sharedLabel, suggestTabs } from "../../src/panel/attach";

const TABS = [
  { id: 1, title: "Test shop", url: "https://shop.test/a", active: true },
  { id: 2, title: "Reviews of Widget", url: "https://reviews.test/widget", active: false },
  { id: 3, title: "Docs home", url: "https://docs.test/", active: false },
];

describe("@ tab picker", () => {
  it("finds the @word before the caret only at a word start", () => {
    expect(mentionAt("Compare with @rev", 17)).toEqual({ start: 13, query: "rev" });
    expect(mentionAt("@", 1)).toEqual({ start: 0, query: "" });
    expect(mentionAt("mail me at me@reviews.test", 26)).toBeNull();
    expect(mentionAt("Compare with @rev and", 21)).toBeNull();
  });

  it("suggests other tabs by host or title word, never the current or already attached ones", () => {
    expect(suggestTabs("rev", TABS, new Set()).map((t) => t.id)).toEqual([2]);
    expect(suggestTabs("docs.test", TABS, new Set()).map((t) => t.id)).toEqual([3]);
    expect(suggestTabs("", TABS, new Set([3])).map((t) => t.id)).toEqual([2]);
    expect(suggestTabs("shop", TABS, new Set())).toEqual([]);
  });

  it("suggests nothing once the attach limit is reached", () => {
    expect(suggestTabs("", TABS, new Set([10, 11, 12, 13]))).toEqual([]);
  });

  it("removes the @word once the tab is attached", () => {
    expect(dropMention("Compare with @rev", 13, 17)).toEqual({ text: "Compare with ", caret: 13 });
    expect(dropMention("@rev compare", 0, 4)).toEqual({ text: "compare", caret: 0 });
  });
});

describe("shared line", () => {
  it("names each tab with its site and says when it was not fully read", () => {
    expect(sharedLabel({ title: "Test shop", host: "shop.test", status: "read" })).toBe("Test shop (shop.test)");
    expect(sharedLabel({ title: "Bank", host: "bank.test", status: "blocked" })).toBe("Bank (bank.test), blocked");
    expect(sharedLabel({ title: "Slow", host: "slow.test", status: "timeout" })).toBe("Slow (slow.test), timed out");
    expect(sharedLabel({ title: "Long", host: "long.test", status: "partial" })).toBe("Long (long.test), partly read");
  });
});

describe("activity rows", () => {
  it("show tool, site, status and duration, never input", () => {
    const line = activityLine({ at: Date.UTC(2026, 9, 16, 12), tool: "read_page", site: "shop.test", ms: 120, status: "ok" }, "en-US");
    expect(line).toContain("Read page · shop.test · ok · 120 ms");
    expect(activityLine({ at: 0, tool: "unknown:delete_all", site: "", ms: 1, status: "schema-error" }, "en-US")).toContain("Unknown tool (delete_all) · no site · schema-error");
  });
});
