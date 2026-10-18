import { describe, expect, it, vi } from "vitest";
import { PANEL_PORT } from "../../src/bridge/messages";
import { TAB_STATE_KEY } from "../../src/panel/state";

// Owner bug 2026-10-18: after using Scout on a tab, switching to another tab
// and back reopened the panel on its own. Expected: each tab keeps its own
// chat, but the panel stays closed on return until the user clicks Scout.
// Loads the real background worker with a minimal Safari stub.
type Fn = (...args: never[]) => unknown;

async function loadWorker() {
  const data: Record<string, unknown> = {};
  const listeners: Record<string, Fn[]> = {};
  const on = (name: string) => ({ addListener: (f: Fn) => (listeners[name] ??= []).push(f) });
  let active = 1;
  const openPopup = vi.fn(async () => undefined);
  const g = globalThis as unknown as Record<string, unknown>;
  g.browser = {
    runtime: { id: "scout-test", getURL: (p: string) => "safari-web-extension://scout-test/" + p, onMessage: on("message"), onConnect: on("connect"), onStartup: on("startup"), onInstalled: on("installed") },
    storage: {
      local: {
        async get(keys: string | string[]) {
          const list = Array.isArray(keys) ? keys : [keys];
          return JSON.parse(JSON.stringify(Object.fromEntries(list.filter((k) => k in data).map((k) => [k, data[k]]))));
        },
        async set(items: Record<string, unknown>) {
          Object.assign(data, JSON.parse(JSON.stringify(items)));
        },
        async remove() {},
      },
    },
    action: { openPopup, setTitle: async () => undefined, setIcon: async () => undefined },
    tabs: { onActivated: on("activated"), onRemoved: on("removed"), onUpdated: on("updated"), query: async () => [{ id: active }] },
    scripting: { executeScript: async () => [] },
    permissions: { getAll: async () => ({ origins: [] }), onAdded: on("permAdded"), onRemoved: on("permRemoved") },
  };
  vi.resetModules();
  await import("../../src/background");
  const connect = (tabId: number) => {
    const msg: Fn[] = [];
    const disc: Fn[] = [];
    const port = {
      name: PANEL_PORT,
      sender: { id: "scout-test", url: "safari-web-extension://scout-test/popup.html" },
      onMessage: { addListener: (f: Fn) => msg.push(f) },
      onDisconnect: { addListener: (f: Fn) => disc.push(f) },
      postMessage: () => undefined,
      disconnect: () => undefined,
    };
    for (const f of listeners.connect ?? []) (f as (p: unknown) => void)(port);
    for (const f of msg) (f as (m: unknown) => void)({ type: "panel.hello", request_id: "h1", payload: { tabId } });
    return () => {
      for (const f of disc) (f as () => void)();
    };
  };
  const activate = async (tabId: number) => {
    active = tabId;
    for (const f of listeners.activated ?? []) (f as (i: unknown) => void)({ tabId });
    await new Promise((r) => setTimeout(r, 20));
  };
  return { data, openPopup, connect, activate, setActive: (id: number) => (active = id) };
}

describe("switching tabs (owner bug 2026-10-18)", () => {
  it("does not reopen Scout when the user comes back to a tab where it was open", async () => {
    const w = await loadWorker();
    const close = w.connect(1);
    await new Promise((r) => setTimeout(r, 20));
    // Safari closes the popover when the user switches tabs.
    w.setActive(2);
    close();
    await w.activate(2);
    await new Promise((r) => setTimeout(r, 500));
    await w.activate(1);
    expect(w.openPopup).not.toHaveBeenCalled();
    const states = w.data[TAB_STATE_KEY] as Record<string, { open: boolean; conv: string }>;
    expect(states["1"]?.open).toBe(false);
    // The tab keeps its own conversation for the next click.
    expect(states["1"]?.conv).toBeTruthy();
  });
});
