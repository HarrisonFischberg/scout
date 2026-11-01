// Owner, 2026-11-01: text typed into the question box survives the panel
// closing and comes back on the same tab; sending clears it.
import { describe, expect, it, vi } from "vitest";
import { DRAFT_MAX_AGE_MS, DraftSaver, draftKey, dropAllDrafts, loadDraft, parseDraft, saveDraft } from "../../src/panel/draft";
import { clearTabStates, forgetTab } from "../../src/panel/state";

function mem(init: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...init };
  return {
    data,
    get: async (k: string | string[] | null) => (k === null ? { ...data } : Object.fromEntries(([] as string[]).concat(k).filter((x) => x in data).map((x) => [x, data[x]]))),
    set: async (v: Record<string, unknown>) => void Object.assign(data, v),
    clear: async () => undefined,
    remove: async (keys: string[]) => keys.forEach((k) => delete data[k]),
  };
}

describe("drafts", () => {
  it("keeps each tab's text apart and brings it back", async () => {
    const s = mem();
    await saveDraft(s, "1", "best wall dimmer for", 10);
    await saveDraft(s, "2", "other tab", 10);
    expect(await loadDraft(s, "1", 20)).toBe("best wall dimmer for");
    expect(await loadDraft(s, "2", 20)).toBe("other tab");
    expect(await loadDraft(s, "3", 20)).toBe("");
  });

  it("saves with one write and no read, so it lands as the panel closes", async () => {
    const s = mem();
    let reads = 0;
    const get = s.get;
    s.get = async (k) => (reads++, get(k));
    void saveDraft(s, "1", "hello", 10);
    expect(s.data[draftKey("1")]).toEqual({ text: "hello", at: 10 });
    expect(reads).toBe(0);
  });

  it("an empty box (sent or erased) removes the draft", async () => {
    const s = mem();
    await saveDraft(s, "1", "hello", 10);
    await saveDraft(s, "1", "  ", 11);
    expect(await loadDraft(s, "1", 20)).toBe("");
    expect(draftKey("1") in s.data).toBe(false);
  });

  it("ignores old and malformed drafts", () => {
    expect(parseDraft({ text: "x", at: 0 }, DRAFT_MAX_AGE_MS + 1)).toBe("");
    expect(parseDraft({ text: 3, at: 1 }, 2)).toBe("");
    expect(parseDraft(null, 2)).toBe("");
    expect(parseDraft({ text: "y", at: 5 }, 6)).toBe("y");
  });

  it("goes when the tab closes, and all go when Safari restarts", async () => {
    const now = Date.now();
    const s = mem({ [draftKey("1")]: { text: "a", at: now }, [draftKey("2")]: { text: "b", at: now }, other: 1 });
    await forgetTab(s, 1);
    expect(await loadDraft(s, "1", now)).toBe("");
    expect(await loadDraft(s, "2", now)).toBe("b");
    await clearTabStates(s);
    expect(await loadDraft(s, "2", now)).toBe("");
    expect(s.data.other).toBe(1);
    await dropAllDrafts(s);
  });

  it("saver waits for typing to stop, and flushes at once on close", async () => {
    vi.useFakeTimers();
    const saved: string[] = [];
    const d = new DraftSaver(async (t) => void saved.push(t), "", 300);
    d.changed("h");
    d.changed("he");
    expect(saved).toEqual([]);
    vi.advanceTimersByTime(300);
    expect(saved).toEqual(["he"]);
    d.changed("hel");
    await d.flush("hell");
    vi.advanceTimersByTime(1000);
    expect(saved).toEqual(["he", "hell"]);
    await d.flush("hell");
    expect(saved).toHaveLength(2);
    vi.useRealTimers();
  });
});
