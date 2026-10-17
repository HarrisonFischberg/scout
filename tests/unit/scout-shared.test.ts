// Part 3: what each conversation shared (spec 10), and run_task through the tool host.
import { describe, expect, it } from "vitest";
import { clearSharedForConversation, HISTORY_KEY, sharedByConversation, type HistoryEntry, type StorageArea } from "../../src/settings/settings";
import type { TabRead } from "../../src/context/gather";
import { parsePageAccess } from "../../src/permissions/gate";
import { runTool, type ToolHostDeps } from "../../src/tools/host";
import { offeredTools } from "../../src/tools/registry";

const entries: HistoryEntry[] = [
  { at: 1, conv: "a", question: "q1", answer: "a1", shared: [{ title: "Shop", host: "shop.test", status: "read" }] },
  { at: 2, conv: "a", question: "q2", answer: "a2", shared: [{ title: "Shop", host: "shop.test", status: "read" }, { title: "Screenshot", host: "shop.test", status: "read" }] },
  { at: 3, conv: "b", question: "q3", answer: "a3" },
  { at: 4, conv: "c", question: "q4", answer: "a4", shared: [{ title: "Scout task", host: "forms.test", status: "tool" }] },
];

describe("sharedByConversation", () => {
  it("groups shared items per conversation, newest first, without repeats", () => {
    const groups = sharedByConversation(entries);
    expect(groups.map((g) => g.conv)).toEqual(["c", "a"]);
    expect(groups[1]!.items).toEqual([
      { title: "Shop", host: "shop.test", status: "read" },
      { title: "Screenshot", host: "shop.test", status: "read" },
    ]);
  });
});

describe("clearSharedForConversation", () => {
  it("drops the shared records of one conversation and keeps its messages", async () => {
    const store: Record<string, unknown> = { [HISTORY_KEY]: entries };
    const storage: StorageArea = {
      get: async (k) => Object.fromEntries([k].flat().map((x) => [x, store[x]])),
      set: async (i) => void Object.assign(store, i),
      clear: async () => undefined,
    };
    await clearSharedForConversation(storage, "a");
    const after = store[HISTORY_KEY] as HistoryEntry[];
    expect(after).toHaveLength(4);
    expect(after.filter((e) => e.conv === "a").every((e) => e.shared === undefined)).toBe(true);
    expect(after[3]!.shared).toHaveLength(1);
    expect(sharedByConversation(after).map((g) => g.conv)).toEqual(["c"]);
  });
});

describe("run_task tool", () => {
  function host(over: Partial<ToolHostDeps> = {}) {
    const started: string[] = [];
    const deps: ToolHostDeps = {
      access: async () => parsePageAccess({ blocked: ["bank.test"] }),
      admin: async () => [],
      saveScreenshotChoice: async () => undefined,
      tab: async (id) => (id === 1 ? { id: 1, url: "https://shop.test/a", title: "Shop" } : id === 2 ? { id: 2, url: "https://bank.test/", title: "Bank" } : id === 3 ? { id: 3, url: "https://shop.test/", title: "Private", incognito: true } : null),
      allTabs: async () => [],
      readTab: async (): Promise<TabRead> => ({ shared: { tab_id: 1, title: "", host: "", status: "read" } }),
      openTab: async (url) => ({ id: 9, url, title: "" }),
      closeTabs: async () => undefined,
      capture: async () => ({ mediaType: "image/jpeg", data: "A" }),
      startTask: async (goal) => {
        started.push(goal);
        return { task_id: "t9" };
      },
      now: () => 0,
      ...over,
    };
    return { started, run: (current_tab: number, decision?: "confirmed" | "declined") => runTool({ request_id: "r", name: "run_task", input: { goal: "Fill it" }, tabs: [current_tab], current_tab, ...(decision ? { decision } : {}), conv: "c1" }, deps) };
  }

  it("starts only after the user's per-task answer and reports the task", async () => {
    const h = host();
    expect((await h.run(1)).status).toBe("error");
    expect((await h.run(1, "declined")).status).toBe("declined");
    expect(h.started).toEqual([]);
    const ok = await h.run(1, "confirmed");
    expect(ok.status).toBe("ok");
    expect(ok.task_id).toBe("t9");
    expect(ok.shared).toEqual({ title: "Scout task", host: "shop.test" });
    expect(h.started).toEqual(["Fill it"]);
  });

  it("never starts on a blocked site or in Private Browsing, whatever the answer", async () => {
    const h = host();
    expect((await h.run(2, "confirmed")).status).toBe("blocked-by-user");
    expect((await h.run(3, "confirmed")).text).toContain("Private Browsing");
    expect(h.started).toEqual([]);
  });

  it("is offered to the model only where Scout mode may run", () => {
    expect(offeredTools({ searchTabs: false, tabGroups: false, scoutMode: true }).map((t) => t.name)).toContain("run_task");
    expect(offeredTools({ searchTabs: false, tabGroups: false, scoutMode: false }).map((t) => t.name)).not.toContain("run_task");
  });
});
