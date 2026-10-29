import { describe, expect, it } from "vitest";
import { withLock } from "../../src/settings/lock";
import {
  clearHistory,
  loadRatings,
  ratingKey,
  saveRating,
  loadConversation,
  appendHistory,
  deleteAllData,
  deleteReportText,
  loadHistory,
  loadSettings,
  MODEL_MIGRATION_KEY,
  parseSettings,
  pruneHistory,
  saveSettings,
  type HistoryEntry,
  type StorageArea,
} from "../../src/settings/settings";

function fakeStorage(initial: Record<string, unknown> = {}): StorageArea & { data: Record<string, unknown> } {
  const data = { ...initial };
  return {
    data,
    async get(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((k) => k in data).map((k) => [k, data[k]]));
    },
    async set(items) {
      Object.assign(data, items);
    },
    async clear() {
      for (const k of Object.keys(data)) delete data[k];
    },
  };
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 15);
const entry = (daysAgo: number, q = "q"): HistoryEntry => ({ at: NOW - daysAgo * DAY, question: q, answer: "a" });

describe("settings", () => {
  it("defaults when storage is empty or malformed", async () => {
    expect(parseSettings(undefined)).toEqual({ provider: "anthropic", model: "claude-haiku-5-5", effort: "high", retention: "7" });
    expect(parseSettings({ provider: "evil", model: 5, effort: "turbo", retention: "999" })).toEqual({
      provider: "anthropic",
      model: "claude-haiku-5-5",
      effort: "high",
      retention: "7",
    });
    expect(await loadSettings(fakeStorage())).toEqual(parseSettings({}));
  });

  it("uses the provider's default model when the model is blank", () => {
    expect(parseSettings({ provider: "openai", model: "  " }).model).toBe("gpt-5");
    expect(parseSettings({ provider: "openai" }).effort).toBe("default");
  });

  it("keeps a model saved before efforts existed at its own default effort", () => {
    expect(parseSettings({ provider: "anthropic", model: "claude-sonnet-5-5" })).toMatchObject({ model: "claude-sonnet-5-5", effort: "default" });
  });

  it("round-trips a saved choice", async () => {
    const s = fakeStorage();
    await saveSettings(s, { provider: "openai", model: "gpt-5", effort: "high", retention: "30" });
    expect(await loadSettings(s)).toEqual({ provider: "openai", model: "gpt-5", effort: "high", retention: "30" });
  });
});

describe("one-time switch to Haiku 5.5 High", () => {
  it("moves an existing Anthropic choice to Haiku 5.5 High once, keeping retention", async () => {
    const s = fakeStorage({ settings: { provider: "anthropic", model: "claude-sonnet-5-5", effort: "low", retention: "30" } });
    const want = { provider: "anthropic", model: "claude-haiku-5-5", effort: "high", retention: "30" };
    expect(await loadSettings(s)).toEqual(want);
    expect(s.data.settings).toEqual(want);
  });

  it("keeps a model chosen after the switch", async () => {
    const s = fakeStorage({ settings: { provider: "anthropic", model: "claude-opus-5-5", effort: "low", retention: "7" } });
    await loadSettings(s);
    await saveSettings(s, { provider: "anthropic", model: "claude-sonnet-5-5", effort: "medium", retention: "7" });
    expect(await loadSettings(s)).toMatchObject({ model: "claude-sonnet-5-5", effort: "medium" });
  });

  it("leaves OpenAI users on their own model", async () => {
    const s = fakeStorage({ settings: { provider: "openai", model: "gpt-5", effort: "high", retention: "7" } });
    expect(await loadSettings(s)).toMatchObject({ provider: "openai", model: "gpt-5" });
    expect(s.data[MODEL_MIGRATION_KEY]).toBeDefined();
  });

  it("marks a fresh install as done, so its first saved choice sticks", async () => {
    const s = fakeStorage();
    await loadSettings(s);
    await saveSettings(s, { provider: "anthropic", model: "claude-opus-5-5", effort: "low", retention: "7" });
    expect(await loadSettings(s)).toMatchObject({ model: "claude-opus-5-5", effort: "low" });
  });
});

