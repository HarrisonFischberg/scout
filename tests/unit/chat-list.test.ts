import { describe, expect, it } from "vitest";
import { summarizeChats, whenText } from "../../src/chat/list";
import { deleteConversation, loadHistory, siteOf, type HistoryEntry, type StorageArea } from "../../src/settings/settings";

const titles = { summarize: (q: string) => q === "SUMMARIZE", coupons: "Find coupons", agent: "Scout mode" };

function fakeStorage(initial: Record<string, unknown> = {}): StorageArea & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = { ...initial };
  return {
    data,
    get: async (k) => Object.fromEntries((Array.isArray(k) ? k : [k]).filter((x) => x in data).map((x) => [x, data[x]])),
    set: async (o) => void Object.assign(data, o),
    clear: async () => void Object.keys(data).forEach((k) => delete data[k]),
  };
}

describe("chats menu (owner request 2026-10-19)", () => {
  it("one row per chat, newest first, titled by its first question with the site", () => {
    const e: HistoryEntry[] = [
      { at: 100, conv: "a", question: "First in a", answer: "x", kind: "chat", site: "shop.test" },
      { at: 200, conv: "b", question: "SUMMARIZE", answer: "x", kind: "chat" },
      { at: 300, conv: "a", question: "Second in a", answer: "x", kind: "chat" },
      { at: 400, conv: "c", question: "Find the best coupon for this cart.", answer: "x", kind: "coupons", site: "beef.test" },
      { at: 500, conv: "d", question: "Buy socks", answer: "x", kind: "agent" },
      // Saved before per-tab chats: never shown in the panel, so not listed.
      { at: 600, question: "old", answer: "x" },
    ];
    expect(summarizeChats(e, titles)).toEqual([
      { conv: "d", title: "Scout mode: Buy socks", at: 500, count: 1 },
      { conv: "c", title: "Find coupons", at: 400, count: 1, site: "beef.test" },
      { conv: "a", title: "First in a", at: 300, count: 2, site: "shop.test" },
      { conv: "b", title: "Summarize page", at: 200, count: 1 },
    ]);
  });

  it("shortens long titles and folds whitespace", () => {
    const [c] = summarizeChats([{ at: 1, conv: "a", question: "a\n\n  b " + "x".repeat(200), answer: "" }], titles);
    expect(c!.title.startsWith("a b x")).toBe(true);
    expect(c!.title.length).toBeLessThanOrEqual(80);
    expect(c!.title.endsWith("…")).toBe(true);
  });

  it("says when in words", () => {
    const now = new Date(2026, 9, 19, 15, 0).getTime();
    expect(whenText(now - 20_000, now)).toBe("Just now");
    expect(whenText(now - 5 * 60_000, now)).toBe("5 min ago");
    expect(whenText(now - 3 * 3600_000, now)).toBe("3 h ago");
    expect(whenText(new Date(2026, 9, 18, 9, 0).getTime(), now)).toBe("Yesterday");
    expect(whenText(new Date(2026, 9, 12, 9, 0).getTime(), now, "en-US")).toBe("Oct 12");
  });

  it("deletes one chat and keeps the others", async () => {
    const s = fakeStorage({
      history: [
        { at: Date.now() - 2, conv: "a", question: "q1", answer: "x" },
        { at: Date.now() - 1, conv: "b", question: "q2", answer: "x" },
        { at: Date.now(), conv: "a", question: "q3", answer: "x" },
      ],
    });
    await deleteConversation(s, "a");
    expect((await loadHistory(s, "7", Date.now())).map((e) => e.question)).toEqual(["q2"]);
  });

  it("keeps only the host of a page as the chat's site", async () => {
    expect(siteOf("https://www.shop.test/cart?token=abc#x")).toBe("shop.test");
    expect(siteOf("http://127.0.0.1:4317/a")).toBe("127.0.0.1");
    expect(siteOf("safari-web-extension://abc/popup.html")).toBeUndefined();
    expect(siteOf("not a url")).toBeUndefined();
    expect(siteOf(undefined)).toBeUndefined();
    // Stored data is untrusted: anything but a host is dropped.
    const s = fakeStorage({ history: [{ at: Date.now(), conv: "a", question: "q", answer: "x", site: "<img src=x>" }, { at: Date.now(), conv: "b", question: "q", answer: "x", site: "ok.test" }] });
    expect((await loadHistory(s, "7", Date.now())).map((e) => e.site)).toEqual([undefined, "ok.test"]);
  });
});
