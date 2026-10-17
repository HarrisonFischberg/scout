import { describe, expect, it } from "vitest";
import {
  clearHistory,
  loadConversation,
  appendHistory,
  deleteAllData,
  deleteReportText,
  loadHistory,
  loadSettings,
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
    expect(text).toContain("Safari still lets Scout for Safari read: 127.0.0.1.");
    expect(text).toContain("Settings > Apps > Safari > Extensions > Scout for Safari");
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
});
