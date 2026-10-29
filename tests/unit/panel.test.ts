import { describe, expect, it } from "vitest";
import {
  PRIVATE_CONVS_KEY,
  TAB_STATE_KEY,
  clearTabStates,
  conversationForTab,
  forgetTab,
  loadTabStates,
  reopenConversation,
  setPanelOpen,
  startNewConversation,
} from "../../src/panel/state";
import { toolbarIcon } from "../../src/panel/toolbar";
import { appendHistory, loadConversation } from "../../src/settings/settings";

function fakeStorage(initial: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = JSON.parse(JSON.stringify(initial));
  return {
    data,
    async get(keys: string | string[]) {
      const list = Array.isArray(keys) ? keys : [keys];
      return JSON.parse(JSON.stringify(Object.fromEntries(list.filter((k) => k in data).map((k) => [k, data[k]]))));
    },
    async set(items: Record<string, unknown>) {
      Object.assign(data, JSON.parse(JSON.stringify(items)));
    },
    async clear() {
      for (const k of Object.keys(data)) delete data[k];
    },
  };
}

describe("per-tab conversations", () => {
  it("gives each tab its own conversation and brings it back for that tab", async () => {
    const s = fakeStorage();
    const a = await conversationForTab(s, 1, 1000);
    const b = await conversationForTab(s, 2, 1000);
    expect(a).not.toBe(b);
    await appendHistory(s, "7", { at: 1001, question: "vitamin D?", answer: "…", conv: a });
    await appendHistory(s, "7", { at: 1002, question: "this stock?", answer: "…", conv: b });
    expect(await conversationForTab(s, 1, 2000)).toBe(a);
    expect((await loadConversation(s, "7", 3000, a)).map((e) => e.question)).toEqual(["vitamin D?"]);
    expect((await loadConversation(s, "7", 3000, b)).map((e) => e.question)).toEqual(["this stock?"]);
  });

  it("New chat replaces only that tab's conversation", async () => {
    const s = fakeStorage();
    const a = await conversationForTab(s, 1, 1000);
    const b = await conversationForTab(s, 2, 1000);
    const a2 = await startNewConversation(s, 1, 2000);
    expect(a2).not.toBe(a);
    expect(await conversationForTab(s, 1, 3000)).toBe(a2);
    expect(await conversationForTab(s, 2, 3000)).toBe(b);
  });

  it("goes back to an earlier conversation on that tab (the Find coupons chip after New chat)", async () => {
    const s = fakeStorage();
    const a = await conversationForTab(s, 1, 1000);
    await setPanelOpen(s, 1, true, 1500);
    await startNewConversation(s, 1, 2000);
    expect(await reopenConversation(s, 1, a, 3000)).toBe(a);
    expect(await conversationForTab(s, 1, 4000)).toBe(a);
    expect((await loadTabStates(s))["1"]).toMatchObject({ conv: a, open: true });
  });

  it("moves the conversation saved before per-tab chats to the first tab, once", async () => {
    const s = fakeStorage({
      chatStartedAt: 500,
      history: [
        { at: 100, question: "before New chat", answer: "x" },
        { at: 600, question: "current", answer: "y" },
      ],
    });
    const first = await conversationForTab(s, 9, 1000);
    expect((await loadConversation(s, "7", 1000, first)).map((e) => e.question)).toEqual(["current"]);
    const second = await conversationForTab(s, 10, 1000);
    expect(await loadConversation(s, "7", 1000, second)).toEqual([]);
  });

  it("records open state, forgets closed tabs, and clears at startup", async () => {
    const s = fakeStorage();
    const conv = await conversationForTab(s, 3, 1000);
    await setPanelOpen(s, 3, true, 1100);
    expect((await loadTabStates(s))["3"]).toEqual({ conv, open: true, at: 1100 });
    await setPanelOpen(s, 3, false, 1200);
    expect((await loadTabStates(s))["3"]?.open).toBe(false);
    await forgetTab(s, 3);
    expect(await loadTabStates(s)).toEqual({});
    await setPanelOpen(s, 4, true, 1300);
    await clearTabStates(s);
    expect(await loadTabStates(s)).toEqual({});
  });

  it("deletes a private tab's chats from history when the tab closes, and every private chat at startup", async () => {
    const s = fakeStorage();
    const regular = await conversationForTab(s, 1, 1000);
    const priv = await conversationForTab(s, 2, 1000, true);
    const priv2 = await startNewConversation(s, 2, 1100, true);
    const other = await conversationForTab(s, 3, 1000, true);
    for (const [conv, q] of [[regular, "regular"], [priv, "private 1"], [priv2, "private 2"], [other, "other private"]] as const) {
      await appendHistory(s, "7", { at: 1200, question: q, answer: "a", conv });
    }
    await forgetTab(s, 2);
    expect(await loadConversation(s, "7", 1300, priv)).toEqual([]);
    expect(await loadConversation(s, "7", 1300, priv2)).toEqual([]);
    expect((await loadConversation(s, "7", 1300, regular)).map((e) => e.question)).toEqual(["regular"]);
    expect((await loadConversation(s, "7", 1300, other)).map((e) => e.question)).toEqual(["other private"]);
    await forgetTab(s, 1);
    expect((await loadConversation(s, "7", 1300, regular)).map((e) => e.question)).toEqual(["regular"]);
    await clearTabStates(s);
    expect(await loadConversation(s, "7", 1300, other)).toEqual([]);
    expect((await loadConversation(s, "7", 1300, regular)).map((e) => e.question)).toEqual(["regular"]);
    expect((await s.get(PRIVATE_CONVS_KEY))[PRIVATE_CONVS_KEY]).toEqual({});
  });

  it("a private tab never adopts chats saved before per-tab chats", async () => {
    const s = fakeStorage({ history: [{ at: 900, question: "legacy", answer: "a" }] });
    const conv = await conversationForTab(s, 4, 1000, true);
    expect(await loadConversation(s, "7", 1000, conv)).toEqual([]);
  });

  it("drops malformed stored rows", async () => {
    const s = fakeStorage({ [TAB_STATE_KEY]: { "1": { conv: 5 }, "2": { conv: "c", at: 1, open: "yes" }, "3": null } });
    expect(await loadTabStates(s)).toEqual({ "2": { conv: "c", at: 1, open: false } });
  });
});