describe("retention expiry", () => {
  const all = [entry(40, "old"), entry(10, "mid"), entry(1, "new")];

  it("7 days keeps only entries newer than 7 days", () => {
    expect(pruneHistory(all, "7", NOW).map((e) => e.question)).toEqual(["new"]);
  });

  it("30 days keeps entries newer than 30 days", () => {
    expect(pruneHistory(all, "30", NOW).map((e) => e.question)).toEqual(["mid", "new"]);
  });

  it("off keeps nothing and appends nothing", async () => {
    expect(pruneHistory(all, "off", NOW)).toEqual([]);
    const s = fakeStorage();
    await appendHistory(s, "off", entry(0));
    expect(s.data.history).toBeUndefined();
  });

  // Audit 2026-10-24: the worker and the panel save at the same time (a coupon
  // run ends while a chat answer is saved); each read the old list, and the
  // second write erased the first entry.
  it("saves made at the same moment all land, and a branch saves several entries in one write", async () => {
    const s = fakeStorage();
    const slow: StorageArea = {
      ...s,
      get: async (k) => {
        await new Promise((r) => setTimeout(r, 5));
        return s.get(k);
      },
    };
    await Promise.all([appendHistory(slow, "7", entry(0, "chat")), appendHistory(slow, "7", entry(0, "coupons")), appendHistory(slow, "7", [entry(0, "b1"), entry(0, "b2")])]);
    expect((s.data.history as HistoryEntry[]).map((e) => e.question).sort()).toEqual(["b1", "b2", "chat", "coupons"]);
  });

  // Owner, 2026-10-28: "Ask Claude" under Apple's answer replaces it in the saved chat too.
  it("a replacing save drops the answer it replaces, and only that one", async () => {
    const apple = { ...entry(0, "dimmer"), conv: "c", answer: "Apple's vague answer" };
    const other = { ...entry(0, "dimmer"), conv: "d", answer: "Apple's vague answer" };
    const s = fakeStorage({ history: [apple, other] });
    await appendHistory(s, "7", { ...apple, answer: "Lutron Diva, Leviton SureSlide" }, { conv: "c", question: "dimmer", answer: "Apple's vague answer" });
    expect((s.data.history as HistoryEntry[]).map((e) => e.conv + ":" + e.answer)).toEqual(["d:Apple's vague answer", "c:Lutron Diva, Leviton SureSlide"]);
  });

  // Review 2026-10-24: a save that had read the old list wrote it all back after Clear history.
  it("Clear history waits for a save already under way, so deleted entries do not come back", async () => {
    const s = fakeStorage({ history: [entry(0, "old")] });
    const slow: StorageArea = {
      ...s,
      remove: async (keys) => {
        for (const k of keys) delete s.data[k];
      },
      get: async (k) => {
        const got = await s.get(k);
        await new Promise((r) => setTimeout(r, 10));
        return got;
      },
    };
    await Promise.all([appendHistory(slow, "7", entry(0, "new")), clearHistory(slow)]);
    expect(s.data.history).toBeUndefined();
  });

  it("a save that never finishes lets go of the lock, so later saves still run", async () => {
    const order: string[] = [];
    const stuck = withLock("t", () => new Promise<void>(() => undefined), 20).catch(() => order.push("gave up"));
    await withLock("t", async () => void order.push("next"), 20);
    await stuck;
    expect(order).toEqual(["gave up", "next"]);
  });

  it("an entry exactly at the cutoff is expired", () => {
    expect(pruneHistory([entry(7)], "7", NOW)).toEqual([]);
  });

  it("loadHistory drops expired entries from storage too", async () => {
    const s = fakeStorage({ history: all });
    expect((await loadHistory(s, "7", NOW)).map((e) => e.question)).toEqual(["new"]);
    expect((s.data.history as HistoryEntry[]).length).toBe(1);
  });

  it("ignores malformed stored entries", async () => {
    const s = fakeStorage({ history: [{ at: "x" }, null, entry(0, "ok")] });
    expect((await loadHistory(s, "7", NOW)).map((e) => e.question)).toEqual(["ok"]);
  });
});

