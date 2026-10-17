// Part 2 wiring in the background worker: the Scout server, page context
// reads, the tool host with its permission gate, and the tool log. The
// background script registers the request handlers and hands each panel port
// to attachChatPort for streaming.
import { BridgeError, envelope, PANEL_EVENTS, checkSchema, type Envelope, type MessageSender } from "../bridge/messages";
import type { PortLike } from "../bridge/port";
import type { ContentRequest } from "../content-api";
import { extractPage } from "../context/extract";
import { readTabs, readTab, type GatherDeps, type TabRef } from "../context/gather";
import { createKeychain, nativeSend, type Provider } from "../keychain";
import { blockedBy, hostOf, loadPageAccess, parsePolicy, savePageAccess, screenshotDecision, type ScreenshotChoice } from "../permissions/gate";
import { createProvider, ProviderError, type Effort } from "../providers";
import { CONTENT_HANDLER, contentBridge, createTaskPage } from "../scout/page";
import { loadScoutAccess, refusalText, saveScoutAccess, taskRefusal, withAlwaysAllow } from "../scout/permissions";
import { taskToWire, type Decision } from "../scout/protocol";
import { ScoutTaskRunner } from "../scout/runner";
import { Consent, gatedFetch } from "../settings/consent";
import { appendHistory, loadSettings, type StorageArea } from "../settings/settings";
import { runTool, type ToolDecision, type ToolHostDeps } from "../tools/host";
import { shrinkScreenshot } from "../tools/image";
import { ToolLog } from "../tools/log";
import { offeredTools, type ToolStatus } from "../tools/registry";
import { DEV_MOCK_KEY, mockServerUrl } from "./dev";
import { ScoutServer, type SharedRef } from "./engine";
import { toWire } from "./protocol";

const POLICY_TTL_MS = 5 * 60_000;

export interface WorkerOptions {
  /** Part 3: toolbar icon for a tab, active (filled lenses) while a task runs there. */
  setActiveIcon?: (tabId: number, active: boolean) => Promise<void>;
}

