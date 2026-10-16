// Scout background worker (non-persistent). Part 1: answers bridge requests,
// tracks the panel port (per-tab open state, toolbar title), keeps the toolbar
// icon matched to the light/dark theme, and drops state for closed tabs.
// Parts 2 and 3 add the tool host, permission gate, agent runner, and overlay.
import { PANEL_EVENTS, PANEL_PORT, checkSchema, classifySender, createRouter, envelope, parseEnvelope, type MessageSender, type Self } from "./bridge/messages";
import { clearTabStates, forgetTab, loadTabStates, setPanelOpen, tabKey } from "./panel/state";
import { toolbarIcon, TITLE_CLOSE, TITLE_OPEN } from "./panel/toolbar";

const self = (): Self => ({ id: browser.runtime.id ?? "", baseUrl: browser.runtime.getURL?.("") ?? "" });
const storage = browser.storage?.local;

// ---------- Toolbar icon follows the theme ----------
const dark = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
const syncIcon = (): void => {
  void browser.action?.setIcon?.({ path: toolbarIcon(dark?.matches === true) })?.catch(() => undefined);
};
syncIcon();
dark?.addEventListener?.("change", syncIcon);

// ---------- Request/response ----------
const route = createRouter(
  {
    ping: () => ({ from: "background" }),
    "panel.state": async (p: { tabId: number }) => {
      const states = storage ? await loadTabStates(storage) : {};
      return states[tabKey(p.tabId)] ?? {};
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
// switches tabs, so a close followed quickly by a tab switch keeps the tab
// marked open, and switching back reopens the panel (action.openPopup).
const SWITCH_GRACE_MS = 400;

browser.runtime.onConnect?.addListener((port) => {
  if (port.name !== PANEL_PORT || classifySender(port.sender, self()) !== "panel") {
    port.disconnect();
    return;
  }
  let tabId: number | undefined;
  port.onMessage.addListener((raw) => {
    const parsed = parseEnvelope(raw);
    if (!parsed.ok || parsed.env.type !== "panel.hello" || checkSchema(PANEL_EVENTS["panel.hello"], parsed.env.payload)) return;
    tabId = (parsed.env.payload as { tabId: number }).tabId;
    void browser.action?.setTitle?.({ title: TITLE_CLOSE })?.catch(() => undefined);
    if (storage) void setPanelOpen(storage, tabId, true, Date.now()).catch(() => undefined);
    port.postMessage(envelope("panel.ack", { tabId }, parsed.env.request_id));
  });
  port.onDisconnect.addListener(() => {
    void browser.action?.setTitle?.({ title: TITLE_OPEN })?.catch(() => undefined);
    if (tabId === undefined || !storage) return;
    const closedTab = tabId;
    setTimeout(() => {
      void browser.tabs
        .query({ active: true, currentWindow: true })
        .then(([active]) => {
          // Still on the same tab: the user closed the panel.
          if (active?.id === closedTab) return setPanelOpen(storage, closedTab, false, Date.now());
          return undefined;
        })
        .catch(() => undefined);
    }, SWITCH_GRACE_MS);
  });
});

browser.tabs.onActivated?.addListener(({ tabId }) => {
  if (!storage || !browser.action?.openPopup) return;
  void loadTabStates(storage)
    .then((states) => (states[tabKey(tabId)]?.open ? browser.action?.openPopup?.() : undefined))
    .catch(() => undefined);
});

browser.tabs.onRemoved?.addListener((tabId) => {
  if (storage) void forgetTab(storage, tabId).catch(() => undefined);
});

browser.runtime.onStartup?.addListener(() => {
  if (storage) void clearTabStates(storage).catch(() => undefined);
  syncIcon();
});
