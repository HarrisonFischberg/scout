import { describe, expect, it } from "vitest";
import {
  appendHistory,
  deleteAllData,
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
    expect(parseSettings(undefined)).toEqual({ provider: "anthropic", model: "claude-sonnet-5-5", retention: "7" });
    expect(parseSettings({ provider: "evil", model: 5, retention: "999" })).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-5-5",
      retention: "7",
    });
    expect(await loadSettings(fakeStorage())).toEqual(parseSettings({}));
  });

  it("uses the provider's default model when the model is blank", () => {
    expect(parseSettings({ provider: "openai", model: "  " }).model).toBe("gpt-5");
  });

  it("round-trips a saved choice", async () => {
    const s = fakeStorage();
    await saveSettings(s, { provider: "openai", model: "gpt-5", retention: "30" });
    expect(await loadSettings(s)).toEqual({ provider: "openai", model: "gpt-5", retention: "30" });
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
    const report = await deleteAllData({
      storage: s,
      deleteKey: async (p) => void deleted.push(p),
      listGrantedOrigins: async () => ["https://shop.test/*"],
      removeOrigins: async (o) => void (removed = o),
    });
    expect(report).toEqual({ keychain: true, storage: true, siteAccess: true });
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
    expect(report).toEqual({ keychain: false, storage: true, siteAccess: true });
    expect(s.data).toEqual({});
  });
});