let taskCounter = 0;
export function newTaskId(now: number): string {
  taskCounter = (taskCounter + 1) % 100_000;
  return "t" + now.toString(36) + "-" + taskCounter.toString(36) + "-" + Math.random().toString(36).slice(2, 6);
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

  const providerFor = async (p: Provider): Promise<ReturnType<typeof createProvider>> => {
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

  // ---------- Part 3: Scout mode task runner ----------
  const scoutAccess = () => loadScoutAccess(storage);
  const injectContent = async (tabId: number): Promise<void> => {
    await browser.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  };
  const callContent = async (tabId: number, req: ContentRequest): Promise<{ ok: boolean; value?: unknown; why?: string }> => {
    const [res] = await browser.scripting.executeScript({ target: { tabId }, func: contentBridge, args: [req, CONTENT_HANDLER] });
    const env = res?.result as { ok?: boolean; value?: unknown; why?: string } | null | undefined;
    return env && env.ok === true ? { ok: true, value: env.value } : { ok: false, why: env ? (env.why ?? "bad-envelope") : "null-result" };
  };
  const runner = new ScoutTaskRunner({
    provider: (p) => providerFor(p),
    page: (tabId) =>
      createTaskPage(tabId, {
        inject: injectContent,
        call: callContent,
        capture: async (tabId) => {
          const t = await tab(tabId);
          if (!t || !browser.tabs.captureVisibleTab || t.active === false) return null;
          // Screenshots follow the per-site answer: a site set to "never" sends none.
          if (screenshotDecision(t.url, await access(), await admin()) === "deny") return null;
          const img = await shrinkScreenshot(await browser.tabs.captureVisibleTab(t.windowId, { format: "jpeg", quality: 80 })).catch(() => null);
          return img && img.width && img.height ? { mediaType: img.mediaType, data: img.data, width: img.width, height: img.height } : null;
        },
        tab: async (tabId) => {
          const t = await tab(tabId);
          return t ? { url: t.url, title: t.title, ...(t.incognito !== undefined ? { incognito: t.incognito } : {}) } : null;
        },
      }),
    access: scoutAccess,
    blocked: async (url) => blockedBy(url, await access(), await admin()),
    saveAlwaysAllow: async (url, kind) => {
      if (storage) await saveScoutAccess(storage, withAlwaysAllow(await scoutAccess(), url, kind));
    },
    log: (e) => toolLog.add(e),
    save: async (e) => {
      if (!storage) return;
      const { retention } = await loadSettings(storage);
      await appendHistory(storage, retention, { at: e.at, question: e.question, answer: e.answer, kind: "agent", ...(e.conv ? { conv: e.conv } : {}) });
    },
    setActiveIcon: options.setActiveIcon ?? (async () => undefined),
    now: () => Date.now(),
  });

  /** Whether a task may start on a tab; the text says why not. */
  const checkTask = async (tabId: number): Promise<{ ok: true; site: string; screenshots: "allow" | "ask" | "deny" } | { ok: false; reason: string }> => {
    const t = await tab(tabId);
    if (!t) return { ok: false, reason: "That tab is no longer open." };
    const a = await access();
    const adm = await admin();
    const refusal = taskRefusal({ url: t.url, ...(t.incognito !== undefined ? { incognito: t.incognito } : {}) }, await scoutAccess(), (u) => blockedBy(u, a, adm));
    if (refusal) return { ok: false, reason: refusalText(refusal) };
    return { ok: true, site: hostOf(t.url) ?? "", screenshots: screenshotDecision(t.url, a, adm) };
  };

  const startTask = async (p: { task_id?: string; conv: string; tab_id: number; provider: Provider; model: string; effort?: Effort; goal: string; screenshots: boolean }): Promise<{ task_id: string }> => {
    const check = await checkTask(p.tab_id);
    if (!check.ok) throw new BridgeError("blocked-by-user", check.reason);
    // The panel names its task so it can subscribe at once; the chat tool gets one here.
    const task_id = p.task_id && /^[\w.-]{1,64}$/.test(p.task_id) ? p.task_id : newTaskId(Date.now());
    runner.start({ task_id, conv: p.conv, tab_id: p.tab_id, provider: p.provider, model: p.model, ...(p.effort ? { effort: p.effort } : {}), goal: p.goal, screenshots: p.screenshots && check.screenshots !== "deny" });
    return { task_id };
  };

  toolDeps.startTask = async (goal, tabId, conv) => {
    if (!storage) return { refused: "Scout mode needs storage." };
    const s = await loadSettings(storage);
    try {
      return await startTask({ conv, tab_id: tabId, provider: s.provider, model: s.model, ...(s.effort !== "default" ? { effort: s.effort } : {}), goal, screenshots: true });
    } catch (err) {
      return { refused: err instanceof Error ? err.message : "Scout mode could not start." };
    }
  };

  const server = new ScoutServer({
    provider: async (p: Provider, _model: string) => providerFor(p),
    tools: async () =>
      offeredTools({
        searchTabs: (await access()).searchTabs,
        tabGroups: !!(browser.tabs.group && browser.tabs.ungroup),
        scoutMode: (await scoutAccess()).mode !== "off",
      }),
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

  const handlers = {
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
    "tool.run": (p: { request_id: string; name: string; input: unknown; tabs: number[]; current_tab?: number; decision?: ToolDecision; conv?: string }) =>
      runTool(p, toolDeps, toolLog),
    "tools.log": async () => ({ entries: (await toolLog.list(Date.now())).slice(0, 50) }),
    // ---------- Part 3 ----------
    "task.check": (p: { tab_id: number }) => checkTask(p.tab_id),
    "task.start": (p: { task_id: string; conv: string; tab_id: number; provider: Provider; model: string; effort?: Effort; goal: string; screenshots: boolean }) =>
      startTask(p),
    "task.decide": (p: { task_id: string; request_id: string; decision: Decision }) => ({ accepted: runner.decide(p.task_id, p.request_id, p.decision) }),
    "task.control": (p: { task_id?: string; command: "take_control" | "resume" | "stop" }, sender: { kind: "panel" | "content"; raw: MessageSender }) => {
      // The overlay pill names no task: its tab does. The panel names the task it shows.
      const id = sender.kind === "content" ? (sender.raw.tab?.id !== undefined ? runner.taskForTab(sender.raw.tab.id)?.task_id : undefined) : p.task_id;
      if (!id) return { ok: false };
      const ok = p.command === "stop" ? runner.stop(id) : p.command === "take_control" ? runner.pause(id) : runner.resume(id);
      return { ok };
    },
    "task.active": (p: { tab_id: number }) => ({ task: runner.taskForTab(p.tab_id) }),
  };

  /** Streams answers to one panel port: subscribe on request, unsubscribe when the port closes. */
  function attachChatPort(port: Pick<PortLike, "postMessage" | "onDisconnect">): (env: Envelope) => boolean {
    const subs = new Map<string, () => void>();
    port.onDisconnect.addListener(() => {
      for (const off of subs.values()) off();
      subs.clear();
    });
    return (env) => {
      if (env.type === "task.subscribe" && !checkSchema(PANEL_EVENTS["task.subscribe"], env.payload)) {
        const { task_id, after_seq } = env.payload as { task_id: string; after_seq: number };
        subs.get("task:" + task_id)?.();
        const off = runner.subscribe(task_id, after_seq, (n) => port.postMessage(envelope("task.event", taskToWire(task_id, n))));
        if (off) subs.set("task:" + task_id, off);
        else {
          subs.delete("task:" + task_id);
          port.postMessage(envelope("task.lost", { task_id }));
        }
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

  return { handlers, attachChatPort, server, toolLog, runner };
}
