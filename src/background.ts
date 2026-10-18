// Scout background worker (non-persistent). Part 1: answers bridge requests,
// tracks the panel port (per-tab open state, toolbar title), keeps the toolbar
// icon matched to the light/dark theme, and drops state for closed tabs.
// Part 2 adds the Scout server, page context, tool host, and permission gate
// (src/server/worker.ts). Part 3 adds the Scout mode host and the overlay:
// the toolbar icon switches to the filled-lens variant on a tab while a task
// runs there, and a closed tab ends its task.
import { PANEL_EVENTS, PANEL_PORT, checkSchema, classifySender, createRouter, envelope, parseEnvelope, type MessageSender, type Self } from "./bridge/messages";
import { createScoutWorker } from "./server/worker";
import { edgeMatches, EDGE_RUN_AT, EDGE_SCRIPT_ID, PAGE_BUTTON_KEY, pageButtonOffered, parsePageButton, platformOs, sameMatches } from "./panel/edge";
import { clearTabStates, forgetTab, loadTabStates, setPanelOpen, tabKey } from "./panel/state";
import { openPanel, toolbarIcon, TITLE_CLOSE, TITLE_OPEN } from "./panel/toolbar";
import { createWarmer } from "./panel/warm";
import { createAskQueue, parseQuickAsk } from "./panel/quick-ask";
import { nativeSend } from "./keychain";

const self = (): Self => ({ id: browser.runtime.id ?? "", baseUrl: browser.runtime.getURL?.("") ?? "" });
const storage = browser.storage?.local;

// ---------- Toolbar icon follows the theme ----------
const dark = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
const syncIcon = (): void => {
  void browser.action?.setIcon?.({ path: toolbarIcon(dark?.matches === true) })?.catch(() => undefined);
};
syncIcon();
dark?.addEventListener?.("change", syncIcon);

// ---------- Ready before the panel opens (src/panel/warm.ts) ----------
// The app's native handler is slow to start after Safari launches; waking it
// while a page loads means the panel's Keychain reads find it running.
const warmNative = createWarmer(nativeSend);

// ---------- Quick ask (src/quick-ask.ts) ----------
// Held here between the tap on the page and Scout's panel opening; in memory
// only, and taken once.
const quickAsks = createAskQueue();

// ---------- Request/response ----------
const scout = createScoutWorker(storage, {
  setIcon: async (tabId, active) => {
    await browser.action?.setIcon?.({ path: toolbarIcon(dark?.matches === true, active), tabId })?.catch(() => undefined);
  },
  openPanel: async () => void (await openPanel(browser.action)),
});
const route = createRouter(
  {
    ...scout.handlers,
    ping: () => ({ from: "background" }),
    "panel.state": async (p: { tabId: number }) => {
      const states = storage ? await loadTabStates(storage) : {};
      return states[tabKey(p.tabId)] ?? {};
    },
    // Page button (src/edge.ts): Safari's own panel, never a frame in the page.
    "panel.open": () => openPanel(browser.action),
    // Quick ask: keep the question for this tab, then open the panel (still
    // inside the tap, which Safari needs to open it).
    "panel.ask": async (p: unknown, sender) => {
      const tabId = sender.raw.tab?.id;
      const asked = parseQuickAsk(p);
      if (tabId === undefined || !asked) return { opened: false };
      quickAsks.put(tabId, asked, Date.now());
      const r = await openPanel(browser.action);
      if (!r.opened) quickAsks.drop(tabId);
      return r;
    },
    "panel.take_ask": (p: { tabId: number }) => quickAsks.take(p.tabId, Date.now()) ?? {},
    // Page button loaded or touched: answer at once, warm in the background.
    "panel.warm": () => {
      void warmNative();
      return {};
    },
  },
  self,
);

browser.runtime.onMessage.addListener((message: unknown, sender?: MessageSender) => {
  // Older callers still send a bare "ping".
  if (message === "ping") return Promise.resolve({ ok: true, from: "background" });
  return route(message, sender).then((reply) => reply ?? undefined);
});

