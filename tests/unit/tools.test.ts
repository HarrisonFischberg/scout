// Part 2 tool host (spec 7): allow-list, input checks, gate, confirmations,
// and one log entry per call. Fake browser, synthetic data.
import { describe, expect, it } from "vitest";
import type { TabRead, TabRef } from "../../src/context/gather";
import { parsePageAccess, type PageAccess } from "../../src/permissions/gate";
import { runTool, type ToolHostDeps, type ToolRequest } from "../../src/tools/host";
import { ToolLog, type ToolLogEntry } from "../../src/tools/log";
import { offeredTools, TOOL_NAMES } from "../../src/tools/registry";

const TABS: TabRef[] = [
  { id: 1, url: "https://shop.test/a", title: "Test shop", windowId: 1, active: true },
  { id: 2, url: "https://reviews.test/widget", title: "Reviews of Widget", windowId: 1 },
  { id: 3, url: "https://bank.test/", title: "My bank", windowId: 1 },
];

function host(over: Partial<PageAccess> = {}, extra: Partial<ToolHostDeps> = {}) {
  let access = parsePageAccess({ blocked: ["bank.test"], ...over });
  const calls: string[] = [];
  const deps: ToolHostDeps = {
    access: async () => access,
    admin: async () => [],
    saveScreenshotChoice: async (h, c) => {
      access = { ...access, screenshots: { ...access.screenshots, [h]: c } };
    },
    tab: async (id) => TABS.find((t) => t.id === id) ?? null,
    allTabs: async () => TABS,
    readTab: async (id): Promise<TabRead> => {
      calls.push("read " + id);
      const t = TABS.find((x) => x.id === id)!;
      return { shared: { tab_id: id, title: t.title, host: new URL(t.url).hostname, status: "read" }, page: { url: t.url, title: t.title, text: "text of " + id } };
    },
    openTab: async (url) => {
      calls.push("open " + url);
      return { id: 9, url, title: "" };
    },
    closeTabs: async (ids) => void calls.push("close " + ids.join(",")),
    capture: async () => {
      calls.push("capture");
      return { mediaType: "image/jpeg", data: "AAAA" };
    },
    now: (() => {
      let t = 1000;
      return () => (t += 5);
    })(),
    ...extra,
  };
  const entries: ToolLogEntry[] = [];
  const log = { add: async (e: ToolLogEntry) => void entries.push(e) };
  const run = (r: Partial<ToolRequest> & { name: string }) => runTool({ request_id: "r1", input: {}, tabs: [1], current_tab: 1, ...r }, deps, log);
  return { run, calls, entries, access: () => access };
}

describe("allow-list", () => {
  it("rejects an unknown tool with schema-error and logs it", async () => {
    const h = host();
    const r = await h.run({ name: "delete_history" });
    expect(r.status).toBe("schema-error");
    expect(r.text).toContain("Unknown tool");
    expect(h.entries).toEqual([expect.objectContaining({ tool: "unknown:delete_history", status: "schema-error" })]);
    expect(h.calls).toEqual([]);
  });

  it("rejects malformed input with schema-error", async () => {
    const h = host();
    expect((await h.run({ name: "open_tab", input: { url: 5 } })).status).toBe("schema-error");
    expect((await h.run({ name: "close_tabs", input: { tab_ids: [2], extra: true } })).status).toBe("schema-error");
  });

  it("logs every call with tool, site, duration, and status", async () => {
    const h = host();
    await h.run({ name: "read_page", input: {} });
    expect(h.entries[0]).toEqual({ at: expect.any(Number), tool: "read_page", site: "shop.test", ms: 5, status: "ok" });
  });

  it("offers search_tabs and run_task only when turned on, and tab groups only where the browser has them", () => {
    const off = offeredTools({ searchTabs: false, tabGroups: false, scoutMode: false }).map((t) => t.name);
    expect(off).toEqual(["read_page", "screenshot_visible", "open_tab", "close_tabs"]);
    const on = offeredTools({ searchTabs: true, tabGroups: true, scoutMode: true }).map((t) => t.name);
    expect(on).toContain("search_tabs");
    expect(on).toContain("group_tabs");
    expect(on).toContain("run_task");
    expect(TOOL_NAMES).toHaveLength(8);
  });
});

describe("read_page", () => {
  it("reads only tabs shared with the answer", async () => {
    const h = host();
    expect((await h.run({ name: "read_page", input: { tab_id: 2 } })).status).toBe("blocked-by-user");
    expect(h.calls).toEqual([]);
    const ok = await h.run({ name: "read_page", input: { tab_id: 2 }, tabs: [1, 2] });
    expect(ok.status).toBe("ok");
    expect(ok.text).toContain("<untrusted_page_content>");
    expect(ok.shared).toEqual({ title: "Reviews of Widget", host: "reviews.test" });
  });
});

