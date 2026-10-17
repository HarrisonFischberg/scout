// Part 2 wiring in the background worker: the Scout server, page context
// reads, the tool host with its permission gate, and the tool log. Part 3
// adds the Scout mode host (src/server/task-host.ts), which reaches the tab
// through content scripts injected on demand. The background script registers
// the request handlers and hands each panel port to attachChatPort for
// streaming answers and task events.
import { envelope, PANEL_EVENTS, checkSchema, type Envelope, type MessageSender, type SenderKind } from "../bridge/messages";
import type { PortLike } from "../bridge/port";
import { CONTENT_HANDLER, OVERLAY_HANDLER, type ContentRequest, type OverlayRequest } from "../content-api";
import { extractPage } from "../context/extract";
import { readTabs, readTab, type GatherDeps, type TabRef } from "../context/gather";
import { createKeychain, nativeSend, type Provider } from "../keychain";
import { loadPageAccess, parsePolicy, savePageAccess, type ScreenshotChoice } from "../permissions/gate";
import { createProvider, ProviderError, type Effort } from "../providers";
import { effortForId, loadModelList } from "../providers/models";
import { Consent, gatedFetch } from "../settings/consent";
import { appendHistory, loadSettings, type StorageArea } from "../settings/settings";
import { runTool, type ToolDecision, type ToolHostDeps } from "../tools/host";
import { shrinkScreenshot } from "../tools/image";
import { ToolLog } from "../tools/log";
import { offeredTools, type ToolStatus } from "../tools/registry";
import { DEV_MOCK_KEY, mockServerUrl } from "./dev";
import { ScoutServer, type SharedRef } from "./engine";
import { toWire } from "./protocol";
import { TaskHost } from "./task-host";

const POLICY_TTL_MS = 5 * 60_000;

export interface WorkerOptions {
  /** Toolbar icon for a tab (Part 3: filled lens while its task runs). */
  setIcon?: (tabId: number, active: boolean) => Promise<void>;
  /** Opens the toolbar panel (Part 3: a confirmation waits and no panel is open). */
  openPanel?: () => Promise<void>;
}

// Content-script calls from the worker, the way the popup makes them
// (scripting.executeScript with a func): on iOS a tabs.sendMessage went
// unanswered (T018), while executeScript results arrive reliably. The script
// is injected first when its handler is missing (first call, or the page
// navigated); page failures come back as an envelope, never as a silent null.
async function callInjected(tabId: number, file: string, handler: string, req: unknown): Promise<unknown> {
  const once = async (): Promise<{ ok: true; value: unknown } | { ok: false; why: string }> => {
    const [res] = await browser.scripting.executeScript({
      target: { tabId },
      func: (r: unknown, name: string) => {
        try {
          const h = (globalThis as unknown as Record<string, ((x: unknown) => unknown) | undefined>)[name];
          if (!h) return { ok: false, why: "no-handler" };
          const out = h(r);
          if (out && typeof (out as Promise<unknown>).then === "function") {
            return (out as Promise<unknown>).then(
              (value) => ({ ok: true, value }),
              () => ({ ok: false, why: "threw-async" }),
            );
          }
          return { ok: true, value: out };
        } catch {
          return { ok: false, why: "threw" };
        }
      },
      args: [req, handler],
    });
    const env = res?.result as { ok?: boolean; value?: unknown; why?: string } | null | undefined;
    if (!env || env.ok !== true) return { ok: false, why: env ? (env.why ?? "bad-envelope") : "null-result" };
    return { ok: true, value: env.value };
  };
  let out = await once().catch(() => ({ ok: false as const, why: "threw-call" }));
  if (!out.ok && /no-handler|null-result|threw-call/.test(out.why)) {
    await browser.scripting.executeScript({ target: { tabId }, files: [file] });
    out = await once();
  }
  if (!out.ok) throw new Error("content call failed: " + out.why);
  return out.value;
}

function toRef(t: { id?: number; url?: string; title?: string; windowId?: number; active?: boolean; incognito?: boolean } | undefined): TabRef | null {
  if (!t || t.id === undefined) return null;
  return {
    id: t.id,
    url: t.url ?? "",
    title: t.title ?? "",
    ...(t.windowId !== undefined ? { windowId: t.windowId } : {}),
    ...(t.active !== undefined ? { active: t.active } : {}),
    ...(t.incognito !== undefined ? { incognito: t.incognito } : {}),
  };
}

