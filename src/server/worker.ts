// Part 2 wiring in the background worker: the Scout server, page context
// reads, the tool host with its permission gate, and the tool log. Part 3
// adds the Scout mode host (src/server/task-host.ts), which reaches the tab
// through content scripts injected on demand. The background script registers
// the request handlers and hands each panel port to attachChatPort for
// streaming answers and task events.
import { envelope, PANEL_EVENTS, checkSchema, type Envelope, type MessageSender, type SenderKind } from "../bridge/messages";
import type { PortLike } from "../bridge/port";
import { CONTENT_HANDLER, OVERLAY_HANDLER, type ContentRequest, type OverlayRequest } from "../content-api";
import { callInjected } from "../content-call";
import { extractPage } from "../context/extract";
import { readTabs, readTab, type GatherDeps, type TabRef } from "../context/gather";
import { createKeychain, nativeSend, type Provider } from "../keychain";
import { loadPageAccess, parsePolicy, savePageAccess, type ScreenshotChoice } from "../permissions/gate";
import { createProvider, ProviderError, type Effort } from "../providers";
import { effortForId, loadModelList } from "../providers/models";
import { Consent, gatedFetch } from "../settings/consent";
import { savedUrl } from "../chat/sources";
import { appendHistory, loadSettings, type StorageArea } from "../settings/settings";
import { runTool, type ToolDecision, type ToolHostDeps } from "../tools/host";
import { shrinkScreenshot } from "../tools/image";
import { ToolLog } from "../tools/log";
import { offeredTools, type ToolStatus } from "../tools/registry";
import { DEV_MOCK_KEY, mockServerUrl } from "./dev";
import { ScoutServer, type SharedRef } from "./engine";
import { toWire } from "./protocol";
import { TaskHost } from "./task-host";
import { CouponHost } from "./coupon-host";
import { allowBrowserPages, quietBrowser, tabCouponPage } from "../coupons/tab-page";
import { platformOs } from "../panel/edge";
import { reopensAfterSwitch } from "../panel/toolbar";

const POLICY_TTL_MS = 5 * 60_000;
/** Scout mode's navigate: how long to wait for the new page before observing it anyway. */
const NAVIGATE_WAIT_MS = 12_000;

// Scout mode's navigate (owner bug report 2026-10-20): page key events never
// reach Safari's address bar, so the worker sets the tab's URL itself, then
// waits until the tab reports the new page loaded.
async function navigateTab(tabId: number, url: string): Promise<void> {
  if (!browser.tabs.update) throw new Error("tabs.update unavailable");
  await browser.tabs.update(tabId, { url });
  const until = Date.now() + NAVIGATE_WAIT_MS;
  // Safari can report "complete" for the old page right after update; give it a moment to start loading.
  await new Promise((r) => setTimeout(r, 250));
  while (Date.now() < until) {
    const t = await browser.tabs.get?.(tabId).catch(() => undefined);
    if (!t) return;
    if (t.status === "complete" && t.url && t.url !== "about:blank") return;
    await new Promise((r) => setTimeout(r, 200));
  }
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

export interface WorkerOptions {
  /** Toolbar icon for a tab (Part 3: filled lens while its task runs). */
  setIcon?: (tabId: number, active: boolean) => Promise<void>;
  /** Opens the toolbar panel (Part 3: a confirmation waits and no panel is open). */
  openPanel?: () => Promise<void>;
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
        ...(e.site ? { site: e.site } : {}),
        ...(e.shared.length ? { shared: e.shared } : {}),
        // Addresses without query or fragment, which can hold session tokens.
        ...(e.sources.length ? { sources: e.sources.map((x) => ({ ...x, url: savedUrl(x.url) })).filter((x) => x.url) } : {}),
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
    navigate: (tabId, url) => navigateTab(tabId, url),
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

  // ---------- Find coupons: runs here, so it outlives the panel (owner request 2026-10-19) ----------
  const couponHost = new CouponHost({
    provider,
    page: (tabId, opts) => tabCouponPage(tabId, opts),
    tabs: () => quietBrowser(),
    allowBrowser: allowBrowserPages,
    ...(storage ? { storage } : {}),
    overlay: (tabId, req: OverlayRequest) => callInjected(tabId, "overlay.js", OVERLAY_HANDLER, req),
    save: async (e) => {
      if (!storage) return;
      const { retention } = await loadSettings(storage);
      await appendHistory(storage, retention, { at: e.at, question: e.question, answer: e.answer, kind: "coupons", ...(e.conv ? { conv: e.conv } : {}), ...(e.site ? { site: e.site } : {}) });
    },
    now: () => Date.now(),
  });

  const handlers = {
    "coupons.start": (p: { tab_id: number; window_id?: number; provider: Provider; model: string; effort?: Effort; conv?: string; phone?: boolean; site?: string }) => couponHost.start(p),
    "coupons.stop": (p: { tab_id: number }) => couponHost.stop(p.tab_id),
    "coupons.answer": (p: { tab_id: number; prompt_id: string; more: boolean }) => couponHost.answer(p),
    "coupons.status": (p: { tab_id: number }) => couponHost.status(p.tab_id),
    "coupons.list": () => couponHost.list(),
    "tabs.show": async (p: { tab_id: number }) => {
      if (!browser.tabs.update) return { ok: false };
      await browser.tabs.update(p.tab_id, { active: true });
      // Mac: only the switch. A popover opened from here, with no click behind
      // it, never showed, and Scout's button then did nothing on that tab
      // (owner report 2026-10-19); the user clicks Scout there instead.
      if (!reopensAfterSwitch(await platformOs())) return { ok: true, opened: false };
      // The panel that asked has closed itself; Safari opens one popup at a time.
      await new Promise((r) => setTimeout(r, 300));
      await (options.openPanel ?? (async () => undefined))().catch(() => undefined);
      return { ok: true, opened: true };
    },
    "task.start": (p: { tab_id: number; goal: string; conv?: string; source?: "panel" | "chat" }) => taskHost.start(p),
    "task.control": (p: { task_id: string; command: "stop" }, sender: { kind: SenderKind; raw: MessageSender }) => {
      // The overlay toast's Stop during a coupon run ("coupons:<tab>").
      const coupons = /^coupons:(\d+)$/.exec(p.task_id);
      if (coupons) return p.command === "stop" ? couponHost.stop(Number(coupons[1]), sender) : { ok: false };
      return taskHost.control(p, sender);
    },
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
      prefix_sources?: Array<{ url: string; title: string }>;
      scope?: "page" | "general";
      open_page?: { url: string; title: string };
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
        const tabId = (env.payload as { tab_id: number }).tab_id;
        const offTask = taskHost.watch(port, tabId);
        const offCoupons = couponHost.watch(port, tabId);
        unwatch = () => {
          offTask();
          offCoupons();
        };
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

  /** Whether the run behind a page's overlay is still going here (src/bridge/run-port.ts). */
  function runAlive(taskId: string, tabId: number): boolean {
    const coupons = /^coupons:(\d+)$/.exec(taskId);
    if (coupons) return Number(coupons[1]) === tabId && couponHost.running(tabId);
    return taskHost.alive(taskId, tabId);
  }

  return { handlers, attachChatPort, server, toolLog, taskHost, couponHost, runAlive };
}