describe("panel and worker changing tab state at once (audit 2026-10-27)", () => {
  it("opening the panel on a new tab ends with one chat, marked open", async () => {
    const s = fakeStorage();
    // The panel picks the tab's chat while the worker records the panel as open (port hello).
    const [conv] = await Promise.all([conversationForTab(s, 5, 1000), setPanelOpen(s, 5, true, 1000)]);
    expect((await loadTabStates(s))["5"]).toMatchObject({ conv, open: true });
  });

  it("a private tab opened while another private tab closes stays on the private list", async () => {
    const s = fakeStorage();
    const a = await conversationForTab(s, 1, 1000, true);
    // Slow reads, as in Safari, so the two changes overlap.
    const get = s.get.bind(s);
    s.get = async (keys) => {
      const got = await get(keys);
      await new Promise((r) => setTimeout(r, 5));
      return got;
    };
    const [, b] = await Promise.all([forgetTab(s, 1), conversationForTab(s, 2, 1001, true)]);
    expect(s.data[PRIVATE_CONVS_KEY]).toEqual({ "2": [b] });
    expect(a).not.toBe(b);
  });
});

describe("toolbar icon", () => {
  it("picks the light or dark monochrome set, and the active set", () => {
    expect(toolbarIcon(false)["16"]).toBe("icons/toolbar-16.png");
    expect(toolbarIcon(true)["32"]).toBe("icons/toolbar-dark-32.png");
    expect(toolbarIcon(true, true)["128"]).toBe("icons/toolbar-active-dark-128.png");
  });
});
