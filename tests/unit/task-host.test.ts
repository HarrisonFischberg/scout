// Scout mode host in the worker (Part 3): the gate before a task starts
// (Private Browsing, Scout mode off, blocked sites), events to watching
// ports, confirmations by prompt id, control from the panel and from the
// overlay's own tab only, and the saved outcome. Fake browser, synthetic data.
import { describe, expect, it } from "vitest";
import { BridgeError } from "../../src/bridge/messages";
import type { ContentRequest, OverlayRequest } from "../../src/content-api";
import type { TabRef } from "../../src/context/gather";
import { parsePageAccess, type PageAccess } from "../../src/permissions/gate";
import type { ProviderClient, StreamEvent } from "../../src/providers";
import { TaskHost, type TaskHostDeps } from "../../src/server/task-host";
import type { StorageArea } from "../../src/settings/settings";

const SNAP = {
  url: "https://shop.test/a",
  title: "Shop",
  text: "Widget",
  elements: [{ ref: "e1", tag: "button", role: "button", name: "Place order" }, { ref: "e2", tag: "button", role: "button", name: "Apply" }],
  truncated: false,
  viewport: { width: 400, height: 300 },
};

function memStorage(): StorageArea & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: async (k) => Object.fromEntries([k].flat().filter((x) => x in data).map((x) => [x, data[x]])),
    set: async (items) => void Object.assign(data, items),
    clear: async () => {
      for (const k of Object.keys(data)) delete data[k];
    },
  };
}

function scripted(turns: StreamEvent[][]): ProviderClient {
  let i = 0;
  return {
    id: "anthropic",
    async *stream() {
      for (const e of turns[Math.min(i++, turns.length - 1)] ?? []) yield e;
    },
  };
}
const act = (actions: unknown[]): StreamEvent => ({ type: "tool_call", id: "a", name: "act", input: { actions } });
const finish = (summary: string): StreamEvent => ({ type: "tool_call", id: "f", name: "finish", input: { summary } });

interface Fake {
  host: TaskHost;
  storage: ReturnType<typeof memStorage>;
  content: ContentRequest[];
  overlay: OverlayRequest[];
  icons: Array<[number, boolean]>;
  saved: Array<{ conv: string; question: string; answer: string }>;
  panelOpens: number;
  posted: Array<Record<string, unknown>>;
  port: { postMessage(m: unknown): void };
}

function fake(provider: ProviderClient, opts: { tabs?: TabRef[]; access?: Partial<PageAccess>; confirmTimeoutMs?: number } = {}): Fake {
  const storage = memStorage();
  storage.data.pageAccess = parsePageAccess(opts.access ?? {});
  const tabs = opts.tabs ?? [{ id: 1, url: "https://shop.test/a", title: "Shop", windowId: 1, active: true }];
  const f: Fake = { host: undefined as never, storage, content: [], overlay: [], icons: [], saved: [], panelOpens: 0, posted: [], port: { postMessage: (m) => f.posted.push((m as { payload: Record<string, unknown> }).payload) } };
  const deps: TaskHostDeps = {
    storage,
    tab: async (id) => tabs.find((t) => t.id === id) ?? null,
    content: async (_tab, req) => {
      f.content.push(req);
      if (req.type === "scout:snapshot") return SNAP;
      if (req.type === "scout:task-probe") {
        const ref = req.target === "focused" ? "e2" : "ref" in req.target ? req.target.ref : "e2";
        const el = SNAP.elements.find((e) => e.ref === ref);
        return el ? { x: 1, y: 2, name: el.name, role: el.role, tag: el.tag } : null;
      }
      return { ok: true, action: (req as { action: { type: string } }).action.type, message: "ok" };
    },
    overlay: async (_tab, req) => void f.overlay.push(req),
    capture: async () => ({ mediaType: "image/jpeg", data: "AAAA", width: 800, height: 600 }),
    access: async () => parsePageAccess((await storage.get("pageAccess")).pageAccess),
    admin: async () => [],
    provider: async () => provider,
    settings: async () => ({ provider: "anthropic", model: "m" }),
    log: { add: async () => undefined },
    confirmTimeoutMs: opts.confirmTimeoutMs,
    setIcon: async (tabId, active) => void f.icons.push([tabId, active]),
    openPanel: async () => void f.panelOpens++,
    save: async (e) => void f.saved.push({ conv: e.conv, question: e.question, answer: e.answer }),
    now: () => Date.now(),
    keepMs: 50,
  };
  f.host = new TaskHost(deps);
  return f;
}

