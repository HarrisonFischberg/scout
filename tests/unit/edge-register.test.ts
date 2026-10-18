import { describe, expect, it, vi } from "vitest";
import { EDGE_SCRIPT_ID } from "../../src/panel/edge";

// Owner request 2026-10-18: after opening Safari from cold on iPhone, Scout's
// tab took a few seconds to appear. The worker registers the edge script at
// document_start (src/edge.ts then waits only for the page's body), and moves
// an install that still has it at document_idle over. Real worker, minimal
// Safari stub.
type Fn = (...args: never[]) => unknown;
interface Registered {
  id: string;
  js?: string[];
  matches?: string[];
  runAt?: string;
}

async function loadWorker(existing: Registered[]) {
  const on = () => ({ addListener: (_f: Fn) => undefined });
  let registered = existing.map((s) => ({ ...s }));
  const register = vi.fn(async (list: Registered[]) => void (registered = [...registered, ...list]));
  const unregister = vi.fn(async ({ ids }: { ids: string[] }) => void (registered = registered.filter((s) => !ids.includes(s.id))));
  (globalThis as unknown as Record<string, unknown>).browser = {
    runtime: { id: "scout-test", getURL: (p: string) => "safari-web-extension://scout-test/" + p, getPlatformInfo: async () => ({ os: "ios" }), onMessage: on(), onConnect: on(), onStartup: on(), onInstalled: on() },
    storage: { local: { get: async () => ({}), set: async () => undefined, remove: async () => undefined }, onChanged: on() },
    action: { setTitle: async () => undefined, setIcon: async () => undefined },
    tabs: { onRemoved: on(), onUpdated: on(), query: async () => [] },
    scripting: {
      executeScript: async () => [],
      registerContentScripts: register,
      unregisterContentScripts: unregister,
      getRegisteredContentScripts: async ({ ids }: { ids: string[] }) => registered.filter((s) => ids.includes(s.id)),
    },
    permissions: { getAll: async () => ({ origins: ["http://*/*", "https://*/*"] }), onAdded: on(), onRemoved: on() },
  };
  vi.resetModules();
  await import("../../src/background");
  await new Promise((r) => setTimeout(r, 30));
  return { register, unregister, registered: () => registered };
}

describe("edge script registration (owner request 2026-10-18)", () => {
  it("registers the tab to start with the page, not after it has loaded", async () => {
    const w = await loadWorker([]);
    expect(w.registered()).toEqual([{ id: EDGE_SCRIPT_ID, js: ["edge.js"], matches: ["http://*/*", "https://*/*"], runAt: "document_start", allFrames: false }]);
  });

  it("moves an install registered at document_idle over to document_start", async () => {
    const w = await loadWorker([{ id: EDGE_SCRIPT_ID, js: ["edge.js"], matches: ["http://*/*", "https://*/*"], runAt: "document_idle" }]);
    expect(w.unregister).toHaveBeenCalledTimes(1);
    expect(w.registered().map((s) => s.runAt)).toEqual(["document_start"]);
  });

  it("leaves an up-to-date registration alone", async () => {
    const w = await loadWorker([{ id: EDGE_SCRIPT_ID, js: ["edge.js"], matches: ["http://*/*", "https://*/*"], runAt: "document_start" }]);
    expect(w.unregister).not.toHaveBeenCalled();
    expect(w.register).not.toHaveBeenCalled();
  });
});