export function createScoutWorker(storage: StorageArea | undefined, options: WorkerOptions = {}) {
  const keychain = createKeychain(nativeSend);
  let policy: { at: number; list: string[] } | null = null;

  // Organization blocklist (managed setting in the host app). Cached briefly.
  const admin = async (): Promise<string[]> => {
    if (policy && Date.now() - policy.at < POLICY_TTL_MS) return policy.list;
    const list = parsePolicy(await nativeSend({ type: "policy.get" }).catch(() => null));
    policy = { at: Date.now(), list };
    return list;
  };
  const access = () => loadPageAccess(storage);

  const tab = async (id: number): Promise<TabRef | null> => {
    try {
      if (browser.tabs.get) return toRef(await browser.tabs.get(id));
      return toRef((await browser.tabs.query({})).find((t) => t.id === id));
    } catch {
      return null;
    }
  };
  const extract = async (tabId: number): Promise<unknown> => {
    const [res] = await browser.scripting.executeScript({ target: { tabId }, func: extractPage });
    return res?.result;
  };
  const gatherDeps = async (): Promise<GatherDeps> => ({ tab, extract, access: await access(), admin: await admin() });

  const toolLog = new ToolLog(storage, async () => (storage ? (await loadSettings(storage)).retention : "off"));

  const toolDeps: ToolHostDeps = {
    access,
    admin,
    saveScreenshotChoice: async (host: string, choice: ScreenshotChoice) => {
      if (!storage || !host) return;
      const a = await access();
      await savePageAccess(storage, { ...a, screenshots: { ...a.screenshots, [host]: choice } });
    },
    tab,
    allTabs: async () => (await browser.tabs.query({})).flatMap((t) => toRef(t) ?? []),
    readTab: async (id) => readTab(id, await gatherDeps()),
    openTab: async (url) => {
      if (!browser.tabs.create) throw new Error("tabs.create unavailable");
      const t = toRef(await browser.tabs.create({ url, active: false }));
      if (!t) throw new Error("no tab");
      return t;
    },
    closeTabs: async (ids) => {
      if (!browser.tabs.remove) throw new Error("tabs.remove unavailable");
      await browser.tabs.remove(ids);
    },
    ...(browser.tabs.group && browser.tabs.ungroup
      ? {
          groupTabs: async (ids: number[]) => void (await browser.tabs.group!({ tabIds: ids })),
          ungroupTabs: async (ids: number[]) => void (await browser.tabs.ungroup!(ids)),
        }
      : {}),
    capture: async (t) => {
      if (!browser.tabs.captureVisibleTab) throw new Error("captureVisibleTab unavailable");
      return shrinkScreenshot(await browser.tabs.captureVisibleTab(t.windowId, { format: "jpeg", quality: 80 }));
    },
    ...(browser.history
      ? {
          searchHistory: async (query: string, max: number) =>
            (await browser.history!.search({ text: query, maxResults: max, startTime: 0 })).flatMap((h) => (h.url ? [{ url: h.url, title: h.title ?? h.url }] : [])),
        }
      : {}),
    ...(browser.sessions
      ? {
          recentlyClosed: async (max: number) =>
            (await browser.sessions!.getRecentlyClosed({ maxResults: max })).flatMap((s) => (s.tab?.url ? [{ url: s.tab.url, title: s.tab.title ?? s.tab.url }] : [])),
        }
      : {}),
    now: () => Date.now(),
  };

  const provider = async (p: Provider, _model: string) => {
    const consent = await Consent.load(storage);
    if (!consent.has(p)) throw new ProviderError(p, "consent_required");
    const apiKey = await keychain.getKey(p).catch(() => null);
    if (!apiKey) throw new ProviderError(p, "no_key");
    let baseUrl: string | null = null;
    if (__SCOUT_DEBUG__ && storage && p === "anthropic") {
      baseUrl = mockServerUrl((await storage.get(DEV_MOCK_KEY).catch(() => ({}) as Record<string, unknown>))[DEV_MOCK_KEY]);
    }
    return createProvider(p, {
      apiKey,
      fetch: gatedFetch((q) => consent.has(q), (i, init) => fetch(i, init)),
      ...(baseUrl ? { baseUrl } : {}),
    });
  };

  const server = new ScoutServer({
    provider,
    tools: async () => {
      const a = await access();
      return offeredTools({ searchTabs: a.searchTabs, tabGroups: !!(browser.tabs.group && browser.tabs.ungroup), scoutMode: a.scoutMode !== "off" });
    },
    save: async (e) => {
      if (!storage) return;
      const { retention } = await loadSettings(storage);
      await appendHistory(storage, retention, {
        at: e.at,
        question: e.question,
        answer: e.answer,
        kind: "chat",
        conv: e.conv,
        ...(e.shared.length ? { shared: e.shared } : {}),
      });
    },
    now: () => Date.now(),
  });

  // ---------- Part 3: Scout mode ----------
  const taskHost = new TaskHost({
    storage,
    tab,
    content: (tabId, req: ContentRequest) => callInjected(tabId, "content.js", CONTENT_HANDLER, req),
    overlay: (tabId, req: OverlayRequest) => callInjected(tabId, "overlay.js", OVERLAY_HANDLER, req),
    capture: toolDeps.capture,
    access,
    admin,
    provider,
    settings: async () => {
      const s = storage ? await loadSettings(storage) : { provider: "anthropic" as const, model: "", effort: "default" as const };
      // The key in use may be the other provider's (the panel falls back); use the saved choice as the panel does.
      const known = storage ? (await loadModelList(storage, s.provider, null, (i, init) => fetch(i, init), Date.now())).models : [];
      const effort = effortForId(s.provider, s.model, s.effort, known);
      return { provider: s.provider, model: s.model, ...(effort ? { effort } : {}) };
    },
    log: toolLog,
    setIcon: options.setIcon ?? (async () => undefined),
    openPanel: options.openPanel ?? (async () => undefined),
    save: async (e) => {
      if (!storage) return;
      const { retention } = await loadSettings(storage);
      await appendHistory(storage, retention, { at: e.at, question: e.question, answer: e.answer, kind: "agent", conv: e.conv });
    },
    now: () => Date.now(),
  });

  const handlers = {
    "task.start": (p: { tab_id: number; goal: string; conv?: string; source?: "panel" | "chat" }) => taskHost.start(p),
    "task.control": (p: { task_id: string; command: "pause" | "resume" | "stop" }, sender: { kind: SenderKind; raw: MessageSender }) => taskHost.control(p, sender),
    "task.decide": (p: { task_id: string; prompt_id: string; decision: "once" | "always" | "deny" }) => taskHost.decide(p),
    "task.status": (p: { tab_id: number }) => taskHost.status(p.tab_id),
    "context.read": async (p: { current_tab?: number; attached: number[]; include_current: boolean }) => {
      const deps = await gatherDeps();
      const current = p.include_current && p.current_tab !== undefined && deps.access.readCurrent ? [p.current_tab] : [];
      const reads = await readTabs([...current, ...p.attached], deps);
      return {
        pages: reads.flatMap((r) => (r.page ? [r.page] : [])),
        shared: reads.map((r) => r.shared),
        read_current: deps.access.readCurrent,
      };
    },
    "chat.start": (p: {
      message_id: string;
      conv: string;
      provider: Provider;
      model: string;
      effort?: Effort;
      question: string;
      history: Array<{ role: "user" | "assistant"; content: string }>;
      pages: Array<{ url: string; title: string; text: string }>;
      shared?: SharedRef[];
      display_question?: string;
      answer_prefix?: string;
    }) => {
      server.start(p);
      return { message_id: p.message_id };
    },
    "chat.stop": (p: { message_id: string }) => ({ stopped: server.stop(p.message_id) }),
    "chat.tool_result": (p: {
      message_id: string;
      request_id: string;
      status: ToolStatus;
      text: string;
      image_type?: "image/jpeg" | "image/png";
      image_data?: string;
      shared_title?: string;
      shared_host?: string;
    }) => ({
      accepted: server.toolResult(p.message_id, p.request_id, {
        status: p.status,
        text: p.text,
        ...(p.image_type && p.image_data ? { image: { mediaType: p.image_type, data: p.image_data } } : {}),
        ...(p.shared_title !== undefined && p.shared_host !== undefined ? { shared: { title: p.shared_title, host: p.shared_host } } : {}),
      }),
    }),
    "chat.active": (p: { conv: string }) => ({ messages: server.active(p.conv) }),
    "tool.run": (p: { request_id: string; name: string; input: unknown; tabs: number[]; current_tab?: number; decision?: ToolDecision }) => runTool(p, toolDeps, toolLog),
    "tools.log": async () => ({ entries: (await toolLog.list(Date.now())).slice(0, 50) }),
  };

  /** Streams answers and task events to one panel port: subscribe on request, unsubscribe when the port closes. */
  function attachChatPort(port: Pick<PortLike, "postMessage" | "onDisconnect">): (env: Envelope) => boolean {
    const subs = new Map<string, () => void>();
    let unwatch: (() => void) | null = null;
    port.onDisconnect.addListener(() => {
      for (const off of subs.values()) off();
      subs.clear();
      unwatch?.();
      unwatch = null;
    });
    return (env) => {
      if (env.type === "task.watch" && !checkSchema(PANEL_EVENTS["task.watch"], env.payload)) {
        unwatch?.();
        unwatch = taskHost.watch(port, (env.payload as { tab_id: number }).tab_id);
        return true;
      }
      if (env.type !== "chat.subscribe" || checkSchema(PANEL_EVENTS["chat.subscribe"], env.payload)) return false;
      const { message_id, after_seq } = env.payload as { message_id: string; after_seq: number };
      subs.get(message_id)?.();
      const off = server.subscribe(message_id, after_seq, (n) => port.postMessage(envelope("chat.event", toWire(message_id, n))));
      if (off) subs.set(message_id, off);
      else {
        subs.delete(message_id);
        port.postMessage(envelope("chat.lost", { message_id }));
      }
      return true;
    };
  }

  return { handlers, attachChatPort, server, toolLog, taskHost };
}