describe("deleteAllData", () => {
  it("clears Keychain items, storage, and granted origins", async () => {
    const s = fakeStorage({ settings: { provider: "openai" }, history: [entry(0)] });
    const deleted: string[] = [];
    let removed: string[] = [];
    let granted = ["https://shop.test/*"];
    const report = await deleteAllData({
      storage: s,
      deleteKey: async (p) => void deleted.push(p),
      listGrantedOrigins: async () => granted,
      removeOrigins: async (o) => {
        removed = o;
        granted = granted.filter((g) => !o.includes(g));
      },
    });
    expect(report).toEqual({ keychain: true, storage: true, siteAccess: true, remainingOrigins: [] });
    expect(deleted).toEqual(["anthropic", "openai"]);
    expect(s.data).toEqual({});
    expect(removed).toEqual(["https://shop.test/*"]);
  });

  it("keeps going and reports a failed Keychain step", async () => {
    const s = fakeStorage({ settings: {} });
    const report = await deleteAllData({
      storage: s,
      deleteKey: async () => {
        throw new Error("keychain: denied");
      },
      listGrantedOrigins: async () => [],
      removeOrigins: async () => {},
    });
    expect(report).toEqual({ keychain: false, storage: true, siteAccess: true, remainingOrigins: [] });
    expect(s.data).toEqual({});
  });

  // Seen on iOS Safari 27 (T018): access granted via Safari's own prompt
  // survives permissions.remove. The report must say so, not claim success.
  it("reports sites Safari still allows after removal", async () => {
    const report = await deleteAllData({
      storage: fakeStorage({}),
      deleteKey: async () => {},
      listGrantedOrigins: async () => ["*://*.127.0.0.1/*"],
      removeOrigins: async () => {},
    });
    expect(report.siteAccess).toBe(false);
    expect(report.remainingOrigins).toEqual(["*://*.127.0.0.1/*"]);
    const text = deleteReportText(report);
    expect(text).toContain("Safari still lets Scout read: 127.0.0.1.");
    expect(text).toContain("Settings > Apps > Safari > Extensions > Scout;");
  });

  it("says plainly when everything was deleted", () => {
    expect(deleteReportText({ keychain: true, storage: true, siteAccess: true, remainingOrigins: [] })).toBe(
      "Deleted your API keys, settings, and history from this device.",
    );
  });
});

describe("conversation", () => {
  it("shows only the entries of one conversation, keeps kinds, and clears", async () => {
    const s = fakeStorage({});
    await appendHistory(s, "7", { at: 1000, question: "other tab", answer: "a", kind: "chat", conv: "c-a" });
    await appendHistory(s, "7", { at: 3000, question: "Fill the form", answer: "Done", kind: "agent", conv: "c-b" });
    const conv = await loadConversation(s, "7", 4000, "c-b");
    expect(conv).toEqual([{ at: 3000, question: "Fill the form", answer: "Done", kind: "agent", conv: "c-b" }]);
    await clearHistory(s);
    expect(await loadConversation(s, "7", 4000, "c-b")).toEqual([]);
  });

  it("clears by removing the keys when storage can remove (Safari), so no empty values are written", async () => {
    const s = fakeStorage({ history: [{ at: 1, question: "q", answer: "a", conv: "c" }], ratings: { k: "up" }, settings: { provider: "anthropic" } });
    const removed: string[][] = [];
    const written: Array<Record<string, unknown>> = [];
    const set = s.set.bind(s);
    s.set = async (items) => {
      written.push(items);
      await set(items);
    };
    s.remove = async (keys) => {
      removed.push(keys);
      for (const k of keys) delete s.data[k];
    };
    await clearHistory(s);
    expect(removed).toEqual([["history", "ratings"]]);
    expect(written).toEqual([]);
    expect(s.data).toEqual({ settings: { provider: "anthropic" } });
    expect(await loadConversation(s, "7", 2, "c")).toEqual([]);
  });

  it("keeps an answer's numbered sources and drops malformed ones", async () => {
    const s = fakeStorage({
      history: [
        {
          at: 1000,
          question: "q",
          answer: "a [1]",
          conv: "c",
          sources: [{ url: "https://shop.test/a", title: "Shop", kind: "page" }, { url: "javascript:alert(1)" }, { url: "https://w.test/", kind: "evil" }],
        },
      ],
    });
    const [e] = await loadConversation(s, "7", 2000, "c");
    expect(e?.sources).toEqual([{ url: "https://shop.test/a", title: "Shop", kind: "page" }, { url: "https://w.test/" }]);
  });
});

describe("answer ratings (owner item 10)", () => {
  it("sets, toggles off, ignores junk, and is cleared with history", async () => {
    const s = fakeStorage({ ratings: { old: "meh" } });
    const k = ratingKey("q", "a");
    expect(k).toBe(ratingKey("q", "a"));
    expect(k).not.toBe(ratingKey("q", "b"));
    await saveRating(s, k, "up");
    expect(await loadRatings(s)).toEqual({ [k]: "up" });
    await saveRating(s, k, "down");
    expect(await loadRatings(s)).toEqual({ [k]: "down" });
    await saveRating(s, k, null);
    expect(await loadRatings(s)).toEqual({});
    await saveRating(s, k, "up");
    await clearHistory(s);
    expect(await loadRatings(s)).toEqual({});
  });
});