describe("search_tabs", () => {
  it("does nothing until the user turns it on", async () => {
    let listed = false;
    const h = host({}, { allTabs: async () => ((listed = true), TABS) });
    const r = await h.run({ name: "search_tabs", input: { query: "widget" } });
    expect(r.status).toBe("blocked-by-user");
    expect(listed).toBe(false);
  });

  it("searches open tabs, hides blocked sites, and says history is unavailable on Safari", async () => {
    const h = host({ searchTabs: true });
    const r = await h.run({ name: "search_tabs", input: { query: "" } });
    expect(r.status).toBe("ok");
    expect(r.text).toContain("Reviews of Widget");
    expect(r.text).not.toContain("My bank");
    expect(r.text).toContain("History search is not available in this browser.");
  });
});

describe("screenshot_visible", () => {
  it("is never taken on a blocked site", async () => {
    const h = host();
    const r = await h.run({ name: "screenshot_visible", current_tab: 3, tabs: [3], decision: "always" });
    expect(r.status).toBe("blocked-by-user");
    expect(h.calls).not.toContain("capture");
  });

  it("needs the user's answer on a site set to ask, and remembers Always", async () => {
    const h = host();
    expect((await h.run({ name: "screenshot_visible" })).status).toBe("error");
    expect((await h.run({ name: "screenshot_visible", decision: "declined" })).status).toBe("declined");
    expect(h.calls).toEqual([]);
    const r = await h.run({ name: "screenshot_visible", decision: "always" });
    expect(r.status).toBe("ok");
    expect(r.image).toEqual({ mediaType: "image/jpeg", data: "AAAA" });
    expect(h.access().screenshots["shop.test"]).toBe("always");
    expect((await h.run({ name: "screenshot_visible" })).status).toBe("ok");
  });
});

describe("screenshot of a tab that is no longer visible", () => {
  it("takes no screenshot when the user switched away", async () => {
    let captured = false;
    const h = host({}, {
      tab: async (id) => (id === 1 ? { ...TABS[0]!, active: false } : null),
      capture: async () => {
        captured = true;
        return { mediaType: "image/jpeg", data: "AAAA" };
      },
    });
    const r = await h.run({ name: "screenshot_visible", decision: "once" });
    expect(r.status).toBe("error");
    expect(captured).toBe(false);
  });
});

describe("tab tools", () => {
  it("close_tabs closes nothing without confirmation", async () => {
    const h = host();
    expect((await h.run({ name: "close_tabs", input: { tab_ids: [2] } })).status).toBe("error");
    expect((await h.run({ name: "close_tabs", input: { tab_ids: [2] }, decision: "declined" })).status).toBe("declined");
    expect(h.calls).toEqual([]);
    expect((await h.run({ name: "close_tabs", input: { tab_ids: [2] }, decision: "confirmed" })).status).toBe("ok");
    expect(h.calls).toEqual(["close 2"]);
  });

  it("open_tab opens http(s) only and never a blocked site", async () => {
    const h = host();
    expect((await h.run({ name: "open_tab", input: { url: "javascript:alert(1)" } })).status).toBe("schema-error");
    expect((await h.run({ name: "open_tab", input: { url: "https://bank.test/" } })).status).toBe("blocked-by-user");
    const r = await h.run({ name: "open_tab", input: { url: "https://docs.test/" } });
    expect(r).toMatchObject({ status: "ok", opened_tab: 9 });
  });

  it("tab groups are unsupported here, and run_task never runs in the host (the panel starts Scout mode)", async () => {
    const h = host();
    expect((await h.run({ name: "group_tabs", input: { tab_ids: [1, 2] } })).status).toBe("unsupported");
    expect((await h.run({ name: "run_task", input: { goal: "x" } })).status).toBe("error");
  });
});

describe("ToolLog", () => {
  function mem() {
    const data: Record<string, unknown> = {};
    return {
      data,
      get: async (k: string | string[]) => Object.fromEntries([k].flat().filter((x) => x in data).map((x) => [x, data[x]])),
      set: async (items: Record<string, unknown>) => void Object.assign(data, items),
    };
  }

  it("stores entries within retention, newest first", async () => {
    const s = mem();
    const log = new ToolLog(s, async () => "7");
    await log.add({ at: 1, tool: "read_page", site: "a.test", ms: 3, status: "ok" });
    await log.add({ at: 2, tool: "open_tab", site: "b.test", ms: 4, status: "ok" });
    const list = await log.list(3);
    expect(list.map((e) => e.tool)).toEqual(["open_tab", "read_page"]);
  });

  it("keeps nothing in storage when history is off, only this session's calls", async () => {
    const s = mem();
    const log = new ToolLog(s, async () => "off");
    await log.add({ at: 1, tool: "read_page", site: "a.test", ms: 3, status: "ok" });
    expect(s.data.toolLog).toBeUndefined();
    expect(await log.list(2)).toHaveLength(1);
  });
});