const settle = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("task host", () => {
  it("runs in Private Browsing like in any other tab", async () => {
    const priv = fake(scripted([[finish("x")]]), { tabs: [{ id: 1, url: "https://shop.test/", title: "Shop", incognito: true }] });
    await expect(priv.host.start({ tab_id: 1, goal: "go" })).resolves.toHaveProperty("task_id");
  });

  it("refuses Scout mode off, blocked sites, non-web pages, and empty goals before touching the page", async () => {
    const off = fake(scripted([[finish("x")]]), { access: { scoutMode: "off" } });
    await expect(off.host.start({ tab_id: 1, goal: "go" })).rejects.toThrow("turned off");
    const blocked = fake(scripted([[finish("x")]]), { access: { blocked: ["shop.test"] } });
    await expect(blocked.host.start({ tab_id: 1, goal: "go" })).rejects.toThrow("blocked");
    const local = fake(scripted([[finish("x")]]), { tabs: [{ id: 1, url: "file:///tmp/a.html", title: "a" }] });
    await expect(local.host.start({ tab_id: 1, goal: "go" })).rejects.toThrow("web pages only");
    const empty = fake(scripted([[finish("x")]]));
    await expect(empty.host.start({ tab_id: 1, goal: "  " })).rejects.toBeInstanceOf(BridgeError);
    for (const f of [off, blocked, local, empty]) expect(f.content).toHaveLength(0);
  });

  it("runs a task, streams its events to a watching port, switches the icon, and saves the outcome", async () => {
    const f = fake(scripted([[act([{ type: "click", target: { ref: "e2" } }])], [finish("Applied.")]]));
    f.host.watch(f.port, 1);
    const { task_id } = await f.host.start({ tab_id: 1, goal: "Apply the code", conv: "c1", source: "panel" });
    await f.host.outcome(task_id);
    await settle();
    expect(f.posted.map((p) => p.kind)).toEqual(["started", "log", "log", "done"]);
    expect(f.posted[0]).toMatchObject({ task_id, tab_id: 1, seq: 1, goal: "Apply the code" });
    expect(f.posted[3]).toMatchObject({ kind: "done", status: "done", summary: "Applied." });
    expect(f.icons).toEqual([[1, true], [1, false]]);
    expect(f.overlay[0]).toEqual({ type: "overlay:show", taskId: task_id, state: "running" });
    expect(f.overlay[f.overlay.length - 1]).toEqual({ type: "overlay:hide" });
    expect(f.saved).toEqual([{ conv: "c1", question: "Apply the code", answer: "Applied." }]);
    expect(f.host.status(1).task).toMatchObject({ task_id, done: { status: "done" }, log: [{ status: "note" }, { status: "ok" }] });
  });

  it("a sensitive action waits for task.decide, brings the panel up when none watches, and a reopened panel sees the prompt", async () => {
    const f = fake(scripted([[act([{ type: "click", target: { ref: "e1" }, approved: true }])], [finish("ok")]]));
    const { task_id } = await f.host.start({ tab_id: 1, goal: "Buy it" });
    await settle(60);
    const view = f.host.status(1).task!;
    expect(view.state).toBe("waiting");
    expect(view.prompt).toMatchObject({ what: "click “Place order”", site: "shop.test", preapproved: true });
    expect(f.panelOpens).toBe(1);
    expect(f.host.decide({ task_id, prompt_id: "wrong", decision: "once" })).toEqual({ accepted: false });
    expect(f.host.decide({ task_id, prompt_id: view.prompt!.prompt_id, decision: "once" })).toEqual({ accepted: true });
    const out = await f.host.outcome(task_id);
    expect(out?.status).toBe("done");
    expect(f.content.filter((c) => c.type === "scout:task-act")).toHaveLength(1);
  });

  it("a confirmation nobody answers counts as Deny after the timeout", async () => {
    const f = fake(scripted([[act([{ type: "click", target: { ref: "e1" } }])], [finish("gave up")]]), { confirmTimeoutMs: 40 });
    const { task_id } = await f.host.start({ tab_id: 1, goal: "Buy it" });
    const out = await f.host.outcome(task_id);
    expect(out?.status).toBe("done");
    expect(f.content.filter((c) => c.type === "scout:task-act")).toHaveLength(0);
    expect(f.host.status(1).task?.log.some((l) => l.status === "denied")).toBe(true);
  });

  it("the overlay's pill may control only its own tab's task; Stop hides the overlay at once and denies an open prompt", async () => {
    const f = fake(scripted([[act([{ type: "click", target: { ref: "e1" } }])], [finish("ok")]]));
    const { task_id } = await f.host.start({ tab_id: 1, goal: "Buy it" });
    await settle(60);
    await expect(f.host.control({ task_id, command: "pause" }, { kind: "content", raw: { tab: { id: 2 } } })).rejects.toBeInstanceOf(BridgeError);
    expect(await f.host.control({ task_id, command: "pause" }, { kind: "content", raw: { tab: { id: 1 } } })).toEqual({ ok: true, state: "paused" });
    expect(await f.host.control({ task_id, command: "stop" }, { kind: "panel", raw: {} })).toEqual({ ok: true });
    expect(f.overlay.some((o) => o.type === "overlay:hide")).toBe(true);
    const out = await f.host.outcome(task_id);
    expect(out?.status).toBe("stopped");
    expect(f.host.status(1).task?.prompt).toBeUndefined();
    expect(await f.host.control({ task_id, command: "stop" })).toEqual({ ok: false });
  });

  it("relays the overlay toast's Stop for a coupon run to the panel watching that tab, and only from that tab", async () => {
    const f = fake(scripted([[finish("x")]]));
    f.host.watch(f.port, 1);
    await expect(f.host.control({ task_id: "coupons:1", command: "stop" }, { kind: "content", raw: { tab: { id: 2 } } })).rejects.toBeInstanceOf(BridgeError);
    expect(await f.host.control({ task_id: "coupons:1", command: "stop" }, { kind: "content", raw: { tab: { id: 1 } } })).toEqual({ ok: true });
    expect(f.posted).toEqual([{ task_id: "coupons:1", tab_id: 1, seq: 1, kind: "stop" }]);
    expect(await f.host.control({ task_id: "coupons:7", command: "stop" })).toEqual({ ok: false });
    expect(await f.host.control({ task_id: "coupons:1", command: "pause" })).toEqual({ ok: false });
  });

  it("one task per tab, and a closed tab ends its task", async () => {
    const f = fake(scripted([[act([{ type: "wait", ms: 5000 }])]]));
    const { task_id } = await f.host.start({ tab_id: 1, goal: "wait" });
    await expect(f.host.start({ tab_id: 1, goal: "again" })).rejects.toThrow("already running");
    f.host.stopForTab(1);
    expect((await f.host.outcome(task_id))?.status).toBe("stopped");
  });
});