// ---------- Panel port ----------
// The port is open while the panel is. Safari closes the popover when the user
// switches tabs; the panel then stays closed when they come back, until they
// click Scout, which shows that tab's own conversation (owner request
// 2026-10-18, replacing Part 1's reopen on tab switch).

browser.runtime.onConnect?.addListener((port) => {
  if (port.name !== PANEL_PORT || classifySender(port.sender, self()) !== "panel") {
    port.disconnect();
    return;
  }
  let tabId: number | undefined;
  const chat = scout.attachChatPort(port);
  port.onMessage.addListener((raw) => {
    const parsed = parseEnvelope(raw);
    if (parsed.ok && chat(parsed.env)) return;
    if (!parsed.ok || parsed.env.type !== "panel.hello" || checkSchema(PANEL_EVENTS["panel.hello"], parsed.env.payload)) return;
    tabId = (parsed.env.payload as { tabId: number }).tabId;
    void browser.action?.setTitle?.({ title: TITLE_CLOSE })?.catch(() => undefined);
    if (storage) void setPanelOpen(storage, tabId, true, Date.now()).catch(() => undefined);
    port.postMessage(envelope("panel.ack", { tabId }, parsed.env.request_id));
  });
  port.onDisconnect.addListener(() => {
    void browser.action?.setTitle?.({ title: TITLE_OPEN })?.catch(() => undefined);
    if (tabId === undefined || !storage) return;
    void setPanelOpen(storage, tabId, false, Date.now()).catch(() => undefined);
  });
});

browser.tabs.onRemoved?.addListener((tabId) => {
  scout.taskHost.stopForTab(tabId);
  if (storage) void forgetTab(storage, tabId).catch(() => undefined);
});

browser.runtime.onStartup?.addListener(() => {
  if (storage) void clearTabStates(storage).catch(() => undefined);
  syncIcon();
  queuePageButtonSync();
  void warmNative();
});

// ---------- Page button: the edge script runs only where Scout has site access ----------
// Registered for the granted web origins while the setting is on, and
// unregistered when it is off, no site is granted, or Safari is on a Mac. Updated when the setting
// or the grants change. Pages already open drop the button themselves when the
// setting goes off (src/edge.ts).
async function syncPageButton(): Promise<void> {
  const scripting = browser.scripting;
  if (!storage || !scripting.registerContentScripts || !scripting.unregisterContentScripts) return;
  const pref = parsePageButton((await storage.get(PAGE_BUTTON_KEY))[PAGE_BUTTON_KEY]);
  const matches = pref.on && pageButtonOffered(await platformOs()) ? edgeMatches((await browser.permissions.getAll()).origins ?? []) : [];
  const existing = (await scripting.getRegisteredContentScripts?.({ ids: [EDGE_SCRIPT_ID] }).catch(() => [])) ?? [];
  const current = existing.find((s) => s.id === EDGE_SCRIPT_ID);
  // An older install registered it at document_idle; re-register so it starts early.
  if (current ? current.runAt === EDGE_RUN_AT && sameMatches(current.matches ?? [], matches) : matches.length === 0) return;
  if (current) await scripting.unregisterContentScripts({ ids: [EDGE_SCRIPT_ID] });
  if (matches.length) {
    await scripting.registerContentScripts([{ id: EDGE_SCRIPT_ID, js: ["edge.js"], matches, runAt: EDGE_RUN_AT, allFrames: false }]);
  }
}

let pageButtonSync: Promise<void> = Promise.resolve();
function queuePageButtonSync(): void {
  pageButtonSync = pageButtonSync.then(syncPageButton).catch(() => undefined);
}
queuePageButtonSync();
browser.runtime.onInstalled?.addListener(queuePageButtonSync);
browser.permissions.onAdded?.addListener(queuePageButtonSync);
browser.permissions.onRemoved?.addListener(queuePageButtonSync);
browser.storage?.onChanged?.addListener((changes, area) => {
  const change = changes[PAGE_BUTTON_KEY];
  // Only on/off matters here; moving the button changes nothing about where it runs.
  if (area === "local" && change && parsePageButton(change.oldValue).on !== parsePageButton(change.newValue).on) queuePageButtonSync();
});
