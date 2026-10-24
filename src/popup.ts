// Popup (S04, redesigned T021–T026): chat-first panel with a Chat / Scout
// mode switch, saved conversation, and an in-popup Settings view.
// Part 1: the Scout panel ("scout-panel"). One conversation per tab, a port to
// the background worker while open; Private Browsing chats go when the tab closes.
// Part 3: Scout mode runs in the worker (src/server/task-host.ts); the panel
// shows its action log, Stop, and the sensitive-action confirmation
// (Stop is the composer's button), and the Permissions screen in Settings.
import { classifyQuestion, pageWords, type QuestionScope } from "./chat/intent";
import { LEGACY_SUMMARIZE_QUESTIONS, SUMMARIZE_QUESTION, type PageContext } from "./chat/prompt";
import { chipSources, renderMarkdown } from "./chat/markdown";
import { answerText, fillSourceCard, savedUrl, siteIcon, siteName, type Source } from "./chat/sources";
import { ConversationStore, type StoredMessage } from "./chat/store";
import { MAX_EXTRA_TABS, type TabInfo } from "./chat/tabs";
import { formatMoney } from "./coupons/money";
import { originLabel } from "./coupons/candidates";
import { couponStatusText } from "./coupons/finder";
import { formatCostLine } from "./cost";
import { BUTTON_KEY, buildReport, describeBrowser, Diagnostics, disabledRun, loadButtonFailures, type ButtonFailure, type RunHandle, type RunKind } from "./diagnostics";
import { createKeychain, nativeSend, type Provider } from "./keychain";
import { BridgeError, envelope, newRequestId, request, type Envelope } from "./bridge/messages";
import { connectPanelPort, type PanelPort } from "./bridge/port";
import type { ReadStatus, SharedTab } from "./context/gather";
import { dropMention, mentionAt, sharedLabel, suggestTabs, toolLabel } from "./panel/attach";
import { cutAt, nextShown } from "./panel/typing";
import { hostOf, loadPageAccess, normalizeSite, parsePolicy, savePageAccess, screenshotDecision, withoutAlwaysAllow, type PageAccess } from "./permissions/gate";
import { KIND_LABEL, type SensitiveKind } from "./safety/classifier";
import type { TaskView } from "./server/task-host";
import { DEV_MOCK_KEY, DEV_MOCK_URL, mockServerUrl } from "./server/dev";
import { fromWire } from "./server/protocol";
import type { ToolDecision, ToolResult } from "./tools/host";
import { ALL_SITES, PAGE_BUTTON_KEY, pageButtonOffered, parsePageButton, platformOs, reachText, type PageButton } from "./panel/edge";
import { conversationForTab, parsePrivateConvs, PRIVATE_CONVS_KEY, reopenConversation, startNewConversation, tabKey } from "./panel/state";
import { summarizeChats, whenText } from "./chat/list";
import { Consent, consentText, ensureConsent, gatedFetch } from "./settings/consent";
import { createProvider, textOf, type ChatMessage, type Effort, type ProviderClient, type Usage } from "./providers";
import { checkKey, looksLikeKey } from "./providers/keytest";
import { siteIconUrl, suggestionsFor } from "./panel/suggestions";
import { joinDictation, Listener, micBlocked, micBlockedHere, micErrorText, recognitionCtor, rememberMic } from "./panel/voice";
import { PageListener } from "./panel/page-listen";
import { editableFocused, fitAboveKeyboard } from "./panel/keyboard";
import { probeDrag } from "./panel/drag-probe";
import { COUPON_QUESTION } from "./server/coupon-host";
import { isPhoneScreen } from "./panel/blur";
import { closeWhenHidden } from "./panel/dismiss";
import { dockComposer } from "./panel/dock";
import { hintedProvider, KEY_HINT_KEY, parseKeyHint, sameHint, type KeyHint } from "./panel/warm";
import { isStandalone, openStandalone } from "./panel/standalone";
import { applyLook, cachedLook, cacheLook, defaultLook, LOOK_KEY, LOOKS, pageCache, parseLook, type LookId } from "./panel/look";
import { EFFORT_LABEL, effortForId, loadModelList, withModel, type ModelInfo } from "./providers/models";
import {
  appendHistory,
  clearHistory,
  clearShared,
  DEFAULT_EFFORT,
  DEFAULT_MODEL,
  deleteAllData,
  deleteConversation,
  deleteReportText,
  HISTORY_KEY,
  loadConversation,
  loadHistory,
  loadRatings,
  loadSettings,
  parseSettings,
  ratingKey,
  saveRating,
  saveSettings,
  siteOf,
  summarizeShared,
  type EffortSetting,
  type HistoryEntry,
  type Rating,
  type Settings,
  type StorageArea,
} from "./settings/settings";
import { applyBrowserText, browserName, keyPlace, TARGET } from "./platform";

// Model defaults live in settings.ts. The OpenAI default is UNKNOWN until
// confirmed against OpenAI docs (activity.md T005).

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error("missing #" + id);
  return node as T;
}

type KeyRead = { key: string | null; error?: string };
type SavedKeys = Record<Provider, KeyRead>;

// Both providers' keys in one parallel round of Keychain reads. Each read wakes
// the app's native handler, which is slow the first time after Safari starts,
// so the panel reads them once, in parallel, as it opens (owner request
// 2026-10-18), instead of one after another.
async function readKeys(): Promise<SavedKeys> {
  const keychain = createKeychain(nativeSend);
  const read = async (p: Provider): Promise<KeyRead> => {
    try {
      return { key: await keychain.getKey(p) };
    } catch (err) {
      return { key: null, error: err instanceof Error ? err.message : "unknown" };
    }
  };
  const [anthropic, openai] = await Promise.all([read("anthropic"), read("openai")]);
  return { anthropic, openai };
}

// Prefers the provider chosen in settings, then any provider with a saved key.
// A fallback provider uses its own default model, not the chosen model.
// Uses the chosen provider's key. Falls back to the other provider only with
// a note the popup shows, never silently (seen in T018: OpenAI chosen, Anthropic
// used with no explanation).
function findKey(
  chosen: Settings,
  keys: SavedKeys,
): { settings: Settings; apiKey: string; fellBackFrom?: Provider } | null {
  const order: Provider[] = chosen.provider === "openai" ? ["openai", "anthropic"] : ["anthropic", "openai"];
  for (const provider of order) {
    const { key: apiKey, error } = keys[provider];
    // Treat an unreadable item like a missing one.
    trace("key:" + provider + (error !== undefined ? " error " + error : apiKey ? " found" : " missing"));
    if (apiKey) {
      const same = provider === chosen.provider;
      const model = same ? chosen.model : DEFAULT_MODEL[provider];
      return {
        settings: { ...chosen, provider, model, effort: same ? chosen.effort : DEFAULT_EFFORT[provider] },
        apiKey,
        ...(provider !== chosen.provider ? { fellBackFrom: chosen.provider } : {}),
      };
    }
  }
  return null;
}

/** Providers with a key in the Keychain; the Models sheet lists only their models. */
function savedProviders(keys: SavedKeys): Set<Provider> {
  return new Set((["anthropic", "openai"] as const).filter((p) => keys[p].key));
}

const PROVIDER_NAME: Record<Provider, string> = { anthropic: "Anthropic", openai: "OpenAI" };

async function listTabs(): Promise<TabInfo[]> {
  try {
    const tabs = await browser.tabs.query({ currentWindow: true });
    return tabs.flatMap((t) =>
      t.id === undefined || !t.url || !/^https?:/.test(t.url)
        ? []
        : [{ id: t.id, title: t.title ?? t.url, url: t.url, active: t.active === true }],
    );
  } catch {
    return [];
  }
}

interface ActiveTab {
  id?: number;
  windowId?: number;
  url?: string;
  title?: string;
  favIconUrl?: string;
  incognito: boolean;
}

async function activeTab(): Promise<ActiveTab> {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    return {
      ...(tab?.id !== undefined ? { id: tab.id } : {}),
      ...(tab?.windowId !== undefined ? { windowId: tab.windowId } : {}),
      ...(tab?.url ? { url: tab.url } : {}),
      ...(tab?.title ? { title: tab.title } : {}),
      ...(tab?.favIconUrl ? { favIconUrl: tab.favIconUrl } : {}),
      incognito: tab?.incognito === true || browser.extension?.inIncognitoContext === true,
    };
  } catch {
    return { incognito: browser.extension?.inIncognitoContext === true };
  }
}


// Debug builds only: local run recorder (src/diagnostics.ts). `current` is the
// run in progress; every stage also goes to the native log. Stage names only,
// never content.
let diag: Diagnostics | null = null;
let current: RunHandle = disabledRun;
/** Times the page button could not open Scout (recorded by the worker). */
let buttonFailures: ButtonFailure[] = [];

function startRun(kind: RunKind, meta: { provider?: string; model?: string; question?: string; mock?: boolean } = {}): RunHandle {
  current = diag ? diag.start(kind, meta) : disabledRun;
  return current;
}

function trace(stage: string): void {
  current.stage(stage);
  if (!__SCOUT_DEBUG__) return;
  void Promise.resolve()
    .then(() => browser.runtime.sendNativeMessage("com.example.SafariScout", { type: "debug.stage", stage }))
    .catch(() => undefined);
}

function diagnosticsReport(): string {
  return buildReport(diag?.runs ?? [], {
    version: __SCOUT_VERSION__,
    build: __SCOUT_DEBUG__ ? "debug" : "release",
    browser: describeBrowser(navigator.userAgent),
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }, buttonFailures);
}

// Copies the report. If the clipboard is refused, shows it selected in a
// read-only box next to `anchor` so the user can copy it by hand.
async function copyDiagnostics(anchor: HTMLElement, statusNode: HTMLElement): Promise<void> {
  const text = diagnosticsReport();
  try {
    await navigator.clipboard.writeText(text);
    statusNode.textContent = "Diagnostics copied. Paste them into your bug report as Actual behavior.";
  } catch {
    let box = anchor.parentElement?.querySelector<HTMLTextAreaElement>("textarea.diag-fallback") ?? null;
    if (!box) {
      box = document.createElement("textarea");
      box.className = "diag-fallback";
      box.readOnly = true;
      box.setAttribute("aria-label", "Diagnostics report to copy");
      box.style.width = "100%";
      box.style.minHeight = "120px";
      anchor.insertAdjacentElement("afterend", box);
    }
    box.value = text;
    box.focus();
    box.select();
    statusNode.textContent = "Could not copy automatically. The report is selected: press Command-C.";
  }
}

/** Settings key: "asked" once Find coupons has asked Safari for access to every site (for the browser fallback). */
const COUPON_BROWSER_KEY = "couponBrowser";

// Granted site origins; a provider API host is never listed as a site.
async function listOrigins(): Promise<string[]> {
  try {
    const all = await browser.permissions.getAll();
    return (all.origins ?? []).filter(
      (o) => !o.startsWith("https://api.anthropic.com/") && !o.startsWith("https://api.openai.com/"),
    );
  } catch {
    return [];
  }
}


type Mode = "chat" | "scout";

interface Session {
  settings: Settings;
  provider: ProviderClient;
  /** The effort actually sent: the setting when the model supports it. */
  effort?: Effort;
  fellBackFrom?: Provider;
  /** Debug builds: Settings > Diagnostics > local mock server is on. */
  mock?: boolean;
}

// Display names from the provider's model list (or the built-in one), filled
// as lists load. The pill drops the "Claude " prefix to stay short.
const modelNames = new Map<string, string>();
const knownModels: Record<Provider, ModelInfo[]> = { anthropic: [], openai: [] };

function rememberModels(provider: Provider, models: ModelInfo[]): void {
  knownModels[provider] = models;
  for (const m of models) modelNames.set(m.id, m.name);
}

const prettyModel = (id: string): string => (modelNames.get(id) ?? id).replace(/^Claude /, "");

// Toggle shortcut (manifest "commands"): Control-Shift-S on Mac, Option-Shift-S
// elsewhere. Safari opens the panel; pressing it again inside the panel closes it.
function isToggleShortcut(e: KeyboardEvent): boolean {
  return e.code === "KeyS" && e.shiftKey && !e.metaKey && (e.ctrlKey !== e.altKey);
}

/** Marks the label of each checked radio in a segmented control. */
function syncSegmented(inputs: HTMLInputElement[]): void {
  for (const i of inputs) i.closest("label")?.classList.toggle("on", i.checked);
}

const CONTEXT_TURNS = 10;
/** Clear chat history gives up and says so when storage has not answered by then. */
const CLEAR_TIMEOUT_MS = 5_000;

/** The moving "processing" indicator: coupon milestones, a Working card's head, and an answer before its first words. */
const PULSE = '<span class="pulse" aria-hidden="true"><i></i><i></i><i></i></span>';

/** Scout as its own page in a tab (src/panel/standalone.ts), not the toolbar panel. */
const STANDALONE = isStandalone(location.search);
if (STANDALONE) document.documentElement.dataset.standalone = "";

// The look (src/panel/look.ts), from the synchronous cache so the panel opens in it; the saved setting confirms it in main().
const lookCache = pageCache();
/** iPhone and iPad (touch): Pure Apple by default (owner 2026-10-19). */
const TOUCH = matchMedia("(pointer: coarse)").matches;
const HOME_LOOK = defaultLook(TOUCH);
/** The question box hint on every device (owner 2026-10-19). */
const ASK_HINT = "What can Scout help with today?";
applyLook(document, cachedLook(lookCache, HOME_LOOK));

async function main(): Promise<void> {
  applyBrowserText(document);
  const chatView = el("chat-view");
  const settingsView = el("settings-view");
  const thread = el("thread");
  const status = el("status");
  const log = el("log");
  const noKey = el("no-key");
  const empty = el("empty");
  const siteSuggestions = el<HTMLUListElement>("site-suggestions");
  const composer = el<HTMLFormElement>("composer");
  const question = el<HTMLTextAreaElement>("question");
  question.placeholder = ASK_HINT;
  const send = el<HTMLButtonElement>("send");
  const stop = el<HTMLButtonElement>("stop");
  const mic = el<HTMLButtonElement>("mic");
  const plus = el<HTMLButtonElement>("plus");
  const plusMenu = el("plus-menu");
  const couponsRun = el<HTMLButtonElement>("coupons-run");
  const modeChip = el("mode-chip");
  const modelPill = el<HTMLButtonElement>("model-pill");
  const modelPillText = el("model-pill-text");
  const modelMenu = el("model-menu");
  const modeInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="mode"]'));
  const confirmBox = el("confirm");
  const confirmWhat = el("confirm-what");
  const confirmReason = el("confirm-reason");
  const confirmOnce = el<HTMLButtonElement>("confirm-once");
  const confirmAlways = el<HTMLButtonElement>("confirm-always");
  const confirmDeny = el<HTMLButtonElement>("confirm-deny");

  const storage: StorageArea | undefined = browser.storage?.local;

  // ---------- Look (Settings > Look) ----------
  const lookInputs: HTMLInputElement[] = [];
  function showLook(id: LookId): void {
    applyLook(document, id);
    cacheLook(lookCache, id);
    for (const i of lookInputs) i.checked = i.value === id;
  }
  for (const look of LOOKS) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "look";
    input.value = look.id;
    const sw = document.createElement("span");
    sw.className = "sw";
    sw.setAttribute("aria-hidden", "true");
    for (const c of look.swatch) {
      const dot = document.createElement("i");
      dot.style.background = c;
      sw.appendChild(dot);
    }
    const name = document.createElement("span");
    name.textContent = look.name;
    const blurb = document.createElement("span");
    blurb.className = "blurb";
    blurb.textContent = look.blurb;
    label.append(input, sw, name, blurb);
    input.addEventListener("change", () => {
      if (!input.checked) return;
      const id = parseLook(input.value, HOME_LOOK);
      showLook(id);
      trace("look:" + id);
      void storage?.set({ [LOOK_KEY]: id }).catch(() => undefined);
    });
    lookInputs.push(input);
    el("look-list").appendChild(label);
  }
  showLook(parseLook(document.documentElement.dataset.look, HOME_LOOK));
  if (storage) {
    void storage
      .get(LOOK_KEY)
      .then((got) => {
        // No saved look (never chosen, or Delete all data) is the default, whatever the cache says.
        showLook(parseLook(got[LOOK_KEY], HOME_LOOK));
      })
      .catch(() => undefined);
  }
  const keychain = createKeychain(nativeSend);
  // Started now so the Keychain reads run while the rest of the panel loads;
  // the first connect() uses them, later ones read again.
  let firstKeys: Promise<SavedKeys> | null = readKeys();
  let settings = parseSettings(undefined);
  // Everything the panel needs before it can show anything, read at once
  // rather than one after another: each storage call is slow on a phone
  // that just started Safari (owner request 2026-10-18).
  // Permission to share with each AI provider (src/settings/consent.ts). Every
  // provider request goes through providerFetch, which refuses one without it.
  const none = {} as Record<string, unknown>;
  const [loaded, consent, tab, early] = await Promise.all([
    storage ? loadSettings(storage).catch(() => settings) : settings,
    Consent.load(storage),
    // Private Browsing works like a regular tab (owner request 2026-10-17); its
    // chats are deleted from history when the tab closes (src/panel/state.ts).
    activeTab(),
    storage ? storage.get([KEY_HINT_KEY, COUPON_BROWSER_KEY]).catch(() => none) : none,
  ]);
  settings = loaded;
  /** Saved with each answer to title the chat in the chats menu (host only). */
  const pageSite = STANDALONE ? undefined : siteOf(tab.url);
  /** Which providers had a saved key last time (src/panel/warm.ts). */
  let keyHint: KeyHint = parseKeyHint(early[KEY_HINT_KEY]);
  const providerFetch = gatedFetch((p) => consent.has(p), (i, init) => fetch(i, init));

  document.addEventListener("keydown", (e) => {
    if (isToggleShortcut(e) && !STANDALONE) {
      e.preventDefault();
      window.close();
    }
  });

  // ---------- Per-tab conversation and the worker port ----------
  // Answers stream from the Scout server in the worker over this port (Part 2).
  // After a reconnect, every unfinished answer is resubscribed from the last
  // event the panel has, so nothing is shown twice.
  const store = new ConversationStore();
  // Read alongside the model lists below.
  const convRead = storage ? conversationForTab(storage, tab.id, Date.now(), tab.incognito).catch(() => "") : Promise.resolve("");
  let conv = "";
  let port: PanelPort | null = null;
  if (browser.runtime.connect && tab.id !== undefined) {
    const tabId = tab.id;
    try {
      port = connectPanelPort({
        connect: (info) => browser.runtime.connect!(info),
        hello: () => envelope("panel.hello", { tabId, ...(tab.windowId !== undefined ? { windowId: tab.windowId } : {}) }),
        onOpen: (post) => {
          for (const m of store.open()) post("chat.subscribe", { message_id: m.id, after_seq: m.lastSeq });
          // Part 3: this tab's task events (action log, state, confirmations).
          post("task.watch", { tab_id: tabId });
        },
        onEvent: (env) => onWorkerEvent(env),
        onState: (state) => trace("port:" + state),
      });
    } catch {
      port = null;
    }
  }
  window.addEventListener("pagehide", () => port?.close());
  // Mac: a panel Safari has hidden closes itself, so the Scout button opens a fresh one (src/panel/dismiss.ts).
  if (!STANDALONE && !matchMedia("(pointer: coarse)").matches) closeWhenHidden(document, () => window.close(), trace);

  // Cached or built-in model lists, so names and effort support are known
  // before Settings is opened. No network call here. Debug builds load their
  // diagnostics in the same round.
  const mockRead = __SCOUT_DEBUG__ && storage ? storage.get(DEV_MOCK_KEY).catch(() => none) : Promise.resolve(none);
  if (__SCOUT_DEBUG__) {
    diag = new Diagnostics(storage);
    void loadButtonFailures(storage).then((f) => (buttonFailures = f));
  }
  [conv] = await Promise.all([
    convRead,
    diag?.load(),
    ...(["anthropic", "openai"] as const).map(async (p) => rememberModels(p, (await loadModelList(storage, p, null, providerFetch, Date.now())).models)),
  ]);

  let session: Session | null = null;
  /**
   * Set while the panel shows the question box from the key hint and the
   * first Keychain read is still out. Anything sent meanwhile waits for it.
   */
  let connecting: Promise<void> | null = null;
  const history: ChatMessage[] = [];
  /** Was the last message about the page? A short follow-up keeps its topic. */
  let lastScope: QuestionScope | undefined;
  /** The answer streaming now (Part 2), if any. */
  let activeChat: string | null = null;
  let others: TabInfo[] = [];
  /** Tabs the user attached. They go with every question until removed. */
  const attached = new Map<number, TabInfo>();
  const toWorker = (m: unknown): Promise<unknown> => browser.runtime.sendMessage(m);

  // ---------- Diagnostics (debug builds only) ----------
  if (__SCOUT_DEBUG__) {
    const diagBox = el("diag");
    const diagStatus = el("diag-status");
    const diagQuestion = el<HTMLInputElement>("diag-question");
    const diagCopy = el<HTMLButtonElement>("diag-copy");
    diagQuestion.checked = diag?.includeQuestion === true;
    diagQuestion.addEventListener("change", () => void diag?.setIncludeQuestion(diagQuestion.checked));
    diagCopy.addEventListener("click", () => void copyDiagnostics(diagCopy.parentElement ?? diagCopy, diagStatus));
    // Answers from the local mock server (scripts/mock-scout-server.mjs) instead of Anthropic.
    const diagMock = el<HTMLInputElement>("diag-mock");
    const mockSet = await mockRead;
    diagMock.checked = typeof mockSet[DEV_MOCK_KEY] === "string";
    diagMock.addEventListener("change", () => {
      void storage?.set({ [DEV_MOCK_KEY]: diagMock.checked ? DEV_MOCK_URL : null }).then(async () => {
        await connect();
        diagStatus.textContent = diagMock.checked ? "Answers now come from the local mock server." : "Answers come from your provider again.";
      });
    });
    el("diag-clear").addEventListener("click", () => {
      buttonFailures = [];
      void storage?.set({ [BUTTON_KEY]: [] }).catch(() => undefined);
      void diag?.clear().then(() => (diagStatus.textContent = "Diagnostics cleared."));
    });
    diagBox.hidden = false;
  }

  // ---------- Thread ----------
  // Stay pinned to the newest message when the thread grows or shrinks (the
  // composer grows as you type or when Scout mode adds its chip), unless
  // the user has scrolled up to read. scrollToEnd pins it (a new question,
  // a prompt to answer); followEnd only keeps an already pinned thread at
  // the bottom, so an answer typing out never pulls the user back down
  // while they read from its top (owner, 2026-10-18).
  let atBottom = true;
  let pinnedTop = -1;
  const scrollToEnd = (): void => {
    atBottom = true;
    thread.scrollTop = thread.scrollHeight;
    pinnedTop = thread.scrollTop;
  };
  const followEnd = (): void => {
    if (atBottom) scrollToEnd();
  };
  thread.addEventListener("scroll", () => {
    // Our own scroll, before the content grew under it, is not the user's.
    if (Math.abs(thread.scrollTop - pinnedTop) < 2) return;
    atBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 24;
  });
  // Unpin as soon as the user starts scrolling up, before the next typed
  // frame can scroll the thread back down under their finger or wheel.
  thread.addEventListener("wheel", (e) => {
    if (e.deltaY < 0) atBottom = false;
  }, { passive: true });
  let touchY = 0;
  thread.addEventListener("touchstart", (e) => {
    touchY = e.touches[0]?.clientY ?? 0;
  }, { passive: true });
  thread.addEventListener("touchmove", (e) => {
    if ((e.touches[0]?.clientY ?? 0) > touchY + 4) atBottom = false;
  }, { passive: true });
  new ResizeObserver(followEnd).observe(thread);

  // ---------- Answer actions and sources (owner items 10 and 12) ----------
  // Under each finished answer: Copy, Share, Good / Bad answer, Branch, and
  // "N sources". Citations show as site chips at the end of the paragraph
  // that used them; hovering (or tapping, on touch) shows the source's card.
  // Ratings stay on this device (storage key `ratings`); nothing is sent.

  /** Saved entries shown in this chat, in order; chat answers carry their bubble. */
  const turns: Array<{ bubble?: HTMLElement; entry: HistoryEntry }> = [];
  let ratingsLoad: Promise<Record<string, Rating>> | null = null;
  const ratings = (): Promise<Record<string, Rating>> =>
    (ratingsLoad ??= storage ? loadRatings(storage).catch(() => ({})) : Promise.resolve({}));

  const ICON_PATHS = {
    copy: ["M9 8h10a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z", "M16 8V4a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h3"],
    check: ["M5 12.5l4.5 4.5L19 7.5"],
    share: ["M12 15V3", "M7.5 7.5L12 3l4.5 4.5", "M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"],
    up: ["M7 10.5V21", "M7 10.5l4-8a2.5 2.5 0 0 1 3 2.6V9h5a2 2 0 0 1 2 2.4l-1.5 8A2 2 0 0 1 17.5 21H4a1 1 0 0 1-1-1v-8.5a1 1 0 0 1 1-1Z"],
    down: ["M17 13.5V3", "M17 13.5l-4 8a2.5 2.5 0 0 1-3-2.6V15H5a2 2 0 0 1-2-2.4l1.5-8A2 2 0 0 1 6.5 3H20a1 1 0 0 1 1 1v8.5a1 1 0 0 1-1 1Z"],
    branch: ["M6 3v5a6 6 0 0 0 6 6", "M18 3v5a6 6 0 0 1-6 6v7"],
  };
  type IconName = keyof typeof ICON_PATHS;

  function icon(name: IconName): SVGSVGElement {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "i");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    for (const d of ICON_PATHS[name]) {
      const path = document.createElementNS(NS, "path");
      path.setAttribute("d", d);
      svg.appendChild(path);
    }
    return svg;
  }

  function actionButton(name: IconName, label: string, onClick: (b: HTMLButtonElement) => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "icon-btn";
    b.setAttribute("aria-label", label);
    b.title = label;
    b.appendChild(icon(name));
    b.addEventListener("click", () => onClick(b));
    return b;
  }

  async function copyText(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  /** The row under a finished chat answer. */
  function answerActions(bubble: HTMLElement, turn: { question: string; answer: string; sources?: Source[] }): HTMLElement {
    const sources = turn.sources ?? [];
    const row = document.createElement("div");
    row.className = "answer-actions";
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", "Answer actions");

    const copy = actionButton("copy", "Copy answer", (b) => {
      void copyText(answerText(turn.answer, sources)).then((ok) => {
        status.textContent = ok ? "Copied the answer." : "Could not copy. Select the answer and press Command-C.";
        if (!ok) return;
        b.replaceChildren(icon("check"));
        setTimeout(() => b.replaceChildren(icon("copy")), 1500);
      });
    });

    const share = actionButton("share", "Share answer", () => {
      const text = turn.question + "\n\n" + answerText(turn.answer, sources);
      void (async () => {
        const data = { title: "Scout AI Assistant", text };
        if (typeof navigator.share === "function" && (!navigator.canShare || navigator.canShare(data))) {
          try {
            await navigator.share(data);
            return;
          } catch (err) {
            // Closed the share sheet: nothing else to do.
            if (err instanceof Error && err.name === "AbortError") return;
          }
        }
        status.textContent = (await copyText(text))
          ? "Sharing is not available here, so the question and answer were copied. Paste them where you want to share."
          : "Could not share or copy. Select the answer and press Command-C.";
      })();
    });

    const key = ratingKey(turn.question, turn.answer);
    const good = actionButton("up", "Good answer", () => void rate("up"));
    const bad = actionButton("down", "Bad answer", () => void rate("down"));
    const show = (r: Rating | undefined): void => {
      good.setAttribute("aria-pressed", String(r === "up"));
      bad.setAttribute("aria-pressed", String(r === "down"));
    };
    show(undefined);
    void ratings().then((all) => show(all[key]));
    async function rate(r: Rating): Promise<void> {
      const all = await ratings();
      const next = all[key] === r ? null : r;
      if (next) all[key] = next;
      else delete all[key];
      show(next ?? undefined);
      status.textContent = next ? "Marked as a " + (next === "up" ? "good" : "bad") + " answer. This stays on this device." : "Rating removed.";
      if (storage) await saveRating(storage, key, next).catch(() => undefined);
    }

    const branch = actionButton("branch", "Branch from this answer", () => void branchFrom(bubble));
    row.append(copy, share, good, bad, branch);

    if (sources.length) {
      const listId = "sources-" + Math.random().toString(36).slice(2, 10);
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "sources-toggle";
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-controls", listId);
      const stack = document.createElement("span");
      stack.className = "site-stack";
      const seen = new Set<string>();
      for (const s of sources) {
        const name = siteName(s.url);
        if (seen.has(name) || seen.size >= 3) continue;
        seen.add(name);
        stack.appendChild(siteIcon(document, s.url));
      }
      toggle.append(stack, sources.length === 1 ? "1 source" : sources.length + " sources");
      const list = document.createElement("ol");
      list.id = listId;
      list.className = "source-list";
      list.setAttribute("aria-label", "Sources");
      list.hidden = true;
      for (const s of sources) {
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = s.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        const site = document.createElement("span");
        site.className = "source-site";
        site.textContent = siteName(s.url);
        const title = document.createElement("span");
        title.className = "source-title";
        title.textContent = s.title || s.url;
        a.append(siteIcon(document, s.url), site, title);
        li.appendChild(a);
        list.appendChild(li);
      }
      toggle.addEventListener("click", () => {
        list.hidden = !list.hidden;
        toggle.setAttribute("aria-expanded", String(!list.hidden));
        if (!list.hidden) list.scrollIntoView({ block: "nearest" });
      });
      row.appendChild(toggle);
      const wrap = document.createElement("div");
      wrap.className = "answer-foot";
      wrap.append(row, list);
      return wrap;
    }
    return row;
  }

  /**
   * Branch: a new chat holding this conversation up to and including this
   * answer, so the next question continues from here. Later messages stay in
   * the old chat's saved history and leave the view.
   */
  async function branchFrom(bubble: HTMLElement): Promise<void> {
    if (activeChat || task || couponRun) {
      status.textContent = "Wait until Scout finishes, then branch.";
      return;
    }
    const i = turns.findIndex((t) => t.bubble === bubble);
    const target = turns[i]?.entry;
    if (!target) return;
    let entries = turns.slice(0, i + 1).map((t) => t.entry);
    // Saved history also has Scout mode runs from this session; use it when it has this answer.
    if (storage && conv) {
      const stored = await loadConversation(storage, settings.retention, Date.now(), conv).catch(() => []);
      const j = stored.map((e) => (!e.kind || e.kind === "chat") && e.question === target.question && e.answer === target.answer).lastIndexOf(true);
      if (j >= 0) entries = stored.slice(0, j + 1);
    }
    clearThread();
    if (storage) {
      conv = await startNewConversation(storage, tab.id, Date.now(), tab.incognito).catch(() => conv);
      // One write for the whole branch.
      await appendHistory(
        storage,
        settings.retention,
        entries.map((e) => ({
          ...e,
          conv,
          ...(e.sources ? { sources: e.sources.map((s) => ({ url: savedUrl(s.url), ...(s.title ? { title: s.title } : {}), ...(s.kind ? { kind: s.kind } : {}) })) } : {}),
        })),
      ).catch(() => undefined);
    }
    showEntries(entries);
    updateEmpty();
    status.textContent = "Branched into a new chat from that answer. Ask your next question to continue from there.";
    trace("conversation:branch " + entries.length);
    scrollToEnd();
  }

  const sourceCard = document.createElement("div");
  sourceCard.id = "source-card";
  sourceCard.hidden = true;
  document.body.appendChild(sourceCard);
  let cardFor: HTMLElement | null = null;
  let cardTimer = 0;

  function showSourceCard(chip: HTMLElement): void {
    const src = chipSources.get(chip);
    if (!src) return;
    clearTimeout(cardTimer);
    if (cardFor !== chip) {
      cardFor?.removeAttribute("aria-describedby");
      fillSourceCard(document, sourceCard, src);
    }
    cardFor = chip;
    chip.setAttribute("aria-describedby", sourceCard.id);
    sourceCard.hidden = false;
    const r = chip.getBoundingClientRect();
    const w = sourceCard.offsetWidth;
    const h = sourceCard.offsetHeight;
    const left = Math.max(8, Math.min(r.left, innerWidth - w - 8));
    const top = r.bottom + 6 + h <= innerHeight - 8 ? r.bottom + 6 : Math.max(8, r.top - h - 6);
    sourceCard.style.left = left + "px";
    sourceCard.style.top = top + "px";
  }

  function hideSourceCard(): void {
    clearTimeout(cardTimer);
    sourceCard.hidden = true;
    cardFor?.removeAttribute("aria-describedby");
    cardFor = null;
  }

  const chipOf = (t: EventTarget | null): HTMLElement | null => (t instanceof Element ? t.closest<HTMLElement>("a.cite") : null);
  log.addEventListener("pointerover", (e) => {
    const chip = chipOf(e.target);
    if (!chip || e.pointerType !== "mouse") return;
    clearTimeout(cardTimer);
    cardTimer = window.setTimeout(() => showSourceCard(chip), 120);
  });
  log.addEventListener("pointerout", (e) => {
    if (!chipOf(e.target) || e.pointerType !== "mouse") return;
    clearTimeout(cardTimer);
    cardTimer = window.setTimeout(hideSourceCard, 250);
  });
  sourceCard.addEventListener("pointerenter", () => clearTimeout(cardTimer));
  sourceCard.addEventListener("pointerleave", () => {
    cardTimer = window.setTimeout(hideSourceCard, 250);
  });
  log.addEventListener("focusin", (e) => {
    const chip = chipOf(e.target);
    if (chip) showSourceCard(chip);
  });
  log.addEventListener("focusout", (e) => {
    if (chipOf(e.target) && !(e.relatedTarget instanceof Node && sourceCard.contains(e.relatedTarget))) hideSourceCard();
  });
  // Touch has no hover: the first tap shows the card (its title opens the page).
  log.addEventListener("click", (e) => {
    const chip = chipOf(e.target);
    if (!chip || !matchMedia("(pointer: coarse)").matches || (cardFor === chip && !sourceCard.hidden)) return;
    e.preventDefault();
    showSourceCard(chip);
  });
  document.addEventListener("pointerdown", (e) => {
    if (!sourceCard.hidden && !(e.target instanceof Node && sourceCard.contains(e.target)) && !chipOf(e.target)) hideSourceCard();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !sourceCard.hidden) hideSourceCard();
  });
  thread.addEventListener("scroll", () => {
    if (!sourceCard.hidden) hideSourceCard();
  });

  function addMessage(kind: "user" | "assistant" | "error", text: string, opts: { mode?: string; sources?: Source[] } = {}): HTMLElement {
    const node = document.createElement("div");
    node.className = "msg " + kind;
    if (kind === "assistant") renderMarkdown(document, node, text, { sources: opts.sources ?? [] });
    else if (kind === "user" && opts.mode) {
      const label = document.createElement("span");
      label.className = "mode";
      label.textContent = opts.mode;
      node.append(label, document.createTextNode(text));
    } else if (kind === "error" && __SCOUT_DEBUG__) {
      // Own element, so the message reads on its own next to the copy button.
      const span = document.createElement("span");
      span.textContent = text;
      node.appendChild(span);
    } else node.textContent = text;
    if (kind === "error") {
      current.error(text);
      if (__SCOUT_DEBUG__) {
        const copy = document.createElement("button");
        copy.type = "button";
        copy.className = "diag-copy";
        copy.textContent = "Copy diagnostics";
        copy.addEventListener("click", () => void copyDiagnostics(copy, status));
        node.appendChild(copy);
      }
    }
    log.appendChild(node);
    updateEmpty();
    scrollToEnd();
    return node;
  }

  function updateEmpty(): void {
    const busyCards = !!task || !!couponRun || !confirmBox.hidden;
    empty.hidden = !(session || connecting) || log.childElementCount > 0 || busyCards;
    // On iPhone the starters live in the docked composer (src/panel/dock.ts).
    document.documentElement.toggleAttribute("data-chat-empty", !empty.hidden);
    siteSuggestions.hidden = empty.hidden || !siteSuggestions.childElementCount;
  }

  async function restoreConversation(): Promise<void> {
    if (!storage || !conv) return;
    const entries = await loadConversation(storage, settings.retention, Date.now(), conv).catch(() => []);
    showEntries(entries);
    if (entries.length) trace("conversation:restored " + entries.length);
    // Again after layout and images settle, so the newest message is in view.
    requestAnimationFrame(scrollToEnd);
    window.addEventListener("load", scrollToEnd, { once: true });
  }

  /** Shows saved entries as the thread and sets the model's context from them. */
  function showEntries(entries: HistoryEntry[]): void {
    history.length = 0;
    for (const e of entries) {
      const mode = e.kind === "agent" ? "Scout mode" : e.kind === "coupons" ? "Find coupons" : undefined;
      const isSummary = e.question === SUMMARIZE_QUESTION || LEGACY_SUMMARIZE_QUESTIONS.includes(e.question);
      addMessage("user", isSummary ? "Summarize page" : e.question, mode ? { mode } : {});
      const chat = !e.kind || e.kind === "chat";
      const answer = addMessage("assistant", e.answer, chat ? { sources: e.sources ?? [] } : {});
      if (chat) {
        history.push({ role: "user", content: e.question }, { role: "assistant", content: e.answer });
        answer.appendChild(answerActions(answer, e));
      }
      turns.push(chat ? { bubble: answer, entry: e } : { entry: e });
    }
    history.splice(0, Math.max(0, history.length - CONTEXT_TURNS * 2));
    const lastChat = [...entries].reverse().find((e) => !e.kind || e.kind === "chat");
    lastScope = lastChat ? ((lastChat.sources ?? []).some((x) => x.kind === "page") ? "page" : "general") : undefined;
  }

  function clearThread(): void {
    store.clear();
    views.clear();
    turns.length = 0;
    hideSourceCard();
    log.replaceChildren();
    confirmBox.hidden = true;
    history.length = 0;
    lastScope = undefined;
    updateEmpty();
  }

  // Chat history cleared from another Scout window (the Mac page or another
  // window's panel): this thread goes too, unless an answer or run is still going.
  browser.storage?.onChanged?.addListener((changes, area) => {
    const change = changes[HISTORY_KEY];
    const emptied = change && (change.newValue === undefined || (Array.isArray(change.newValue) && !change.newValue.length));
    if (area !== "local" || !emptied) return;
    if (activeChat || task || couponRun || !turns.length) return;
    clearThread();
  });

  // ---------- Session (provider + key) ----------
  let fallbackNotice: HTMLElement | null = null;
  const sessionReady = async (): Promise<void> => {
    if (!session && connecting) await connecting;
  };

  // record=false after Delete all data, so no new diagnostics land in the
  // storage that was just cleared.
  async function connect(record = true): Promise<void> {
    if (record) startRun("startup", { provider: settings.provider, model: settings.model });
    else current = disabledRun;
    const keys = await (firstKeys ?? readKeys());
    if (firstKeys && __SCOUT_DEBUG__) trace("open:keys " + Math.round(performance.now()) + " ms");
    firstKeys = null;
    const found = findKey(settings, keys);
    keyed = savedProviders(keys);
    // Remembered for the next open, so it can show the question box at once.
    // Only after a successful read: an unreadable Keychain says nothing.
    const hint: KeyHint = { anthropic: keyed.has("anthropic"), openai: keyed.has("openai") };
    if (record && storage && !keys.anthropic.error && !keys.openai.error && !sameHint(hint, keyHint)) {
      keyHint = hint;
      void storage.set({ [KEY_HINT_KEY]: hint }).catch(() => undefined);
    }
    fallbackNotice?.remove();
    fallbackNotice = null;
    if (!found) {
      session = null;
      status.textContent = "No API key saved.";
      current.error("No API key saved.");
      current.finish("no_key", "No API key saved.");
      noKey.hidden = false;
      composer.hidden = true;
      updateEmpty();
      return;
    }
    const effort = effortForId(found.settings.provider, found.settings.model, found.settings.effort, knownModels[found.settings.provider]);
    // Debug builds: Find coupons also uses the local mock server when it is on (the worker does the same for tasks).
    let mockUrl: string | null = null;
    if (__SCOUT_DEBUG__ && storage && found.settings.provider === "anthropic") {
      mockUrl = mockServerUrl((await storage.get(DEV_MOCK_KEY).catch(() => ({}) as Record<string, unknown>))[DEV_MOCK_KEY]);
    }
    session = {
      settings: found.settings,
      provider: createProvider(found.settings.provider, { apiKey: found.apiKey, fetch: providerFetch, ...(mockUrl ? { baseUrl: mockUrl } : {}) }),
      ...(mockUrl ? { mock: true } : {}),
      ...(effort ? { effort } : {}),
      ...(found.fellBackFrom ? { fellBackFrom: found.fellBackFrom } : {}),
    };
    noKey.hidden = true;
    composer.hidden = false;
    // Owner, 2026-10-17: the pill shows the short model name only; the effort is in the Models sheet.
    const pill = prettyModel(session.settings.model);
    modelPillText.textContent = pill;
    // Accessible name starts with the visible text (WCAG 2.5.3 Label in Name).
    modelPill.setAttribute("aria-label", pill + (effort ? ", " + EFFORT_LABEL[effort] + " effort" : "") + ", change model or effort");
    // Nothing shown when ready; the line under the conversation is for each run's cost.
    status.textContent = "";
    current.finish(
      found.fellBackFrom ? "ready_fallback" : "ready",
      "Ready. Using " + session.settings.provider + " " + session.settings.model + (effort ? ", " + EFFORT_LABEL[effort].toLowerCase() + " effort" : "") + ".",
    );
    if (found.fellBackFrom) {
      fallbackNotice = addMessage(
        "error",
        "No " + PROVIDER_NAME[found.fellBackFrom] + " key is saved, so Scout is using your " +
          PROVIDER_NAME[session.settings.provider] + " key. Add your " + PROVIDER_NAME[found.fellBackFrom] + " key in Settings to use it.",
      );
    }
    updateEmpty();
  }

  // ---------- Composer ----------
  const mode = (): Mode => (modeInputs.find((i) => i.checked)?.value === "scout" ? "scout" : "chat");

  function setMode(next: Mode): void {
    for (const i of modeInputs) i.checked = i.value === next;
    syncSegmented(modeInputs);
    modeChip.hidden = next !== "scout";
    question.placeholder = next === "scout" ? "Tell Scout what to do" : ASK_HINT;
    send.setAttribute("aria-label", next === "scout" ? "Start task" : "Send");
  }
  for (const i of modeInputs) i.addEventListener("change", () => setMode(mode()));
  el("mode-clear").addEventListener("click", () => {
    setMode("chat");
    question.focus();
  });

  const autosize = (): void => {
    question.style.height = "auto";
    question.style.height = Math.min(question.scrollHeight, 140) + "px";
  };
  question.addEventListener("input", autosize);

  // ---------- Mic (owner, 2026-10-17; src/panel/voice.ts) ----------
  // Speech to text into the box, nothing more: the user sends it with Send.
  const phone = matchMedia("(pointer: coarse)").matches;
  const speechLang = navigator.language || "en-US";
  const panelVoice = new Listener(recognitionCtor(window), speechLang);
  // Safari on iPhone won't let the panel itself hear anything, so Scout falls
  // back to listening from the web page (src/panel/page-listen.ts). Once the
  // panel has refused, later taps go straight to the page (owner, 2026-10-20).
  const pageTabId = !STANDALONE && tab.id !== undefined && /^https?:/.test(tab.url ?? "") ? tab.id : undefined;
  const pageVoice =
    pageTabId !== undefined
      ? new PageListener(async (func, args) => {
          const [res] = await browser.scripting.executeScript({ target: { tabId: pageTabId }, func: func as unknown as (...a: never[]) => unknown, args });
          return res?.result as Awaited<ReturnType<typeof func>> | undefined;
        }, speechLang)
      : null;
  let dictation: Listener | PageListener = panelVoice;
  let dictating = false;
  const micMemory = lookCache;
  function setDictating(on: boolean): void {
    dictating = on;
    mic.setAttribute("aria-pressed", String(on));
    mic.setAttribute("aria-label", on ? "Stop dictating" : "Dictate");
    mic.title = on ? "Stop dictating" : "Dictate";
  }
  function stopDictation(): void {
    if (dictating) dictation.stop();
  }
  function listen(via: Listener | PageListener, typed: string): void {
    dictation = via;
    trace(via === pageVoice ? "voice:page" : "voice:dictate");
    const handlers = {
      onText: (heard: string) => {
        question.value = joinDictation(typed, heard);
        autosize();
      },
      onEnd: (error?: string) => {
        if (via === panelVoice) {
          if (micBlocked(error)) rememberMic(micMemory, navigator.userAgent, true);
          else if (question.value !== typed) rememberMic(micMemory, navigator.userAgent, false);
          // The panel was refused before anything was heard: try the page, mic still on.
          if (micBlocked(error) && pageVoice && question.value === typed) {
            trace("voice:panel-refused " + error);
            listen(pageVoice, typed);
            return;
          }
        }
        setDictating(false);
        if (error && !(error === "no-speech" && question.value !== typed)) {
          status.textContent = micErrorText(error, phone);
          trace("voice:error " + error);
        } else if (status.textContent === "Listening…") status.textContent = "";
        question.focus();
      },
    };
    if (via instanceof Listener) via.start(handlers, { continuous: true });
    else via.start(handlers);
  }
  // iPhone and iPad (owner choice 2026-10-20): Safari gives extensions no
  // microphone there and nothing can switch the keyboard's mic on, so Scout's
  // mic is hidden; the keyboard's own mic works in the box.
  mic.hidden = phone;
  mic.addEventListener("click", () => {
    if (dictating) {
      dictation.stop();
      return;
    }
    setDictating(true);
    status.textContent = "Listening…";
    listen(pageVoice && micBlockedHere(micMemory, navigator.userAgent) ? pageVoice : panelVoice, question.value);
  });


  function closePlus(focusButton = false): void {
    plusMenu.hidden = true;
    plus.setAttribute("aria-expanded", "false");
    if (focusButton) plus.focus();
  }
  plus.addEventListener("click", () => {
    closeModelMenu();
    const open = plusMenu.hidden;
    plusMenu.hidden = !open;
    plus.setAttribute("aria-expanded", String(open));
    if (open) plusMenu.querySelector<HTMLButtonElement>("button")?.focus();
  });
  plusMenu.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closePlus(true);
    }
  });
  document.addEventListener("click", (e) => {
    const t = e.target as Node;
    if (!plusMenu.hidden && !plusMenu.contains(t) && !plus.contains(t)) closePlus();
  });

  // ---------- Models sheet: pick the model and effort in place ----------
  // Owner design 2026-10-17: a "Models" sheet over the panel listing every
  // model of each provider with a saved key, then the effort levels. Choosing
  // one saves it and closes the sheet; Settings keeps the full controls
  // (custom model ID, refresh).
  const CHECK_ICON = '<svg class="i check" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>';
  // Monochrome provider marks, drawn here (no vendor artwork is bundled).
  const PROVIDER_GLYPH: Record<Provider, string> = {
    anthropic:
      '<svg class="i glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4M8.5 3.6l7 16.8M15.5 3.6l-7 16.8M3.6 8.5l16.8 7M3.6 15.5l16.8-7"/></svg>',
    openai:
      '<svg class="i glyph" viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="12" rx="9" ry="4"/><ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(120 12 12)"/></svg>',
  };
  const menuItems = (): HTMLButtonElement[] => Array.from(modelMenu.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
  /** Providers with a key in the Keychain, read on each connect. */
  let keyed = new Set<Provider>();

  function menuGroup(group: HTMLElement, items: Array<{ key: string; label: string; glyph?: string; checked: boolean; pick: () => void }>): void {
    group.replaceChildren(
      ...items.map((item) => {
        const b = document.createElement("button");
        b.type = "button";
        b.tabIndex = item.checked ? 0 : -1;
        b.dataset.key = item.key;
        b.setAttribute("role", "radio");
        b.setAttribute("aria-checked", String(item.checked));
        if (item.glyph) b.insertAdjacentHTML("beforeend", item.glyph);
        const text = document.createElement("span");
        text.textContent = item.label;
        b.append(text);
        b.insertAdjacentHTML("beforeend", CHECK_ICON);
        b.addEventListener("click", item.pick);
        return b;
      }),
    );
  }

  // The session's provider and model: after a fallback, those of the key in use.
  const activeSettings = (): Settings => session?.settings ?? settings;
  /** Providers the sheet lists: those with a saved key, and always the one in use. */
  const menuProviders = (): Provider[] => (["anthropic", "openai"] as const).filter((p) => keyed.has(p) || p === activeSettings().provider);

  function renderModelMenu(): void {
    const cur = activeSettings();
    const providers = menuProviders();
    const list = withModel(knownModels[cur.provider], cur.provider, cur.model);
    const levels = list.find((m) => m.id === cur.model)?.efforts ?? [];
    const effort = levels.includes(cur.effort as Effort) ? cur.effort : "default";
    const focused = modelMenu.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.key : undefined;
    menuGroup(
      el("model-menu-models"),
      providers.flatMap((p) =>
        (p === cur.provider ? list : knownModels[p]).map((m) => ({
          key: "model:" + p + ":" + m.id,
          label: m.name,
          glyph: PROVIDER_GLYPH[p],
          checked: p === cur.provider && m.id === cur.model,
          pick: () => void pickModel(p, m.id),
        })),
      ),
    );
    menuGroup(
      el("model-menu-efforts"),
      (["default", ...levels] as EffortSetting[]).map((v) => ({
        key: "effort:" + v,
        label: EFFORT_LABEL[v] + (v === "default" ? " (model decides)" : ""),
        checked: v === effort,
        pick: () => void pickEffort(v),
      })),
    );
    el("model-menu-effort-title").hidden = el("model-menu-efforts").hidden = levels.length === 0;
    el("model-menu-note").textContent =
      "Showing models for your " + providers.map((p) => PROVIDER_NAME[p]).join(" and ") + " API key" + (providers.length > 1 ? "s" : "") + ". Add keys in Settings.";
    if (focused) menuItems().find((b) => b.dataset.key === focused)?.focus();
  }

  // Cached list, else the provider's list (no tokens billed), as in Settings.
  // Only after the user allowed sharing with that provider.
  async function refreshMenuModels(): Promise<void> {
    await Promise.all(
      menuProviders().map(async (p) => {
        let key: string | null = null;
        try {
          key = consent.has(p) ? await keychain.getKey(p) : null;
        } catch {
          key = null;
        }
        const list = await loadModelList(storage, p, key, providerFetch, Date.now());
        const changed = JSON.stringify(list.models) !== JSON.stringify(knownModels[p]);
        rememberModels(p, list.models);
        if (changed && !modelMenu.hidden) renderModelMenu();
      }),
    );
  }

  function openModelMenu(focus: "checked" | "last" = "checked"): void {
    closePlus();
    renderModelMenu();
    modelMenu.hidden = false;
    modelPill.setAttribute("aria-expanded", "true");
    const items = menuItems();
    (focus === "last" ? items[items.length - 1] : items.find((b) => b.getAttribute("aria-checked") === "true"))?.focus();
    void refreshMenuModels();
  }
  function closeModelMenu(focusPill = false): void {
    modelMenu.hidden = true;
    modelPill.setAttribute("aria-expanded", "false");
    if (focusPill) modelPill.focus();
  }

  /** Saves a model from the sheet; an effort the new model does not support goes back to Default. */
  async function pickModel(provider: Provider, id: string): Promise<void> {
    const cur = activeSettings();
    const levels = withModel(knownModels[provider], provider, id).find((m) => m.id === id)?.efforts ?? [];
    closeModelMenu(true);
    await persist({ ...settings, provider, model: id, effort: levels.includes(cur.effort as Effort) ? cur.effort : "default" });
  }
  async function pickEffort(effort: EffortSetting): Promise<void> {
    const cur = activeSettings();
    closeModelMenu(true);
    await persist({ ...settings, provider: cur.provider, model: cur.model, effort });
  }

  modelPill.addEventListener("click", () => (modelMenu.hidden ? openModelMenu() : closeModelMenu(true)));
  modelPill.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      openModelMenu(e.key === "ArrowUp" ? "last" : "checked");
    }
  });
  el("model-menu-close").addEventListener("click", () => closeModelMenu(true));
  modelMenu.addEventListener("keydown", (e) => {
    const items = menuItems();
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const go = (i: number): void => {
      e.preventDefault();
      items[(i + items.length) % items.length]?.focus();
    };
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(items.length - 1);
    else if (e.key === "Escape") {
      e.preventDefault();
      closeModelMenu(true);
    } else if (e.key === "Tab") {
      // Modal: focus moves between the close button and the checked rows.
      const stops = [el<HTMLButtonElement>("model-menu-close"), ...items.filter((b) => b.tabIndex === 0)];
      const i = stops.indexOf(document.activeElement as HTMLButtonElement);
      e.preventDefault();
      stops[(i + (e.shiftKey ? stops.length - 1 : 1)) % stops.length]?.focus();
    }
  });

  // Owner, 2026-10-17: one button next to the model picker starts and stops
  // everything. It is the blue Send arrow, and the blue Stop square while an
  // answer streams, a Scout mode task runs, or Find coupons runs. The chat
  // itself never shows its own Stop.
  function syncComposer(): void {
    const running = !!activeChat || !!task || !!couponRun;
    send.hidden = running;
    stop.hidden = !running;
  }

  function setBusy(busy: boolean): void {
    syncComposer();
    plus.disabled = modelPill.disabled = mic.disabled = busy;
    if (busy) stopDictation();
    if (busy) closeModelMenu();
    question.disabled = busy;
    for (const i of modeInputs) i.disabled = busy;
    for (const c of empty.querySelectorAll<HTMLButtonElement>("button")) c.disabled = busy;
    for (const c of siteSuggestions.querySelectorAll<HTMLButtonElement>("button")) c.disabled = busy;
    if (busy) stop.focus();
    else if (!matchMedia("(pointer: coarse)").matches) question.focus();
  }

  // ---------- Attached tabs (Part 2, spec 6): only tabs the user picks ----------
  // Picked by typing @, shown as chips above the field,
  // and sent with every question until removed. Nothing else is read.
  const attachedBox = el("attached");
  const mentionList = el<HTMLUListElement>("mention-list");

  function renderAttached(): void {
    attachedBox.replaceChildren(
      ...[...attached.values()].map((t) => {
        const chip = document.createElement("span");
        chip.className = "chip";
        const name = document.createElement("span");
        name.textContent = t.title;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.setAttribute("aria-label", "Remove " + t.title);
        remove.insertAdjacentHTML("beforeend", '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>');
        remove.addEventListener("click", () => {
          detachTab(t.id);
          question.focus();
        });
        chip.append(name, remove);
        return chip;
      }),
    );
    attachedBox.hidden = attached.size === 0;
  }
  function attachTab(t: TabInfo): void {
    if (!attached.has(t.id) && attached.size >= MAX_EXTRA_TABS) {
      status.textContent = "You can attach up to " + MAX_EXTRA_TABS + " tabs. Remove one first.";
    } else {
      attached.set(t.id, t);
      trace("tabs:attached");
    }
    renderAttached();
  }
  function detachTab(id: number): void {
    attached.delete(id);
    renderAttached();
  }

  async function loadTabs(): Promise<void> {
    others = (await listTabs()).filter((t) => !t.active);
    for (const id of [...attached.keys()]) if (!others.some((t) => t.id === id)) attached.delete(id);
    renderAttached();
  }

  // Typing @ suggests tabs; choosing one attaches it and removes the @word.
  let mention: { start: number; items: TabInfo[]; index: number } | null = null;
  function closeMentions(): void {
    mention = null;
    mentionList.hidden = true;
    mentionList.replaceChildren();
    question.removeAttribute("aria-activedescendant");
  }
  function markMention(): void {
    if (!mention) return;
    mentionList.querySelectorAll("li").forEach((li, i) => li.setAttribute("aria-selected", String(i === mention!.index)));
    question.setAttribute("aria-activedescendant", "mention-" + mention.index);
  }
  function updateMentions(): void {
    const at = mode() === "chat" ? mentionAt(question.value, question.selectionStart ?? question.value.length) : null;
    const items = at ? suggestTabs(at.query, others, new Set(attached.keys())) : [];
    if (!at || !items.length) return closeMentions();
    mention = { start: at.start, items, index: 0 };
    mentionList.replaceChildren(
      ...items.map((t, i) => {
        const li = document.createElement("li");
        li.id = "mention-" + i;
        li.setAttribute("role", "option");
        li.append(t.title);
        const h = hostOf(t.url);
        if (h) {
          const span = document.createElement("span");
          span.className = "host";
          span.textContent = h;
          li.appendChild(span);
        }
        // mousedown, so the field keeps focus.
        li.addEventListener("mousedown", (e) => {
          e.preventDefault();
          pickMention(i);
        });
        return li;
      }),
    );
    mentionList.hidden = false;
    markMention();
  }
  function pickMention(i: number): void {
    const t = mention?.items[i];
    if (!mention || !t) return;
    attachTab(t);
    const next = dropMention(question.value, mention.start, question.selectionStart ?? question.value.length);
    question.value = next.text;
    question.setSelectionRange(next.caret, next.caret);
    closeMentions();
    autosize();
    question.focus();
  }
  /** Arrow keys, Enter, Tab and Escape while suggestions show. True when handled. */
  function mentionKey(e: KeyboardEvent): boolean {
    if (!mention) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = mention.items.length;
      mention.index = (mention.index + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
      markMention();
      return true;
    }
    if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
      e.preventDefault();
      pickMention(mention.index);
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      closeMentions();
      return true;
    }
    return false;
  }
  question.addEventListener("input", updateMentions);
  question.addEventListener("blur", () => setTimeout(closeMentions, 0));

  // ---------- Consent: asked once per provider before anything is sent ----------
  // App Store Review Guideline 5.1.2(i). A modal dialog: focus starts on its
  // heading so neither button is preselected; Escape is Not now; focus returns
  // to the control that opened it.
  const consentDialog = el<HTMLDialogElement>("consent");
  const consentTitle = el("consent-title");
  const consentAllow = el<HTMLButtonElement>("consent-allow");
  const consentDeny = el<HTMLButtonElement>("consent-deny");
  let consentPending: Promise<boolean> | null = null;

  function askConsent(p: Provider): Promise<boolean> {
    if (consentPending) return consentPending;
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const t = consentText(p);
    consentTitle.textContent = t.title;
    el("consent-intro").textContent = t.intro;
    el("consent-items").replaceChildren(
      ...t.items.map((item) => {
        const li = document.createElement("li");
        li.textContent = item;
        return li;
      }),
    );
    const policy = el<HTMLAnchorElement>("consent-policy");
    policy.href = t.policyUrl;
    policy.textContent = t.policyLabel;
    const terms = el<HTMLAnchorElement>("consent-terms");
    terms.href = t.termsUrl;
    terms.textContent = t.termsLabel;
    el("consent-after").textContent = t.after;
    consentDialog.showModal();
    consentTitle.focus();
    trace("consent:asked " + p);
    consentPending = new Promise((resolve) => {
      const done = (ok: boolean): void => {
        if (!consentPending) return;
        consentPending = null;
        consentAllow.removeEventListener("click", onAllow);
        consentDeny.removeEventListener("click", onDeny);
        consentDialog.removeEventListener("cancel", onCancel);
        consentDialog.removeEventListener("close", onClose);
        if (consentDialog.open) consentDialog.close();
        trace("consent:" + (ok ? "allowed " : "declined ") + p);
        // The opener, unless it was hidden meanwhile (the + menu closes first).
        const back = returnTo && returnTo.isConnected && returnTo.offsetParent !== null ? returnTo : null;
        (back ?? (chatView.hidden ? keySave : matchMedia("(pointer: coarse)").matches ? send : question)).focus();
        resolve(ok);
      };
      const onAllow = (): void => done(true);
      const onDeny = (): void => done(false);
      const onCancel = (e: Event): void => {
        e.preventDefault();
        done(false);
      };
      const onClose = (): void => done(false);
      consentAllow.addEventListener("click", onAllow);
      consentDeny.addEventListener("click", onDeny);
      consentDialog.addEventListener("cancel", onCancel);
      consentDialog.addEventListener("close", onClose);
    });
    return consentPending;
  }

  /**
   * Asks for `p` and returns whether it may receive data. Callers check
   * `consent.has` first, so an allowed request stays synchronous and the click
   * keeps its user gesture for the site-access prompt that may follow.
   */
  async function allowSharing(p: Provider): Promise<boolean> {
    const ok = await ensureConsent(consent, p, askConsent, Date.now());
    renderConsent();
    if (!ok) status.textContent = "Nothing was sent. Scout asks before it shares anything with " + PROVIDER_NAME[p] + ".";
    return ok;
  }

  // ---------- Chat (Part 2): context, the Scout server, tools ----------
  // The panel reads context through the worker (gate first, 8 s per page),
  // starts the answer on the Scout server, and applies its numbered events to
  // the store. Tool requests run through the worker's tool host, after asking
  // the user where the tool needs it, and the result goes back with the same
  // request_id so the server continues the same answer.
  const CONTINUE_PROMPT = "Continue your previous answer from exactly where it stopped. Do not repeat anything you already wrote.";

  interface MessageView {
    bubble: HTMLElement;
    /** As saved in history: the question, or the original one for a continuation. */
    question: string;
    model: string;
    /** Tabs this answer may read: the current tab when shared, attached tabs, tabs it opened. */
    scope: number[];
    /** Numbered sources [n]: the pages sent with the question (after a Continue, the earlier part's sources). */
    sources: Source[];
    shared: Array<{ title: string; host: string; status: string }>;
    /** Text shown before this answer continued (Continue after a drop). */
    prefix: string;
    handled: Set<string>;
    queue: Promise<void>;
    closed: boolean;
    /** Characters of prefix + text on screen; the reveal types toward the full text. */
    shown: number;
    /** The pending animation frame of the reveal, if any. */
    typing: number | null;
    typedAt: number;
    done: () => void;
    finished: Promise<void>;
  }
  const views = new Map<string, MessageView>();

  function newView(id: string, bubble: HTMLElement, q: string, model: string, prefix = ""): MessageView {
    let done: () => void = () => undefined;
    const finished = new Promise<void>((resolve) => (done = resolve));
    const v: MessageView = { bubble, question: q, model, scope: [], sources: [], shared: [], prefix, handled: new Set(), queue: Promise.resolve(), closed: false, shown: prefix.length, typing: null, typedAt: 0, done, finished };
    store.create(id);
    views.set(id, v);
    return v;
  }

  function renderView(id: string): void {
    const v = views.get(id);
    const m = store.get(id);
    if (!v || !m) return;
    const text = v.prefix + m.text;
    // A stopped or failed answer shows what arrived at once.
    if (m.stopped || m.status === "error") v.shown = text.length;
    const cut = cutAt(text, v.shown);
    if (cut < text.length && v.typing === null) {
      v.typedAt = performance.now();
      v.typing = requestAnimationFrame((t) => typeOn(id, t));
    }
    const visible = text.slice(0, cut);
    if (visible) renderMarkdown(document, v.bubble, visible, { sources: allSources(v, m) });
    else if (m.status === "error" || m.status === "complete") v.bubble.textContent = "";
    else v.bubble.innerHTML = '<span class="thinking">' + PULSE + "<span>Thinking…</span></span>";
    if (v.closed && m.status === "complete" && !m.stopped && text && cut >= text.length) {
      v.bubble.appendChild(answerActions(v.bubble, { question: v.question, answer: text, sources: allSources(v, m) }));
    }
    followEnd();
  }

  /** One frame of the steady reveal of a streamed answer. */
  function typeOn(id: string, now: number): void {
    const v = views.get(id);
    const m = store.get(id);
    if (!v || !m) return;
    v.typing = null;
    const full = (v.prefix + m.text).length;
    v.shown = nextShown(v.shown, full, now - v.typedAt);
    v.typedAt = now;
    renderView(id);
  }

  /** The start of a shared page's text, for its source card. Shown only, never saved. */
  function snippetOf(text: string): string {
    const t = text.replace(/\s+/g, " ").trim();
    return t.length > 180 ? t.slice(0, 177).replace(/\s+\S*$/, "") + "…" : t;
  }

  /** The pages sent with the question, then the web pages the provider cited. */
  function allSources(v: MessageView, m: StoredMessage): Source[] {
    return [...v.sources, ...m.citations.map((c): Source => ({ ...c, kind: "web" }))];
  }

  function finalize(id: string): void {
    const v = views.get(id);
    const m = store.get(id);
    if (!v || !m || v.closed || (m.status !== "complete" && m.status !== "error")) return;
    v.closed = true;
    renderView(id);
    const full = v.prefix + m.text;
    if (m.status === "complete" && !m.stopped) {
      history.push({ role: "user", content: v.question }, { role: "assistant", content: full });
      // Without snippets: they quote page text, which history never keeps.
      const sources = allSources(v, m).map(({ url, title, kind }) => ({ url, ...(title ? { title } : {}), ...(kind ? { kind } : {}) }));
      turns.push({ bubble: v.bubble, entry: { at: Date.now(), question: v.question, answer: full, kind: "chat", ...(sources.length ? { sources } : {}), ...(v.shared.length ? { shared: v.shared } : {}) } });
      history.splice(0, Math.max(0, history.length - CONTEXT_TURNS * 2));
      status.textContent = m.usage ? formatCostLine(v.model, m.usage) : "";
      current.finish("done", "Answered (" + full.length + " characters).", m.usage);
    } else if (m.status === "complete") {
      // The user pressed Stop: keep what arrived and say nothing (owner, 2026-10-17).
      if (!full) v.bubble.remove();
      status.textContent = m.usage ? formatCostLine(v.model, m.usage) : "";
      current.finish("stopped", "Stopped.", m.usage);
    } else {
      if (!full) v.bubble.remove();
      const message = m.error?.message || "Something went wrong. Try again.";
      const err = addMessage("error", message);
      // The provider stream or the worker dropped mid-answer: offer to finish it.
      if (full && (m.error?.code === "interrupted" || m.error?.code === "lost")) {
        const more = document.createElement("button");
        more.type = "button";
        more.className = "btn continue";
        more.textContent = "Continue";
        more.addEventListener("click", () => {
          err.remove();
          void ask(CONTINUE_PROMPT, { continueOf: { bubble: v.bubble, question: v.question, partial: full, shared: v.shared, sources: allSources(v, m) } });
        });
        err.appendChild(more);
      }
      status.textContent = "The request failed.";
      current.finish("error", message, m.usage);
    }
    for (const b of toolButtons) b.click();
    if (activeChat === id) {
      activeChat = null;
      setBusy(false);
    }
    v.done();
  }

  function subscribe(id: string, after: number): void {
    try {
      port?.post("chat.subscribe", { message_id: id, after_seq: after });
    } catch {
      // Not connected: the port resubscribes every open answer when it reconnects.
    }
  }

  function onWorkerEvent(env: Envelope): void {
    if (env.type === "chat.lost") {
      const id = (env.payload as { message_id: string }).message_id;
      store.lose(id, "Scout restarted before this answer finished.");
      trace("chat:lost");
      finalize(id);
      return;
    }
    if (env.type === "task.event") {
      onTaskEvent(env.payload as Record<string, unknown>);
      return;
    }
    if (env.type === "coupons.event") {
      onCouponEvent(env.payload as Record<string, unknown>);
      return;
    }
    if (env.type !== "chat.event") return;
    const w = fromWire(env.payload as Record<string, unknown>);
    if (!w || !views.has(w.message_id)) return;
    const result = store.apply(w.message_id, w.seq, w.event);
    if (result === "gap") return subscribe(w.message_id, store.get(w.message_id)?.lastSeq ?? 0);
    if (result !== "applied") return;
    const m = store.get(w.message_id)!;
    if (w.event.kind === "tool_request") {
      const v = views.get(w.message_id)!;
      const ev = w.event;
      v.queue = v.queue.then(() => runToolRequest(w.message_id, ev)).catch(() => undefined);
    }
    if (m.status === "complete" || m.status === "error") finalize(w.message_id);
    else if (w.event.kind === "text" || w.event.kind === "citation" || w.event.kind === "tool_done") renderView(w.message_id);
  }

  // ---------- Tool requests that need the user (close_tabs, screenshots) ----------
  const toolAsk = el("tool-ask");
  const toolAskTitle = el("tool-ask-title");
  const toolAskButtons = el("tool-ask-buttons");
  /** Buttons of the open question; finalize answers it with the safe choice. */
  let toolButtons: HTMLButtonElement[] = [];

  function askTool(opts: { title: string; what: string; items: string[]; choices: Array<{ label: string; value: ToolDecision; primary?: boolean; safe?: boolean }> }): Promise<ToolDecision> {
    return new Promise((resolve) => {
      toolAskTitle.textContent = opts.title;
      el("tool-ask-what").textContent = opts.what;
      el("tool-ask-list").replaceChildren(
        ...opts.items.map((t) => {
          const li = document.createElement("li");
          li.textContent = t;
          return li;
        }),
      );
      // The safe choice (Cancel, Don't allow) has focus and answers Escape.
      const safe = opts.choices.find((c) => c.safe) ?? opts.choices[opts.choices.length - 1]!;
      let answered = false;
      const onKey = (e: KeyboardEvent): void => {
        if (e.key === "Escape") {
          e.preventDefault();
          done(safe.value);
        }
      };
      const done = (value: ToolDecision): void => {
        if (answered) return;
        answered = true;
        toolAsk.hidden = true;
        toolButtons = [];
        toolAsk.removeEventListener("keydown", onKey);
        trace("tool:answer " + value);
        if (activeChat) {
          status.textContent = "Writing the answer…";
          stop.focus();
        }
        resolve(value);
      };
      toolAskButtons.replaceChildren();
      toolButtons = [];
      for (const c of opts.choices) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "btn" + (c.primary ? " primary" : "");
        b.textContent = c.label;
        b.addEventListener("click", () => done(c.value));
        toolAskButtons.appendChild(b);
        if (c === safe) toolButtons = [b];
      }
      toolAsk.addEventListener("keydown", onKey);
      toolAsk.hidden = false;
      status.textContent = "Waiting for your answer.";
      scrollToEnd();
      toolButtons[0]?.focus();
    });
  }

  async function confirmClose(input: unknown): Promise<ToolDecision> {
    const ids = Array.isArray((input as { tab_ids?: unknown } | null)?.tab_ids)
      ? ((input as { tab_ids: unknown[] }).tab_ids.filter((x) => typeof x === "number") as number[])
      : [];
    const all = await browser.tabs.query({}).catch(() => []);
    const names = ids.map((i) => {
      const t = all.find((x) => x.id === i);
      return t ? (t.title || t.url || "Tab " + i) + (t.url && hostOf(t.url) ? " (" + hostOf(t.url) + ")" : "") : "Tab " + i + " (not open)";
    });
    return askTool({
      title: ids.length === 1 ? "Close this tab?" : "Close " + ids.length + " tabs?",
      what: "Scout wants to close:",
      items: names,
      choices: [
        { label: ids.length === 1 ? "Close tab" : "Close tabs", value: "confirmed" },
        { label: "Cancel", value: "declined", safe: true },
      ],
    });
  }

  /** Asks when the site is set to ask; undefined when Settings already decides (the host enforces it). */
  async function askScreenshot(model: string): Promise<ToolDecision | undefined> {
    const now = await activeTab();
    const url = now.url ?? tab.url ?? "";
    if (screenshotDecision(url, await loadPageAccess(storage), []) !== "ask") return undefined;
    const site = hostOf(url) ?? "this page";
    const provider = activeSettings().provider;
    return askTool({
      title: "Allow a screenshot?",
      what:
        "Scout wants a screenshot of the visible part of " + site + " to answer, and would send it to " + PROVIDER_NAME[provider] +
        " (" + prettyModel(model) + "). It shows everything on screen, including anything typed into the page.",
      items: [],
      choices: [
        { label: "Allow once", value: "once" },
        { label: "Always for this site", value: "always" },
        { label: "Never for this site", value: "never" },
        { label: "Don't allow", value: "declined", safe: true },
      ],
    });
  }

  async function runToolRequest(id: string, ev: { request_id: string; name: string; input: unknown }): Promise<void> {
    const v = views.get(id);
    if (!v || v.handled.has(ev.request_id)) return;
    // A reopened panel replays events; a request the server already has is skipped.
    await new Promise((r) => setTimeout(r, 30));
    if (!store.pendingTools(id).some((t) => t.request_id === ev.request_id)) return;
    v.handled.add(ev.request_id);
    trace("tool:request " + (/^\w{1,30}$/.test(ev.name) ? ev.name : "unknown"));
    let decision: ToolDecision | undefined;
    if (ev.name === "close_tabs") decision = await confirmClose(ev.input);
    else if (ev.name === "screenshot_visible") decision = await askScreenshot(v.model);
    // The answer ended (Stop, error) or the server timed the request out while asking.
    if (store.get(id)?.status !== "streaming" || !store.pendingTools(id).some((t) => t.request_id === ev.request_id)) return;
    let result: ToolResult;
    if (ev.name === "run_task") {
      // Part 3: the Scout server asked for a task mid-answer. The user is asked
      // first; the answer continues with the task's outcome.
      const goal = typeof (ev.input as { goal?: unknown } | null)?.goal === "string" ? ((ev.input as { goal: string }).goal) : "";
      result = goal.trim()
        ? await runTaskForChat(goal)
        : { status: "schema-error", text: "run_task needs a goal.", site: hostOf(tab.url ?? "") ?? "" };
    } else
    try {
      result = await request<ToolResult>(
        toWorker,
        "tool.run",
        {
          request_id: ev.request_id,
          name: ev.name,
          input: ev.input ?? {},
          tabs: v.scope,
          ...(tab.id !== undefined ? { current_tab: tab.id } : {}),
          ...(decision ? { decision } : {}),
        },
        { timeoutMs: 30_000 },
      );
    } catch (err) {
      result = {
        status: err instanceof BridgeError && err.error === "timeout" ? "timeout" : "error",
        text: "The tool could not run.",
        site: "",
      };
    }
    if (result.opened_tab !== undefined) v.scope.push(result.opened_tab);
    if (result.status === "ok") {
      if (result.shared) v.shared.push({ ...result.shared, status: "read" });
      else if (ev.name !== "search_tabs") v.shared.push({ title: toolLabel(ev.name), host: result.site, status: "tool" });
    }
    trace("tool:" + (/^\w{1,30}$/.test(ev.name) ? ev.name : "unknown") + " " + result.status);
    renderView(id);
    await request(
      toWorker,
      "chat.tool_result",
      {
        message_id: id,
        request_id: ev.request_id,
        status: result.status,
        text: result.text,
        ...(result.image ? { image_type: result.image.mediaType, image_data: result.image.data } : {}),
        ...(result.shared ? { shared_title: result.shared.title, shared_host: result.shared.host } : {}),
      },
      { timeoutMs: 10_000 },
    ).catch(() => undefined);
  }

  interface ContextReply {
    pages: PageContext[];
    shared: SharedTab[];
    read_current: boolean;
  }

  async function ask(text: string, opts: { continueOf?: { bubble: HTMLElement; question: string; partial: string; shared: MessageView["shared"]; sources: Source[] } } = {}): Promise<void> {
    const trimmed = text.trim();
    await sessionReady();
    if (!trimmed || activeChat || couponRun || task || !session) return;
    const s = session;
    if (!consent.has(s.settings.provider) && !(await allowSharing(s.settings.provider))) return;
    const cont = opts.continueOf;
    const extra = cont ? [] : [...attached.values()];
    // Asked first: the permission prompt needs this click's user gesture.
    let granted = extra.length === 0;
    if (!granted) {
      const origins = [...new Set(extra.map((t) => new URL(t.url).origin + "/*"))];
      granted = await browser.permissions.request({ origins }).catch(() => false);
    }
    const isSummary = trimmed === SUMMARIZE_QUESTION;
    // A general question goes without the page (src/chat/intent.ts); the page
    // stays shared with the answer, so read_page can still fetch it.
    // The standalone page has no page to send; it keeps the usual prompt.
    const scope: QuestionScope = cont
      ? (lastScope ?? "page")
      : STANDALONE
        ? "page"
        : isSummary
          ? "page"
          : classifyQuestion({ question: trimmed, pageTitle: pageWords(tab.title, tab.url), attachedTabs: extra.length, ...(lastScope ? { previous: lastScope } : {}) });
    lastScope = scope;
    trace("scope:" + scope);
    startRun(isSummary ? "summarize" : "ask", { mock: s.mock === true, provider: s.settings.provider, model: s.settings.model, question: cont ? cont.question : trimmed });
    if (!port) {
      addMessage("error", "Scout's background worker is not running. Close Scout and open it again.");
      current.finish("error", "No worker port.");
      return;
    }
    trace("tabs:extra " + extra.length + (extra.length ? (granted ? " granted" : " declined") : ""));
    const id = newRequestId();
    activeChat = id;
    let bubble: HTMLElement;
    if (cont) bubble = cont.bubble;
    else {
      addMessage("user", isSummary ? "Summarize page" : trimmed);
      question.value = "";
      autosize();
      closeMentions();
      bubble = addMessage("assistant", "");
    }
    const v = newView(id, bubble, cont ? cont.question : trimmed, s.settings.model, cont ? cont.partial + (/\s$/.test(cont.partial) ? "" : " ") : "");
    renderView(id);
    status.textContent = cont ? "Finishing the answer." : STANDALONE || scope === "general" ? "Waiting for the answer." : "Reading the page and waiting for the answer.";
    setBusy(true);
    if (!storage) conv = conv || "";
    else if (!conv) conv = await conversationForTab(storage, tab.id, Date.now(), tab.incognito).catch(() => "");

    let pages: PageContext[] = [];
    if (cont) {
      v.shared = [...cont.shared];
      v.sources = [...cont.sources];
    }
    else {
      // Spec 6: the current tab when shared, plus the attached tabs. Nothing else.
      const ctx = await request<ContextReply>(
        toWorker,
        "context.read",
        { ...(tab.id !== undefined ? { current_tab: tab.id } : {}), attached: granted ? extra.map((t) => t.id) : [], include_current: !STANDALONE && scope === "page" },
        { timeoutMs: 15_000 },
      ).catch(() => null);
      pages = ctx?.pages ?? [];
      const readOk = (st: ReadStatus | undefined): boolean => st === "read" || st === "partial";
      const shared = ctx?.shared ?? [];
      const cur = shared.find((t) => t.tab_id === tab.id);
      current.page(readOk(cur?.status) ? pages[0]?.url : undefined);
      trace(scope === "general" ? "page:not needed" : readOk(cur?.status) ? "page:read ok" : "page:read failed");
      if (!STANDALONE && scope === "page" && ctx?.read_current !== false && !readOk(cur?.status)) status.textContent = "Could not read this page. Answering without it.";
      v.scope = [...(!STANDALONE && ctx?.read_current !== false && tab.id !== undefined ? [tab.id] : []), ...extra.map((t) => t.id)];
      v.sources = pages.map((p) => ({ url: p.url, title: p.title, kind: "page", snippet: snippetOf(p.text) }));
      v.shared = shared.map((t) => ({ title: attached.get(t.tab_id)?.title || t.title, host: t.host, status: t.status }));
      for (const t of extra) if (!shared.some((x) => x.tab_id === t.id)) v.shared.push({ title: t.title, host: hostOf(t.url) ?? "", status: "failed" });
      if (extra.length) trace("tabs:read " + shared.filter((t) => t.tab_id !== tab.id && readOk(t.status)).length + "/" + extra.length);
      // Named in the conversation, not only the status line, which the answer's
      // cost line overwrites. iOS Safari cannot read background tabs (seen in T018).
      const missed = extra.filter((t) => !readOk(shared.find((x) => x.tab_id === t.id)?.status));
      if (missed.length) {
        addMessage(
          "error",
          "Could not read: " + missed.map((t) => t.title).join(", ") +
            ". The answer uses only the pages listed as read. Site access may have been declined, the site may be blocked in Settings, or this browser cannot read background tabs (Safari on iPhone and iPad).",
        );
      }
      renderView(id);
    }

    trace("model:start");
    const past = history.map((h) => ({ role: h.role, content: textOf(h.content) }));
    try {
      await request(
        toWorker,
        "chat.start",
        {
          message_id: id,
          conv,
          provider: s.settings.provider,
          model: s.settings.model,
          ...(s.effort ? { effort: s.effort } : {}),
          question: trimmed,
          history: cont ? [...past, { role: "user", content: cont.question }, { role: "assistant", content: cont.partial }] : past,
          pages,
          shared: v.shared,
          ...(pageSite ? { site: pageSite } : {}),
          scope,
          ...(scope === "general" && !STANDALONE && !cont && tab.url && tab.title ? { open_page: { url: tab.url, title: tab.title } } : {}),
          ...(cont
            ? { display_question: cont.question, answer_prefix: v.prefix, prefix_sources: cont.sources.map((x) => ({ url: x.url, title: x.title ?? "" })) }
            : {}),
        },
        { timeoutMs: 10_000 },
      );
    } catch {
      store.lose(id, "Could not start the answer. Close Scout, open it again, and try again.");
      finalize(id);
      return;
    }
    subscribe(id, 0);
    await v.finished;
  }

  /** A reopened panel picks up answers still running in this conversation. */
  async function resumeActive(): Promise<void> {
    if (!conv || !port) return;
    const got = await request<{ messages: Array<{ message_id: string; question: string; last_seq: number }> }>(toWorker, "chat.active", { conv }, { timeoutMs: 3_000 }).catch(() => null);
    for (const a of got?.messages ?? []) {
      if (views.has(a.message_id) || activeChat) continue;
      addMessage("user", a.question === SUMMARIZE_QUESTION ? "Summarize page" : a.question);
      const v = newView(a.message_id, addMessage("assistant", ""), a.question, activeSettings().model);
      if (tab.id !== undefined) v.scope = [tab.id];
      renderView(a.message_id);
      activeChat = a.message_id;
      setBusy(true);
      status.textContent = "Still answering…";
      trace("conversation:resumed");
      subscribe(a.message_id, 0);
    }
  }

  // ---------- Scout mode (Part 3, spec 8): the task runs in the worker; this is its window ----------
  // The trace sits inline in the thread under the user's message (owner
  // reference 2026-10-17): a "Working 11s" line, the model's own short
  // narration, muted "Browsed" rows for each batch of actions, rejected or
  // denied actions in red. Stop is the composer's button, next to the model
  // picker; there is no Take control button (owner, 2026-10-20: Stop is enough). When the task ends the line becomes "Finished 1m 43s" with a chevron that folds
  // the trace, and the outcome follows as a normal message. The plain-language
  // action log (spec 8.5) is kept under a collapsed "Steps" row. Events arrive
  // on the port (task.event) for this tab; a reopened panel catches up with
  // task.status.
  type Entry = { text: string; status: string };
  interface TaskUi {
    id: string;
    goal: string;
    source: "panel" | "chat";
    /** The action log so far, as the worker keeps it. */
    entries: Entry[];
    promptId: string | null;
    startedAt: number;
    node: HTMLElement;
    head: HTMLButtonElement;
    headText: HTMLElement;
    body: HTMLElement;
    stepsList: HTMLOListElement;
    stepsSummary: HTMLElement;
    /** The current "Browsed" row, while consecutive actions are grouped into it. */
    group: { row: HTMLElement; label: HTMLElement; count: number } | null;
    state: string;
    timer: ReturnType<typeof setInterval> | null;
    resolve: (out: { status: string; summary: string; usage: Usage }) => void;
    finished: Promise<{ status: string; summary: string; usage: Usage }>;
  }
  let task: TaskUi | null = null;

  const CHEVRON = '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
  const PAGE_ICON = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 9h16"/></svg>';
  const WARN_ICON = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>';

  function elapsedText(ms: number): string {
    const s = Math.max(0, Math.round(ms / 1000));
    return s < 60 ? s + "s" : Math.floor(s / 60) + "m " + (s % 60) + "s";
  }

  function stateLabel(state: string): string {
    return state === "waiting" ? "Waiting for you" : "Working";
  }

  function refreshHead(): void {
    if (!task) return;
    task.headText.textContent = stateLabel(task.state) + " " + elapsedText(Date.now() - task.startedAt);
  }

  function logItem(text: string, statusOf: string): HTMLLIElement {
    const li = document.createElement("li");
    li.textContent = text;
    li.dataset.status = statusOf;
    return li;
  }

  /** Adds one entry to the trace: narration as text, actions grouped into a "Browsed" row, problems in red. */
  function renderEntry(t: TaskUi, e: Entry): void {
    t.stepsList.appendChild(logItem(e.text, e.status));
    const n = t.stepsList.childElementCount;
    t.stepsSummary.textContent = "Steps (" + n + ")";
    if (e.status === "say") {
      t.group = null;
      const p = document.createElement("p");
      p.className = "say";
      p.textContent = e.text;
      t.body.insertBefore(p, t.stepsList.parentElement);
      return;
    }
    if (e.status === "ok" || e.status === "failed") {
      if (!t.group) {
        const row = document.createElement("div");
        row.className = "step";
        row.insertAdjacentHTML("afterbegin", PAGE_ICON);
        const label = document.createElement("span");
        row.appendChild(label);
        t.body.insertBefore(row, t.stepsList.parentElement);
        t.group = { row, label, count: 0 };
      }
      t.group.count++;
      t.group.label.textContent = "Browsed" + (t.group.count > 1 ? " · " + t.group.count + " actions" : "");
      t.group.row.title = t.entries.filter((x) => x.status === "ok" || x.status === "failed").slice(-t.group.count).map((x) => x.text).join("\n");
      return;
    }
    if (e.status === "rejected" || e.status === "denied" || (e.status === "note" && e.text.startsWith("Overlay could not be shown"))) {
      t.group = null;
      const row = document.createElement("div");
      row.className = "step bad";
      row.insertAdjacentHTML("afterbegin", WARN_ICON);
      const label = document.createElement("span");
      label.textContent = e.text;
      row.appendChild(label);
      t.body.insertBefore(row, t.stepsList.parentElement);
    }
    // Other notes ("Started: …") stay in the Steps list only.
  }

  function appendTaskLog(text: string, statusOf: string): void {
    if (!task) return;
    const e = { text, status: statusOf };
    task.entries.push(e);
    renderEntry(task, e);
    followEnd();
  }

  /** Builds the inline trace under the user's message and returns it. */
  function buildTrace(entries: Entry[], state: string, startedAt: number, opts: { steps?: boolean } = {}): Omit<TaskUi, "id" | "goal" | "source" | "promptId" | "resolve" | "finished"> {
    const node = document.createElement("div");
    node.className = "trace";
    node.id = "task";
    const head = document.createElement("button");
    head.type = "button";
    head.className = "trace-head";
    // Folded by default (owner, 2026-10-17): the chevron opens the trace.
    head.setAttribute("aria-expanded", "false");
    const headText = document.createElement("span");
    head.append(headText);
    head.insertAdjacentHTML("beforeend", CHEVRON);
    const body = document.createElement("div");
    body.className = "trace-body";
    body.hidden = true;
    head.addEventListener("click", () => {
      const open = body.hidden;
      body.hidden = !open;
      head.setAttribute("aria-expanded", String(open));
    });
    const steps = document.createElement("details");
    steps.className = "steps";
    if (opts.steps === false) steps.hidden = true;
    const stepsSummary = document.createElement("summary");
    stepsSummary.textContent = "Steps (0)";
    const stepsList = document.createElement("ol");
    stepsList.setAttribute("aria-label", "Action log");
    steps.append(stepsSummary, stepsList);
    body.append(steps);
    node.append(head, body);
    log.appendChild(node);
    const t = { entries: [] as Entry[], startedAt, node, head, headText, body, stepsList, stepsSummary, group: null, state, timer: null } as Omit<TaskUi, "id" | "goal" | "source" | "promptId" | "resolve" | "finished">;
    for (const e of entries) {
      t.entries.push(e);
      renderEntry(t as TaskUi, e);
    }
    return t;
  }

  function showTrace(t: TaskUi): void {
    task = t;
    // The head moves while the task works, like a coupon run's (owner item 14).
    t.head.insertAdjacentHTML("afterbegin", PULSE);
    refreshHead();
    t.timer = setInterval(refreshHead, 1000);
    syncComposer();
    plus.disabled = modelPill.disabled = true;
    for (const i of modeInputs) i.disabled = true;
    closeModelMenu();
    status.textContent = "Scout mode is running.";
    updateEmpty();
    scrollToEnd();
  }

  /** The task ended: "Finished 1m 43s", controls gone, trace left in place (foldable). */
  function finishTrace(t: TaskUi, statusOf: string): void {
    if (t.timer) clearInterval(t.timer);
    t.timer = null;
    const word = statusOf === "done" ? "Finished" : statusOf === "stopped" ? "Stopped" : "Ended";
    t.head.querySelector(".pulse")?.remove();
    t.headText.textContent = word + " " + elapsedText(Date.now() - t.startedAt);
    hideConfirm();
    // A task asked for mid-answer (run_task) ends while the answer still streams: the composer stays busy then.
    const busy = !!activeChat;
    syncComposer();
    plus.disabled = modelPill.disabled = busy;
    for (const i of modeInputs) i.disabled = busy;
    updateEmpty();
  }

  function setTaskState(state: string): void {
    if (!task) return;
    task.state = state;
    refreshHead();
  }

  function showConfirm(p: { prompt_id: string; what: string; site: string; reason: string; preapproved: boolean; always?: boolean }): void {
    if (!task) return;
    task.promptId = p.prompt_id;
    confirmWhat.textContent = p.what + (p.site ? " on " + p.site : "");
    confirmReason.textContent = (p.reason ? p.reason + " " : "") + (p.preapproved ? "The model marked this as approved; Scout asks you anyway." : "");
    confirmAlways.hidden = p.always === false;
    confirmBox.hidden = false;
    setTaskState("waiting");
    status.textContent = "Waiting for your answer.";
    scrollToEnd();
    confirmDeny.focus();
    trace("confirm:asked");
  }

  function hideConfirm(): void {
    confirmBox.hidden = true;
    if (task) task.promptId = null;
  }

  function decide(decision: "once" | "always" | "deny"): void {
    if (!task?.promptId) return;
    const promptId = task.promptId;
    hideConfirm();
    trace("confirm:" + decision);
    setTaskState("running");
    status.textContent = "Scout mode is running.";
    void request(toWorker, "task.decide", { task_id: task.id, prompt_id: promptId, decision }).catch(() => undefined);
    stop.focus();
  }
  confirmOnce.addEventListener("click", () => decide("once"));
  confirmAlways.addEventListener("click", () => decide("always"));
  confirmDeny.addEventListener("click", () => decide("deny"));
  confirmBox.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      decide("deny");
    }
  });

  function onTaskEvent(p: Record<string, unknown>): void {
    const id = p.task_id as string;
    if (!task || task.id !== id) return;
    switch (p.kind) {
      case "log": {
        const text = String(p.text ?? "");
        appendTaskLog(text, String(p.status ?? "note"));
        // Diagnostics: the overlay's failure reason (app-generated, never page text).
        if (text.startsWith("Overlay could not be shown")) trace("task:overlay-failed " + (/\(([^)]*)\)/.exec(text)?.[1] ?? ""));
        break;
      }
      case "state": {
        const state = String(p.state);
        setTaskState(state);
        trace("task:" + state);
        break;
      }
      case "confirm":
        showConfirm({ prompt_id: String(p.prompt_id), what: String(p.what ?? ""), site: String(p.site ?? ""), reason: String(p.reason ?? ""), preapproved: p.preapproved === true, always: p.always !== false });
        break;
      case "done": {
        const usage: Usage = { inputTokens: Number(p.input_tokens ?? 0), outputTokens: Number(p.output_tokens ?? 0) };
        task.resolve({ status: String(p.status ?? "error"), summary: String(p.summary ?? ""), usage });
        break;
      }
      default:
        break;
    }
  }

  function onStopTask(): void {
    if (!task) return;
    trace("ui:stop-click task");
    void request(toWorker, "task.control", { task_id: task.id, command: "stop" }).catch(() => undefined);
  }

  /** Starts a task on this tab and resolves with its outcome. Null when it did not start (the reason was shown). */
  async function startTask(goal: string, source: "panel" | "chat"): Promise<{ status: string; summary: string; usage: Usage } | null> {
    if (task || tab.id === undefined) return null;
    if (!port) {
      addMessage("error", "Scout's background worker is not running. Close Scout and open it again.");
      return null;
    }
    if (!storage) conv = conv || "";
    else if (!conv) conv = await conversationForTab(storage, tab.id, Date.now(), tab.incognito).catch(() => "");
    // Watch this tab's events on the port now, in case the watch sent when the
    // port opened reached the worker before it was listening.
    watchTab();
    let started: { task_id: string };
    try {
      started = await request<{ task_id: string }>(toWorker, "task.start", { tab_id: tab.id, goal, conv, source }, { timeoutMs: 15_000 });
    } catch (err) {
      const msg = err instanceof BridgeError ? err.message : "Could not start the task. Reload the page and try again.";
      addMessage("error", msg);
      current.finish("error", msg);
      return null;
    }
    let resolve: TaskUi["resolve"] = () => undefined;
    const finished = new Promise<{ status: string; summary: string; usage: Usage }>((r) => (resolve = r));
    const t: TaskUi = { ...buildTrace([], "running", Date.now()), id: started.task_id, goal, source, promptId: null, resolve, finished };
    showTrace(t);
    stop.focus();
    const out = await finished;
    task = null;
    finishTrace(t, out.status);
    return out;
  }

  // The composer's Scout mode: a user message, the task, then its outcome in the thread.
  async function runTask(goal: string): Promise<void> {
    const trimmed = goal.trim();
    await sessionReady();
    if (!trimmed || activeChat || couponRun || task || !session) return;
    // Both would use the page at once.
    if (couponAway && couponAway.state !== "done") {
      status.textContent = "Scout mode can start once Find coupons finishes on this page.";
      return;
    }
    const s = session;
    if (!consent.has(s.settings.provider) && !(await allowSharing(s.settings.provider))) return;
    // No per-task question (owner decision 2026-10-17): sending the task starts it.
    startRun("agent", { mock: s.mock === true, provider: s.settings.provider, model: s.settings.model, question: trimmed });
    addMessage("user", trimmed, { mode: "Scout mode" });
    question.value = "";
    autosize();
    const out = await startTask(trimmed, "panel");
    if (!out) return;
    // Stopped by the user: the trace already reads "Stopped", nothing more to show.
    if (out.status !== "stopped") addMessage(out.status === "done" ? "assistant" : "error", out.summary);
    current.finish(out.status, out.summary, out.usage);
    status.textContent = formatCostLine(s.settings.model, out.usage);
    if (!matchMedia("(pointer: coarse)").matches) question.focus();
  }

  /** The chat's run_task tool: run the task and answer the Scout server with the outcome. */
  async function runTaskForChat(goal: string): Promise<ToolResult> {
    const site = hostOf(tab.url ?? "") ?? "";
    if (task) return { status: "error", text: "A task is already running on this tab.", site };
    const out = await startTask(goal, "chat");
    if (!out) return { status: "error", text: "The task could not start.", site };
    if (out.status === "done") {
      return { status: "ok", text: "<untrusted_page_content>\n" + out.summary.replace(/<\/?untrusted_page_content>/gi, "") + "\n</untrusted_page_content>", site, shared: { title: "Scout mode task", host: site } };
    }
    return { status: out.status === "stopped" ? "declined" : "error", text: "The task ended early (" + out.status + "): " + out.summary, site };
  }

  function watchTab(): void {
    if (tab.id === undefined) return;
    try {
      port?.post("task.watch", { tab_id: tab.id });
    } catch {
      // Not connected: the port watches again when it reconnects.
    }
  }

  /** A reopened panel: the task still running on this tab, with its log so far. */
  async function resumeTask(): Promise<void> {
    if (tab.id === undefined || !port || task) return;
    watchTab();
    const got = await request<{ task?: TaskView }>(toWorker, "task.status", { tab_id: tab.id }, { timeoutMs: 3_000 }).catch(() => null);
    const t0 = got?.task;
    if (!t0 || t0.done) return;
    addMessage("user", t0.goal, { mode: "Scout mode" });
    let resolve: TaskUi["resolve"] = () => undefined;
    const finished = new Promise<{ status: string; summary: string; usage: Usage }>((r) => (resolve = r));
    const t: TaskUi = { ...buildTrace(t0.log, t0.state, Date.now()), id: t0.task_id, goal: t0.goal, source: t0.source, promptId: null, resolve, finished };
    showTrace(t);
    if (t0.prompt) showConfirm(t0.prompt);
    trace("task:resumed");
    const out = await finished;
    task = null;
    finishTrace(t, out.status);
    if (t0.source === "panel") {
      if (out.status !== "stopped") addMessage(out.status === "done" ? "assistant" : "error", out.summary);
      status.textContent = formatCostLine(activeSettings().model, out.usage);
    }
  }

  // ---------- Coupons (S07, T031): find codes online and test them on the cart. ----------
  // Owner, 2026-10-16: a run that finds a saving applies the best code and
  // ends; one with none asks whether to search the web again.
  // Owner, 2026-10-17: no results card. The run shows inline like Scout mode
  // (a folded Working card with one line per code as it is tested, then the
  // summary), and the page glows with the same overlay while it runs; its
  // toast's Stop reaches this panel through the worker.
  // Owner, 2026-10-17 (later): codes are tested as the search finds them, all
  // of them rather than the first 25; milestones (searching, found N, a code
  // that saves, the search done) post in the chat outside the card, the newest
  // with a moving indicator; the summary is a few sentences.
  // Owner, 2026-10-19: the run lives in the worker (src/server/coupon-host.ts),
  // so swiping the panel away no longer ends it; this panel is its window, and
  // a reopened panel replays the run's events (coupons.status).
  interface CouponRun {
    tabId: number;
    t: { body: HTMLElement; head: HTMLButtonElement; headText: HTMLElement; startedAt: number };
    steps: ReturnType<typeof couponSteps>;
    stepLines: Map<number, HTMLElement>;
    timer: ReturnType<typeof setInterval>;
    /** The last event applied; older ones (a replay overlapping live events) are skipped. */
    seq: number;
    ask: { promptId: string; box: HTMLElement } | null;
  }
  let couponRun: CouponRun | null = null;
  /** Events that arrive while a reopened panel is still reading the run so far. */
  let couponBuffer: Array<Record<string, unknown>> | null = null;

  /** One inline line per code: "SAVE20 · $80.00 · saves $20.00 · seen on deals.test". */
  function attemptRow(
    a: {
      code: string;
      combo?: string[];
      total: number | null;
      saving: number | null;
      accepted: boolean | null;
      note: string;
      origin: Parameters<typeof originLabel>[0]["origin"];
      sourceUrl?: string;
      context?: string;
      conditions?: string;
    },
    currency: string | undefined,
    t: { body: HTMLElement },
  ): void {
    const row = document.createElement("div");
    const good = a.saving !== null && a.saving > 0 && a.accepted !== false;
    row.className = "attempt" + (good ? " good" : "");
    row.dataset.code = a.code;
    const code = document.createElement("span");
    code.className = "code";
    code.textContent = a.combo ? a.combo.join(" + ") : a.code;
    // The evidence: the words the page showed around the code.
    if (a.context) code.title = a.context + (a.conditions ? " (" + a.conditions + ")" : "");
    const text = document.createElement("span");
    const parts = [a.total === null ? "total unknown" : formatMoney(a.total, currency)];
    if (good && a.saving !== null) parts.push("saves " + formatMoney(a.saving, currency));
    parts.push(a.note);
    text.textContent = " · " + parts.join(" · ") + " · ";
    row.append(code, text);
    const label = originLabel(a);
    if (a.sourceUrl) {
      const link = document.createElement("a");
      link.href = a.sourceUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = label;
      row.appendChild(link);
    } else row.append(label);
    t.body.appendChild(row);
    followEnd();
  }

  /** The question after a search whose codes saved nothing; the composer's Stop (or the overlay's) answers it "no" in the worker. */
  function showAsk(run: CouponRun, promptId: string, tried: number): void {
    run.ask?.box.remove();
    const box = document.createElement("div");
    box.className = "more";
    box.id = "coupons-more";
    box.setAttribute("role", "group");
    box.setAttribute("aria-labelledby", "coupons-more-text");
    const p = document.createElement("p");
    p.id = "coupons-more-text";
    p.textContent =
      "We've tried " + tried + " code" + (tried === 1 ? "" : "s") + " and none lowered your total. " +
      "Would you like Scout to search the web again, in other places, for more codes to test?";
    const row = document.createElement("div");
    row.className = "row";
    const yesBtn = document.createElement("button");
    yesBtn.type = "button";
    yesBtn.className = "btn primary";
    yesBtn.textContent = "Search again";
    const noBtn = document.createElement("button");
    noBtn.type = "button";
    noBtn.className = "btn";
    noBtn.textContent = "Stop here";
    row.append(yesBtn, noBtn);
    box.append(p, row);
    // In the chat, not the folded card, so it is seen.
    log.appendChild(box);
    run.ask = { promptId, box };
    scrollToEnd();
    yesBtn.focus();
    const answer = (more: boolean): void => {
      box.remove();
      if (run.ask?.promptId === promptId) run.ask = null;
      if (more) stop.focus();
      void request(toWorker, "coupons.answer", { tab_id: run.tabId, prompt_id: promptId, more }).catch(() => undefined);
    };
    yesBtn.addEventListener("click", () => answer(true));
    noBtn.addEventListener("click", () => answer(false));
  }

  // Asked once ever: Safari's site-access prompt for every site, so later runs open blocked pages without asking.
  // Read with the first round of settings at the top of main().
  let siteAccessAsked = early[COUPON_BROWSER_KEY] === "asked";
  function askSiteAccessOnce(): void {
    if (siteAccessAsked) return;
    siteAccessAsked = true;
    // Called inside the button press, before any await, so Safari can show its prompt.
    try {
      void browser.permissions.request({ origins: ALL_SITES }).catch(() => false).then((ok) => trace("coupons:site-access " + (ok ? "granted" : "declined")));
    } catch {
      trace("coupons:site-access unavailable");
    }
    if (storage) void storage.set({ [COUPON_BROWSER_KEY]: "asked" }).catch(() => undefined);
  }

  const DONE_MARK = '<svg class="done-mark" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg>';

  /** Find coupons' milestone lines in the chat, outside the Working card; the newest one shows the moving indicator. */
  function couponSteps(): { post(text: string): HTMLElement; edit(line: HTMLElement, text: string): void; latest(): HTMLElement | null; end(): void } {
    let last: HTMLElement | null = null;
    const settle = (): void => {
      if (!last) return;
      last.classList.remove("busy");
      last.querySelector(".pulse")?.insertAdjacentHTML("afterend", DONE_MARK);
      last.querySelector(".pulse")?.remove();
    };
    return {
      post(text) {
        settle();
        const line = document.createElement("p");
        line.className = "coupon-step busy";
        line.innerHTML = PULSE;
        const words = document.createElement("span");
        words.textContent = text;
        line.appendChild(words);
        log.appendChild(line);
        last = line;
        followEnd();
        return line;
      },
      edit(line, text) {
        const words = line.querySelector("span:last-child");
        if (words) words.textContent = text;
      },
      latest: () => last,
      end: settle,
    };
  }

  /** The Working card and milestones for a coupon run on this tab (new, or caught up after a reopen). */
  function showCouponRun(startedAt: number): CouponRun {
    const t = buildTrace([], "running", startedAt, { steps: false });
    const run: CouponRun = {
      tabId: tab.id!,
      t,
      steps: couponSteps(),
      stepLines: new Map(),
      timer: setInterval(() => (t.headText.textContent = "Working " + elapsedText(Date.now() - startedAt)), 1000),
      seq: 0,
      ask: null,
    };
    t.headText.textContent = "Working " + elapsedText(Date.now() - startedAt);
    // The card's head moves too while the run works (owner, 2026-10-17).
    t.head.insertAdjacentHTML("afterbegin", PULSE);
    couponRun = run;
    syncComposer();
    plus.disabled = modelPill.disabled = true;
    for (const i of modeInputs) i.disabled = true;
    closeModelMenu();
    // Progress shows in the chat (milestones), not on the status line.
    status.textContent = "";
    updateEmpty();
    scrollToEnd();
    stop.focus();
    return run;
  }

  function endCouponRun(run: CouponRun, outcome: string): void {
    clearInterval(run.timer);
    run.steps.end();
    run.ask?.box.remove();
    run.t.head.querySelector(".pulse")?.remove();
    run.t.headText.textContent = (outcome === "done" ? "Finished " : outcome === "stopped" ? "Stopped " : "Ended ") + elapsedText(Date.now() - run.t.startedAt);
    if (couponRun === run) couponRun = null;
    syncComposer();
    plus.disabled = modelPill.disabled = false;
    for (const i of modeInputs) i.disabled = false;
    updateEmpty();
  }

  /** One event from the worker's coupon run (src/coupons/job.ts). */
  function onCouponEvent(p: Record<string, unknown>, replay = false): void {
    if (p.tab_id !== tab.id) return;
    const run = couponRun;
    if (!run) {
      if (couponBuffer) couponBuffer.push(p);
      else if (couponAway) onAwayEvent(couponAway, p);
      return;
    }
    const seq = Number(p.seq ?? 0);
    if (seq <= run.seq) return;
    run.seq = seq;
    switch (p.kind) {
      case "say": {
        const line = document.createElement("p");
        line.className = "say";
        line.textContent = String(p.text ?? "");
        run.t.body.appendChild(line);
        followEnd();
        break;
      }
      case "step": {
        const id = Number(p.step);
        const line = run.stepLines.get(id);
        if (line) run.steps.edit(line, String(p.text ?? ""));
        else run.stepLines.set(id, run.steps.post(String(p.text ?? "")));
        break;
      }
      case "steps-end":
        run.steps.end();
        break;
      case "attempt": {
        const a = p.attempt as Parameters<typeof attemptRow>[0] | null;
        if (a && typeof a === "object" && typeof a.code === "string") attemptRow(a, typeof p.currency === "string" ? p.currency : undefined, run.t);
        break;
      }
      case "ask":
        showAsk(run, String(p.prompt_id), Number(p.tried ?? 0));
        break;
      case "answered": {
        const ask = run.ask;
        if (ask && ask.promptId === p.prompt_id) {
          ask.box.remove();
          run.ask = null;
        }
        break;
      }
      case "trace":
        // Replayed stages keep their time in the run (see CouponHost.emit).
        trace(replay && typeof p.at_ms === "number" ? "replay +" + (p.at_ms / 1000).toFixed(2) + "s " + String(p.stage ?? "") : String(p.stage ?? ""));
        break;
      case "page":
        current.page(String(p.url ?? ""));
        break;
      case "done": {
        const summary = String(p.summary ?? "");
        const usage: Usage = {
          inputTokens: Number(p.input_tokens ?? 0),
          outputTokens: Number(p.output_tokens ?? 0),
          ...(p.web_searches ? { webSearches: Number(p.web_searches) } : {}),
        };
        endCouponRun(run, String(p.outcome ?? "error"));
        addMessage(p.tone === "error" ? "error" : "assistant", summary);
        status.textContent = String(p.status_text ?? "");
        current.finish(String(p.status ?? "error"), String(p.message ?? ""), usage);
        // The worker saved it; this keeps it in the session's turns for Branch.
        turns.push({ entry: { at: Date.now(), question: COUPON_QUESTION, answer: summary, kind: "coupons" } });
        if (!matchMedia("(pointer: coarse)").matches) question.focus();
        break;
      }
      default:
        break;
    }
  }

  async function runCoupons(): Promise<void> {
    // One run per tab: Find coupons goes back to the one New chat left running.
    if (couponAway && couponAway.state !== "done") return backToCoupons();
    await sessionReady();
    if (activeChat || task || couponRun || !session || tab.id === undefined) return;
    if (couponAway) {
      couponAway = null;
      renderCouponChip();
    }
    const s = session;
    askSiteAccessOnce();
    if (!consent.has(s.settings.provider) && !(await allowSharing(s.settings.provider))) return;
    startRun("coupons", { mock: s.mock === true, provider: s.settings.provider, model: s.settings.model });
    current.page(tab.url);
    if (!port) {
      const msg = "Scout's background worker is not running. Close Scout and open it again.";
      addMessage("error", msg);
      current.finish("error", msg);
      return;
    }
    if (storage && !conv) conv = await conversationForTab(storage, tab.id, Date.now(), tab.incognito).catch(() => "");
    addMessage("user", COUPON_QUESTION, { mode: "Find coupons" });
    // Watch this tab's events on the port now, in case the watch sent when the
    // port opened reached the worker before it was listening.
    watchTab();
    const run = showCouponRun(Date.now());
    try {
      await request(
        toWorker,
        "coupons.start",
        {
          tab_id: tab.id,
          ...(tab.windowId !== undefined ? { window_id: tab.windowId } : {}),
          provider: s.settings.provider,
          model: s.settings.model,
          ...(s.effort ? { effort: s.effort } : {}),
          ...(conv ? { conv } : {}),
          ...(pageSite ? { site: pageSite } : {}),
          // iPhone: the pointer works above the panel's sheet (src/actions/pointer.ts).
          ...(isPhoneScreen(matchMedia("(pointer: coarse)").matches, screen.width) ? { phone: true } : {}),
        },
        { timeoutMs: 15_000 },
      );
    } catch (err) {
      const msg = err instanceof BridgeError ? err.message : "Could not reach this page. Reload it and try again.";
      endCouponRun(run, "error");
      addMessage("error", msg);
      status.textContent = couponStatusText("error");
      current.finish("error", msg);
    }
  }

  type CouponRunView = { started_at: number; conv?: string; events: Array<Record<string, unknown>>; done: boolean; prompt_id?: string };

  /** The worker's run on this tab (running or just finished), and live events that came while asking. */
  async function readCouponRun(): Promise<{ run: CouponRunView; buffered: Array<Record<string, unknown>> } | null> {
    if (tab.id === undefined || !port) return null;
    couponBuffer = [];
    watchTab();
    const got = await request<{ run?: CouponRunView }>(toWorker, "coupons.status", { tab_id: tab.id }, { timeoutMs: 3_000 }).catch(() => null);
    const buffered = couponBuffer;
    couponBuffer = null;
    return got?.run ? { run: got.run, buffered } : null;
  }

  /** Shows a run in the chat and replays its events so far (a finished run ends with its summary). */
  function replayCouponRun(r: CouponRunView, buffered: Array<Record<string, unknown>>): void {
    // Its own diagnostics run, so the outcome is not filed under this panel's
    // startup (owner report 2026-10-19 showed a "startup → no_form") and a
    // report copied now shows it, not the panel opening. One run: two merged
    // changes each started one, and the empty first pushed an older run out.
    const s = session;
    startRun("coupons", s ? { provider: s.settings.provider, model: s.settings.model, ...(s.mock ? { mock: true } : {}) } : {});
    current.page(tab.url);
    addMessage("user", COUPON_QUESTION, { mode: "Find coupons" });
    showCouponRun(r.started_at);
    trace("coupons:resumed");
    for (const e of r.events) onCouponEvent({ ...e, tab_id: tab.id }, true);
    for (const e of buffered) onCouponEvent({ ...e, tab_id: tab.id });
  }

  /** A reopened panel: the coupon run still going on this tab, caught up to where it is. */
  async function resumeCoupons(): Promise<void> {
    if (couponRun) return;
    const got = await readCouponRun();
    if (!got || couponRun) return;
    const r = got.run;
    // The run belongs to a chat New chat left: the chip leads back to it.
    if (r.conv && conv && r.conv !== conv) {
      sendCouponAway(r.conv, r.done ? "done" : r.prompt_id ? "ask" : "running");
      for (const e of got.buffered) if (couponAway) onAwayEvent(couponAway, e);
      return;
    }
    if (r.done) return;
    replayCouponRun(r, got.buffered);
  }

  // ---------- Find coupons in the background (owner choice 2026-10-19) ----------
  // New chat no longer waits for a coupon run. The run keeps going in the
  // worker and saves its summary to the chat it started in; a chip above the
  // composer says so and goes back to that chat.
  interface CouponAway {
    conv: string;
    state: "running" | "ask" | "done";
  }
  let couponAway: CouponAway | null = null;
  const couponChip = el<HTMLButtonElement>("coupon-chip");

  function renderCouponChip(): void {
    const a = couponAway;
    couponChip.hidden = !a;
    if (!a) return;
    const words = a.state === "done" ? "Coupon search finished" : a.state === "ask" ? "Find coupons needs your answer" : "Finding coupons…";
    couponChip.innerHTML = a.state === "done" ? DONE_MARK : PULSE;
    const text = document.createElement("span");
    text.textContent = words;
    const go = document.createElement("span");
    go.className = "go";
    go.textContent = "Show";
    couponChip.append(text, go);
    couponChip.setAttribute("aria-label", words + " Show the coupon chat.");
  }

  /** The run's chat leaves the view; the run goes on in the worker. */
  function sendCouponAway(runConv: string, state: CouponAway["state"]): void {
    const run = couponRun;
    if (run) {
      clearInterval(run.timer);
      couponRun = null;
      syncComposer();
      plus.disabled = modelPill.disabled = false;
      for (const i of modeInputs) i.disabled = false;
    }
    couponAway = { conv: runConv, state };
    renderCouponChip();
    trace("coupons:away " + state);
  }

  function onAwayEvent(away: CouponAway, p: Record<string, unknown>): void {
    const next = p.kind === "done" ? "done" : p.kind === "ask" ? "ask" : p.kind === "answered" && away.state === "ask" ? "running" : away.state;
    if (next === away.state) return;
    away.state = next;
    renderCouponChip();
  }

  /** The chip: back to the chat that holds the coupon run, caught up (or with its summary). */
  async function backToCoupons(): Promise<void> {
    if (couponAway) await openChat(couponAway.conv);
  }

  /**
   * Shows an earlier chat on this tab (the chats menu, or the coupon chip). A
   * coupon run this panel is showing goes on in the background, as with New
   * chat; a run that belongs to the chat is replayed, caught up.
   */
  async function openChat(target: string): Promise<void> {
    if (activeChat || task) {
      status.textContent = "Wait until Scout finishes, then open another chat.";
      return;
    }
    if (couponRun) {
      if (target === conv) return;
      sendCouponAway(conv, couponRun.ask ? "ask" : "running");
    }
    if (couponAway?.conv === target) {
      couponAway = null;
      renderCouponChip();
    }
    clearThread();
    conv = target;
    if (storage) await reopenConversation(storage, tab.id, conv, Date.now(), tab.incognito).catch(() => undefined);
    const got = await readCouponRun();
    const r = got && (!got.run.conv || got.run.conv === conv) ? got.run : null;
    const entries = storage ? await loadConversation(storage, settings.retention, Date.now(), conv).catch(() => []) : [];
    // A run the worker still has is replayed whole, so its saved summary is not shown twice.
    showEntries(r ? entries.filter((e) => !(e.kind === "coupons" && e.at >= r.started_at)) : entries);
    if (r && got) replayCouponRun(r, got.buffered);
    else if (got && !got.run.done && !couponAway) sendCouponAway(got.run.conv ?? "", got.run.prompt_id ? "ask" : "running");
    status.textContent = "";
    updateEmpty();
    trace("conversation:open " + entries.length);
    scrollToEnd();
    await resumeActive();
  }
  couponChip.addEventListener("click", () => void backToCoupons());

  // ---------- Chats menu (owner request 2026-10-19) ----------
  // Earlier chats from saved history, newest first; a coupon run still going
  // (on this tab or another) is listed with its live state and opens caught up.
  const chatsOpen = el<HTMLButtonElement>("chats-open");
  const chatsPanel = el("chats");
  const chatsBackdrop = el("chats-backdrop");
  const chatsList = el("chats-list");
  const chatsEmpty = el("chats-empty");
  type RunRow = { tab_id: number; conv: string; site?: string; started_at: number; done: boolean; prompt_id?: string };

  /** Private Browsing chats show only in their own tab; elsewhere they are left out. */
  async function visibleConvs(): Promise<(c: string) => boolean> {
    if (!storage) return () => true;
    const got = await storage.get(PRIVATE_CONVS_KEY).catch(() => none);
    const all = parsePrivateConvs(got[PRIVATE_CONVS_KEY]);
    const mine = new Set(all[tabKey(tab.id)] ?? []);
    if (tab.incognito) return (c) => mine.has(c);
    const priv = new Set(Object.values(all).flat());
    return (c) => !priv.has(c);
  }

  async function renderChats(): Promise<void> {
    const [entries, runs, visible] = await Promise.all([
      storage ? loadHistory(storage, settings.retention, Date.now()).catch(() => []) : [],
      port ? request<{ runs: RunRow[] }>(toWorker, "coupons.list", {}, { timeoutMs: 3_000 }).then((r) => r.runs).catch(() => []) : [],
      visibleConvs(),
    ]);
    const chats = summarizeChats(entries, {
      summarize: (q) => q === SUMMARIZE_QUESTION || LEGACY_SUMMARIZE_QUESTIONS.includes(q),
      coupons: "Find coupons",
      agent: "Scout mode",
    });
    const live = new Map<string, RunRow>();
    for (const r of runs) if (r.conv && !r.done) live.set(r.conv, r);
    // A run's summary is saved when it ends, so a chat that is only a running search has no entry yet.
    for (const r of live.values()) {
      const c = chats.find((x) => x.conv === r.conv);
      if (c) c.at = Math.max(c.at, r.started_at);
      else chats.push({ conv: r.conv, title: "Find coupons", at: r.started_at, count: 0, ...(r.site ? { site: r.site } : {}) });
    }
    const shown = chats.filter((c) => visible(c.conv)).sort((a, b) => (live.has(b.conv) ? 1 : 0) - (live.has(a.conv) ? 1 : 0) || b.at - a.at);
    chatsList.replaceChildren();
    const now = Date.now();
    for (const c of shown) {
      const run = live.get(c.conv);
      const li = document.createElement("li");
      if (c.conv === conv) li.setAttribute("aria-current", "true");
      const open = document.createElement("button");
      open.type = "button";
      open.className = "chat-open";
      const title = document.createElement("span");
      title.className = "chat-title";
      title.textContent = c.title;
      const meta = document.createElement("span");
      meta.className = "chat-meta" + (run ? " live" : "");
      if (run) {
        meta.innerHTML = PULSE;
        const words = run.prompt_id ? "Needs your answer" : "Finding coupons…";
        meta.append(document.createTextNode(words + (run.tab_id !== tab.id ? " · other tab" : "")));
      } else meta.textContent = [c.site, whenText(c.at, now)].filter(Boolean).join(" · ");
      open.append(title, meta);
      open.addEventListener("click", () => void pickChat(c.conv, run));
      li.appendChild(open);
      if (!run) {
        const del = document.createElement("button");
        del.type = "button";
        del.className = "icon-btn chat-delete";
        del.setAttribute("aria-label", "Delete chat: " + c.title);
        del.title = "Delete chat";
        del.innerHTML = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';
        del.addEventListener("click", () => void removeChat(c.conv));
        li.appendChild(del);
      }
      chatsList.appendChild(li);
    }
    chatsEmpty.hidden = shown.length > 0;
    chatsEmpty.textContent =
      settings.retention === "off" ? "Chat history is off. Turn it on in Settings to see earlier chats here." : "No earlier chats yet.";
  }

  function showChats(on: boolean): void {
    chatsPanel.hidden = chatsBackdrop.hidden = !on;
    chatsOpen.setAttribute("aria-expanded", String(on));
    if (on) {
      void renderChats().then(() => (chatsList.querySelector<HTMLElement>('[aria-current="true"] .chat-open') ?? el("chats-new")).focus());
      trace("ui:chats");
    } else chatsOpen.focus();
  }

  async function pickChat(target: string, run: RunRow | undefined): Promise<void> {
    // A coupon run on another tab: go to that tab, where its panel catches up.
    if (run && run.tab_id !== tab.id) {
      trace("chats:other-tab");
      void request(toWorker, "tabs.show", { tab_id: run.tab_id }, { timeoutMs: 5_000 }).catch(() => undefined);
      if (!STANDALONE) window.close();
      return;
    }
    showChats(false);
    await openChat(target);
  }

  async function removeChat(target: string): Promise<void> {
    if (!storage) return;
    await deleteConversation(storage, target).catch(() => undefined);
    trace("chats:delete");
    // The chat on screen: this tab starts a new one.
    if (target === conv && !activeChat && !task && !couponRun) {
      clearThread();
      conv = await startNewConversation(storage, tab.id, Date.now(), tab.incognito).catch(() => conv);
    }
    await renderChats();
    (chatsList.querySelector<HTMLElement>(".chat-open") ?? el("chats-new")).focus();
  }

  chatsOpen.addEventListener("click", () => showChats(chatsPanel.hidden !== false));
  el("chats-close").addEventListener("click", () => showChats(false));
  chatsBackdrop.addEventListener("click", () => showChats(false));
  el("chats-new").addEventListener("click", () => {
    showChats(false);
    el("new-chat").click();
  });
  chatsPanel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      showChats(false);
    }
  });

  // ---------- Wiring ----------
  composer.addEventListener("submit", (event) => {
    event.preventDefault();
    closePlus();
    if (mode() === "scout") void runTask(question.value);
    else void ask(question.value);
  });
  question.addEventListener("keydown", (event) => {
    if (mentionKey(event)) return;
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      composer.requestSubmit();
    }
  });
  couponsRun.addEventListener("click", () => {
    closePlus();
    void runCoupons();
  });
  // On a known shopping site the composer lists store actions and the general chips go.
  const shop = suggestionsFor(tab.url);
  if (shop) {
    const iconUrl = siteIconUrl(tab.url, tab.favIconUrl);
    const letterTile = (): HTMLElement => {
      const t = document.createElement("span");
      t.className = "site-icon tile";
      t.setAttribute("aria-hidden", "true");
      t.style.background = shop.site.color;
      t.dataset.letter = shop.site.name.replace(/^The /, "").charAt(0);
      return t;
    };
    for (const s of shop.items) {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      let icon: HTMLElement = letterTile();
      if (iconUrl) {
        const img = document.createElement("img");
        img.className = "site-icon";
        img.alt = "";
        img.referrerPolicy = "no-referrer";
        img.src = iconUrl;
        img.addEventListener("error", () => img.replaceWith(letterTile()), { once: true });
        icon = img;
      }
      icon.setAttribute("aria-hidden", "true");
      b.append(icon, s.label);
      b.addEventListener("click", () => void ask(s.prompt));
      li.appendChild(b);
      siteSuggestions.appendChild(li);
    }
    siteSuggestions.setAttribute("aria-label", "Suggestions for " + shop.site.name);
    el("starters").hidden = true;
    updateEmpty();
  }
  for (const chip of empty.querySelectorAll<HTMLButtonElement>("button[data-prompt]")) {
    chip.addEventListener("click", () => {
      const p = chip.dataset.prompt ?? "";
      if (p === "summarize") void ask(SUMMARIZE_QUESTION);
      else if (p === "coupons") void runCoupons();
      else void ask(p);
    });
  }
  // The composer's Stop halts whatever runs: a coupon run, a Scout mode task,
  // and the answer streaming around a task the model asked for.
  stop.addEventListener("click", () => {
    if (couponRun) void request(toWorker, "coupons.stop", { tab_id: couponRun.tabId }).catch(() => undefined);
    if (task) onStopTask();
    const id = activeChat;
    if (!id) return;
    trace("ui:stop-click chat");
    void request(toWorker, "chat.stop", { message_id: id }).catch(() => {
      // The worker is gone: end it here with what arrived.
      store.stopLocally(id);
      finalize(id);
    });
  });
  // Opens Scout as its own page in a new tab, to bookmark (owner request 2026-10-18).
  el("open-page").addEventListener("click", () => {
    trace("ui:open-page");
    void openStandalone(browser).then((ok) => {
      if (ok) window.close();
      else status.textContent = browserName() + " did not open a new tab. Try again.";
    });
  });
  el("new-chat").addEventListener("click", () => {
    if (activeChat || task) return;
    // Find coupons keeps going in the background (owner choice 2026-10-19).
    if (couponRun) sendCouponAway(conv, couponRun.ask ? "ask" : "running");
    clearThread();
    if (storage) {
      void startNewConversation(storage, tab.id, Date.now(), tab.incognito)
        .then((next) => (conv = next))
        .catch(() => undefined);
    }
    status.textContent = session ? "New chat." : status.textContent;
    trace("conversation:new");
    if (!matchMedia("(pointer: coarse)").matches) question.focus();
  });

  // ---------- Settings view ----------
  const settingsOpen = el<HTMLButtonElement>("settings-open");
  const providerInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="provider"]'));
  const keyForm = el<HTMLFormElement>("key-form");
  const keyInput = el<HTMLInputElement>("key-input");
  const keyLabel = el("key-label");
  const keyStatus = el("key-status");
  const keyError = el("key-error");
  const keyRemove = el<HTMLButtonElement>("key-remove");
  const keySave = el<HTMLButtonElement>("key-save");
  const modelSel = el<HTMLSelectElement>("set-model");
  const modelCustomRow = el("model-custom-row");
  const modelCustom = el<HTMLInputElement>("set-model-custom");
  const modelHelp = el("model-help");
  const modelsRefresh = el<HTMLButtonElement>("models-refresh");
  const effortSel = el<HTMLSelectElement>("set-effort");
  const effortHelp = el("effort-help");
  const retentionSel = el<HTMLSelectElement>("set-retention");
  const savedMsg = el("settings-saved");
  const sites = el("site-list");
  const historyCount = el("history-count");

  // ---------- Sharing with AI providers: state and withdrawal ----------
  const consentList = el("consent-list");
  const consentStatus = el("consent-status");

  function renderConsent(): void {
    consentList.replaceChildren(
      ...(["anthropic", "openai"] as const).map((p) => {
        const li = document.createElement("li");
        const rec = consent.record(p);
        if (!rec) {
          li.textContent = PROVIDER_NAME[p] + ": not allowed. Scout asks before it sends anything.";
          return li;
        }
        const day = new Date(rec.at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn";
        btn.textContent = "Withdraw";
        btn.setAttribute("aria-label", "Withdraw permission to share with " + PROVIDER_NAME[p]);
        btn.addEventListener("click", () => {
          // The gate closes at once; storage follows.
          void consent.withdraw(p).then(
            () => (consentStatus.textContent = "Withdrawn. Scout sends nothing to " + PROVIDER_NAME[p] + " until you allow it again."),
            () => (consentStatus.textContent = "Could not save the change. Nothing is sent to " + PROVIDER_NAME[p] + " while this panel is open. Try again."),
          );
          trace("consent:withdrawn " + p);
          renderConsent();
          el("sharing-title").focus();
        });
        li.append(PROVIDER_NAME[p] + ": allowed on " + day + ". ", btn);
        return li;
      }),
    );
  }

  const chosenProvider = (): Provider => (providerInputs.find((i) => i.checked)?.value === "openai" ? "openai" : "anthropic");

  async function persist(next: Settings, message = "Saved."): Promise<void> {
    settings = parseSettings(next);
    try {
      if (!storage) throw new Error("no storage");
      await saveSettings(storage, settings);
      savedMsg.textContent = message;
    } catch {
      savedMsg.textContent = "Could not save settings.";
    }
    await connect();
  }

  async function refreshKeyStatus(): Promise<void> {
    const p = chosenProvider();
    keyLabel.textContent = PROVIDER_NAME[p] + " API key";
    let has = false;
    try {
      has = !!(await keychain.getKey(p));
    } catch {
      has = false;
    }
    keyStatus.textContent = has ? PROVIDER_NAME[p] + " key saved in " + keyPlace() + "." : "No " + PROVIDER_NAME[p] + " key saved yet.";
    keyRemove.hidden = !has;
    keyInput.placeholder = has ? "Paste a new key to replace it" : p === "anthropic" ? "sk-ant-…" : "sk-…";
  }

  // ---------- Model and effort dropdowns ----------
  const OTHER = "__other";
  let models: ModelInfo[] = [];
  const modelInfo = (id: string): ModelInfo | undefined => models.find((m) => m.id === id);

  function renderEffort(): void {
    const levels = modelInfo(settings.model)?.efforts ?? [];
    effortSel.replaceChildren(
      ...(["default", ...levels] as EffortSetting[]).map((v) => new Option(EFFORT_LABEL[v] + (v === "default" ? " (model decides)" : ""), v)),
    );
    effortSel.value = levels.includes(settings.effort as Effort) ? settings.effort : "default";
    effortSel.disabled = levels.length === 0;
    effortHelp.textContent = levels.length
      ? "Higher effort thinks longer: better on hard questions, but slower and uses more tokens."
      : "This model has no effort setting.";
  }

  function renderModels(list: ModelInfo[]): void {
    models = withModel(list, settings.provider, settings.model);
    modelSel.replaceChildren(...models.map((m) => new Option(m.name, m.id)), new Option("Other model ID…", OTHER));
    modelSel.value = settings.model;
    modelCustomRow.hidden = true;
    renderEffort();
  }

  // Shows what is known at once, then loads the list for the chosen provider:
  // cached for a day, else the provider's model list (no tokens billed), else
  // a built-in list.
  async function refreshModels(refresh = false): Promise<void> {
    const p = settings.provider;
    renderModels(knownModels[p]);
    modelHelp.textContent = "Loading models…";
    let saved: string | null = null;
    try {
      saved = await keychain.getKey(p);
    } catch {
      saved = null;
    }
    // The live list is a request to the provider, so only after consent.
    const key = consent.has(p) ? saved : null;
    const list = await loadModelList(storage, p, key, providerFetch, Date.now(), { refresh });
    if (settings.provider !== p) return;
    rememberModels(p, list.models);
    // Keep a half-typed custom model ID.
    if (modelCustomRow.hidden) renderModels(list.models);
    modelHelp.textContent =
      list.source === "builtin"
        ? key
          ? "Could not load your " + PROVIDER_NAME[p] + " model list. Showing common models."
          : saved
            ? "Showing common models. Scout lists every model your key can use after you allow sharing with " + PROVIDER_NAME[p] + "."
            : "Showing common models. Save your " + PROVIDER_NAME[p] + " key to list every model it can use."
        : "Models your " + PROVIDER_NAME[p] + " key can use." + (list.error ? " Could not refresh the list just now." : "");
    trace("models:" + p + " " + list.source + " " + list.models.length);
  }

  /** Saves a model choice; an effort the new model does not support goes back to Default. */
  async function chooseModel(id: string): Promise<void> {
    const levels = modelInfo(id)?.efforts ?? [];
    const effort: EffortSetting = levels.includes(settings.effort as Effort) ? settings.effort : "default";
    await persist({ ...settings, model: id, effort });
    renderEffort();
  }

  async function refreshSettings(): Promise<void> {
    for (const i of providerInputs) i.checked = i.value === settings.provider;
    syncSegmented(providerInputs);
    retentionSel.value = settings.retention;
    renderConsent();
    // Not awaited: Settings opens at once; the list fills in when it arrives.
    void refreshModels();
    await refreshKeyStatus();
    const entries = storage ? await loadHistory(storage, settings.retention, Date.now()).catch(() => []) : [];
    historyCount.textContent = entries.length + " saved " + (entries.length === 1 ? "exchange" : "exchanges") + ".";
    sites.replaceChildren();
    const origins = await listOrigins();
    if (!origins.length) {
      const li = document.createElement("li");
      li.textContent = "No sites granted.";
      sites.appendChild(li);
    }
    for (const origin of origins) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn";
      btn.textContent = "Remove";
      btn.setAttribute("aria-label", "Remove access to " + origin);
      btn.addEventListener("click", () => {
        void browser.permissions.remove({ origins: [origin] }).then(refreshSettings, refreshSettings);
      });
      li.append(origin + " ", btn);
      sites.appendChild(li);
    }
    await renderPageButton(origins);
    await renderAccess();
    await renderShared();
  }

  // ---------- Page access (Part 2, spec 10a) ----------
  const accessRead = el<HTMLInputElement>("access-read");
  const accessSearch = el<HTMLInputElement>("access-search");
  const accessScout = el<HTMLSelectElement>("access-scout");
  const allowList = el("allow-list");
  const sharedList = el("shared-list");
  const sharedStatus = el("shared-status");
  const shotList = el("shot-list");
  const blockForm = el<HTMLFormElement>("block-form");
  const blockInput = el<HTMLInputElement>("block-input");
  const blockCurrent = el<HTMLButtonElement>("block-current");
  const blockList = el("block-list");
  const blockStatus = el("block-status");
  const currentHost = hostOf(tab.url ?? "");

  function listRow(text: string, button?: { label: string; aria: string; onClick: () => void }): HTMLLIElement {
    const li = document.createElement("li");
    li.append(text + (button ? " " : ""));
    if (button) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn";
      b.textContent = button.label;
      b.setAttribute("aria-label", button.aria);
      b.addEventListener("click", button.onClick);
      li.appendChild(b);
    }
    return li;
  }

  async function updateAccess(change: (a: PageAccess) => PageAccess, message: string): Promise<void> {
    try {
      if (!storage) throw new Error("no storage");
      await savePageAccess(storage, change(await loadPageAccess(storage)));
      blockStatus.textContent = message;
    } catch {
      blockStatus.textContent = "Could not save the change. Try again.";
    }
    await renderAccess();
  }

  async function renderAccess(): Promise<void> {
    const a = await loadPageAccess(storage);
    accessRead.checked = a.readCurrent;
    accessSearch.checked = a.searchTabs;
    el("access-search-help").textContent =
      "Off until you turn it on. On: when a question needs it, Scout can list the titles and addresses of your open tabs" +
      (browser.history
        ? " and search your history."
        : TARGET === "safari"
          ? ". Safari does not let extensions search history or recently closed tabs, so only open tabs are searched."
          : ". Only open tabs are searched, not history or recently closed tabs.");
    accessScout.value = a.scoutMode;
    const allows = Object.entries(a.alwaysAllow);
    allowList.replaceChildren(
      ...(allows.length
        ? allows.map(([host, kinds]) =>
            listRow(host + ": " + kinds.map((k) => KIND_LABEL[k as SensitiveKind] ?? k).join(", "), {
              label: "Revoke",
              aria: "Ask again before sensitive actions on " + host,
              onClick: () => void updateAccess((x) => withoutAlwaysAllow(x, host), "Scout will ask again on " + host + "."),
            }),
          )
        : [listRow("No sites always allowed.")]),
    );
    const shots = Object.entries(a.screenshots);
    shotList.replaceChildren(
      ...(shots.length
        ? shots.map(([host, choice]) =>
            listRow(host + ": " + (choice === "always" ? "always allowed" : "never"), {
              label: "Ask again",
              aria: "Ask again before screenshots of " + host,
              onClick: () => {
                const next = { ...a.screenshots };
                delete next[host];
                void updateAccess((x) => ({ ...x, screenshots: next }), "Scout will ask before screenshots of " + host + ".");
              },
            }),
          )
        : [listRow("No sites chosen yet.")]),
    );
    blockList.replaceChildren(
      ...(a.blocked.length
        ? a.blocked.map((host) =>
            listRow(host, {
              label: "Unblock",
              aria: "Unblock " + host,
              onClick: () => void updateAccess((x) => ({ ...x, blocked: x.blocked.filter((b) => b !== host) }), "Unblocked " + host + "."),
            }),
          )
        : [listRow("No sites blocked.")]),
    );
    blockCurrent.hidden = !currentHost || a.blocked.includes(currentHost);
    if (currentHost) blockCurrent.textContent = "Block " + currentHost;
    const org = parsePolicy(await nativeSend({ type: "policy.get" }).catch(() => null));
    el("admin-box").hidden = org.length === 0;
    el("admin-list").replaceChildren(...org.map((h) => listRow(h)));
  }

  function blockSite(raw: string): void {
    const host = normalizeSite(raw);
    if (!host) {
      blockInput.setAttribute("aria-invalid", "true");
      blockStatus.textContent = "Enter a site like example.com.";
      blockInput.focus();
      return;
    }
    blockInput.removeAttribute("aria-invalid");
    blockInput.value = "";
    void updateAccess(
      (a) => ({ ...a, blocked: [...new Set([...a.blocked, host])] }),
      "Blocked " + host + ". Scout will not read or screenshot it.",
    );
    trace("access:blocked");
  }

  accessRead.addEventListener("change", () => {
    const on = accessRead.checked;
    void updateAccess((a) => ({ ...a, readCurrent: on }), on ? "The current page is shared with each question." : "Only tabs you attach are shared.");
  });
  accessSearch.addEventListener("change", () => {
    const on = accessSearch.checked;
    void updateAccess((a) => ({ ...a, searchTabs: on }), on ? "Scout may search your open tabs." : "Tab and history search is off.");
  });
  accessScout.addEventListener("change", () => {
    const choice = accessScout.value === "off" ? "off" : "on";
    void updateAccess((a) => ({ ...a, scoutMode: choice }), choice === "off" ? "Scout mode is off." : "Scout mode starts as soon as you send a task.");
    trace("access:scout " + choice);
  });

  // Spec 10: what each conversation shared, and clearing it.
  async function renderShared(): Promise<void> {
    const entries = storage ? await loadHistory(storage, settings.retention, Date.now()).catch(() => []) : [];
    const groups = summarizeShared(entries);
    sharedList.replaceChildren(
      ...(groups.length
        ? groups.map((g) => {
            const when = new Date(g.at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
            const label = (g.conv === conv ? "This conversation" : "Conversation of " + when) + ": " + g.items.map(sharedLabel).join(" · ");
            return listRow(label, {
              label: "Clear",
              aria: "Clear what the conversation of " + when + " shared",
              onClick: () => {
                if (!storage) return;
                void clearShared(storage, g.conv).then(async () => {
                  sharedStatus.textContent = "Cleared.";
                  await renderShared();
                });
              },
            });
          })
        : [listRow("Nothing shared in saved conversations.")]),
    );
  }
  el("shared-clear-all").addEventListener("click", () => {
    if (!storage) return;
    void clearShared(storage).then(async () => {
      sharedStatus.textContent = "Cleared every shared record.";
      await renderShared();
    });
  });
  blockForm.addEventListener("submit", (e) => {
    e.preventDefault();
    blockSite(blockInput.value);
  });
  blockCurrent.addEventListener("click", () => {
    if (currentHost) blockSite(currentHost);
  });

  // ---------- Button on webpages (src/edge.ts) ----------
  // On from a fresh install; it shows on sites Scout can access. Turning it on here asks Safari for site access; the
  // user may grant every site or fewer, and the button shows where granted.
  const pageOn = el<HTMLInputElement>("pagebutton-on");
  const pageSides = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="pagebutton-side"]'));
  const pageStatus = el("pagebutton-status");
  // Not offered on Mac, where Scout is in the toolbar.
  const pageOffered = pageButtonOffered(await platformOs());
  el("pagebutton-section").hidden = !pageOffered;
  el("toolbar-pagebutton").hidden = !pageOffered;

  async function loadPageButton(): Promise<PageButton> {
    const got = storage ? await storage.get(PAGE_BUTTON_KEY).catch(() => ({}) as Record<string, unknown>) : {};
    return parsePageButton(got[PAGE_BUTTON_KEY]);
  }
  async function savePageButton(next: PageButton): Promise<void> {
    if (!storage) throw new Error("no storage");
    await storage.set({ [PAGE_BUTTON_KEY]: next });
  }
  async function renderPageButton(origins?: string[]): Promise<void> {
    if (!pageOffered) return;
    const pb = await loadPageButton();
    pageOn.checked = pb.on;
    for (const i of pageSides) i.checked = i.value === pb.side;
    syncSegmented(pageSides);
    pageStatus.textContent = reachText(pb.on, origins ?? (await listOrigins()));
  }
  pageOn.addEventListener("change", () => {
    const on = pageOn.checked;
    // Asked before anything else, while the click still counts as a user gesture.
    const asked = on ? browser.permissions.request({ origins: ALL_SITES }).catch(() => false) : Promise.resolve(false);
    void (async () => {
      await asked;
      try {
        await savePageButton({ ...(await loadPageButton()), on });
      } catch {
        pageOn.checked = !on;
        pageStatus.textContent = "Could not save the change. Try again.";
        return;
      }
      // Shown on this page at once; the worker adds it to pages opened later.
      if (on && tab.id !== undefined) {
        await browser.scripting.executeScript({ target: { tabId: tab.id }, files: ["edge.js"] }).catch(() => undefined);
      }
      trace("pagebutton:" + (on ? "on" : "off"));
      await refreshSettings();
    })();
  });
  for (const i of pageSides) {
    i.addEventListener("change", () => {
      syncSegmented(pageSides);
      const side = i.value === "left" ? "left" : "right";
      void loadPageButton()
        .then((pb) => savePageButton({ ...pb, side }))
        .then(
          () => (savedMsg.textContent = "Saved."),
          () => (pageStatus.textContent = "Could not save the change. Try again."),
        );
    });
  }

  async function openSettings(focusKey = false): Promise<void> {
    closePlus();
    chatView.hidden = true;
    settingsView.hidden = false;
    savedMsg.textContent = "";
    keyError.textContent = "";
    consentStatus.textContent = "";
    await refreshSettings();
    // Focus the heading or the key field, never a <select>: on iOS a focused
    // select opens its picker immediately (T018).
    if (focusKey) keyInput.focus();
    else el("settings-title").focus();
  }
  function closeSettings(): void {
    settingsView.hidden = true;
    chatView.hidden = false;
    settingsOpen.focus();
  }
  settingsOpen.addEventListener("click", () => void openSettings());
  el("no-key-open").addEventListener("click", () => void openSettings(true));
  el("settings-back").addEventListener("click", closeSettings);
  settingsView.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && el("delete-confirm").hidden) {
      e.preventDefault();
      closeSettings();
    }
  });

  for (const i of providerInputs) {
    i.addEventListener("change", () => {
      syncSegmented(providerInputs);
      const p = chosenProvider();
      keyInput.value = "";
      keyError.textContent = "";
      keyInput.removeAttribute("aria-invalid");
      const effort = effortForId(p, DEFAULT_MODEL[p], DEFAULT_EFFORT[p], knownModels[p]) ?? "default";
      void persist({ ...settings, provider: p, model: DEFAULT_MODEL[p], effort }).then(refreshSettings);
    });
  }
  modelSel.addEventListener("change", () => {
    if (modelSel.value === OTHER) {
      modelCustomRow.hidden = false;
      modelCustom.value = "";
      modelCustom.focus();
      return;
    }
    modelCustomRow.hidden = true;
    void chooseModel(modelSel.value);
  });
  modelCustom.addEventListener("change", () => {
    const id = modelCustom.value.trim();
    if (!id) return;
    models = withModel(models, settings.provider, id);
    if (!Array.from(modelSel.options).some((o) => o.value === id)) modelSel.add(new Option(id, id), modelSel.options.length - 1);
    modelSel.value = id;
    modelCustomRow.hidden = true;
    void chooseModel(id);
  });
  effortSel.addEventListener("change", () => {
    const v = effortSel.value;
    void persist({ ...settings, effort: v === "default" || (modelInfo(settings.model)?.efforts ?? []).includes(v as Effort) ? (v as EffortSetting) : "default" });
  });
  modelsRefresh.addEventListener("click", () => void refreshModels(true));
  retentionSel.addEventListener("change", () => {
    void persist({ ...settings, retention: parseSettings({ retention: retentionSel.value }).retention }).then(refreshSettings);
  });

  keyForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const p = chosenProvider();
    const key = keyInput.value.trim();
    keyError.textContent = "";
    keyInput.removeAttribute("aria-invalid");
    if (!looksLikeKey(p, key)) {
      keyInput.setAttribute("aria-invalid", "true");
      keyError.textContent =
        "That doesn't look like an " + PROVIDER_NAME[p] + " key. " +
        (p === "anthropic" ? "Anthropic keys start with sk-ant-." : "OpenAI keys start with sk-.");
      keyInput.focus();
      return;
    }
    void (async () => {
      // Testing the key is a request to the provider, so it needs consent too.
      if (!consent.has(p) && !(await allowSharing(p))) {
        keyStatus.textContent =
          "The key was not tested or saved. Scout tests it with " + PROVIDER_NAME[p] + " only after you allow sharing.";
        return;
      }
      keySave.disabled = true;
      keyStatus.textContent = "Testing the key with " + PROVIDER_NAME[p] + "…";
      const result = await checkKey(p, key, providerFetch);
      trace("key:test " + p + " " + result);
      if (result === "valid") {
        try {
          await keychain.setKey(p, key);
          keyInput.value = "";
          await refreshKeyStatus();
          keyStatus.textContent = PROVIDER_NAME[p] + " key works and is saved in " + keyPlace() + ".";
          await connect();
          await refreshModels(true);
        } catch {
          keyError.textContent = "The key works, but it could not be saved" + (TARGET === "safari" ? " to the Keychain" : "") + ". Try again.";
        }
      } else {
        keyInput.setAttribute("aria-invalid", "true");
        keyError.textContent =
          result === "invalid"
            ? PROVIDER_NAME[p] + " rejected this key. Check it in your " + PROVIDER_NAME[p] + " account and paste it again."
            : "Could not reach " + PROVIDER_NAME[p] + ". Check your connection and try again. The key was not saved.";
        await refreshKeyStatus();
      }
      keySave.disabled = false;
    })();
  });
  keyRemove.addEventListener("click", () => {
    const p = chosenProvider();
    void keychain
      .deleteKey(p)
      .then(
        () => (keyStatus.textContent = PROVIDER_NAME[p] + " key removed from " + keyPlace() + "."),
        () => (keyError.textContent = "Could not remove the key. Try again."),
      )
      .then(async () => {
        keyRemove.hidden = true;
        await connect();
      });
  });

  // Owner bug 2026-10-19: Clear chat history showed nothing at all on Mac
  // and iPhone. The saved history is removed first and the result always
  // shows: cleared, or could not clear (also when storage never answers). The
  // tab then starts a new conversation, so nothing saved under the old one
  // can show again.
  el("history-clear").addEventListener("click", () => {
    savedMsg.textContent = "";
    trace("history:clear");
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), CLEAR_TIMEOUT_MS));
    void (storage ? Promise.race([clearHistory(storage), timeout]) : Promise.reject(new Error("no storage")))
      .then(
        async () => {
          trace("history:cleared");
          savedMsg.textContent = "Chat history cleared.";
          try {
            clearThread();
          } catch {
            trace("history:thread-not-cleared");
          }
          if (storage) conv = await startNewConversation(storage, tab.id, Date.now(), tab.incognito).catch(() => conv);
        },
        (err: unknown) => {
          trace("history:clear-failed " + (err instanceof Error ? err.message.slice(0, 60) : "unknown"));
          savedMsg.textContent = "Could not clear chat history. Try again.";
        },
      )
      .then(refreshSettings)
      .catch(() => undefined);
  });

  const deleteBtn = el<HTMLButtonElement>("delete-all");
  const deleteResult = el("delete-result");
  const deleteConfirm = el("delete-confirm");
  const confirmYes = el<HTMLButtonElement>("delete-yes");
  const confirmNo = el<HTMLButtonElement>("delete-no");
  deleteBtn.addEventListener("click", () => {
    deleteConfirm.hidden = false;
    deleteBtn.hidden = true;
    confirmNo.focus();
  });
  confirmNo.addEventListener("click", () => {
    deleteConfirm.hidden = true;
    deleteBtn.hidden = false;
    deleteBtn.focus();
  });
  confirmYes.addEventListener("click", () => {
    const none: StorageArea = { get: async () => ({}), set: async () => undefined, clear: async () => undefined };
    // A job that ends after the wipe would save into the cleared storage; delete anyway if the worker does not answer.
    void request(toWorker, "jobs.stop_all", {})
      .catch(() => undefined)
      .then(() =>
        deleteAllData({
          storage: storage ?? none,
          deleteKey: (p) => keychain.deleteKey(p),
          listGrantedOrigins: listOrigins,
          removeOrigins: async (origins) => void (await browser.permissions.remove({ origins })),
        }),
      )
      .then(async (report) => {
        const text = deleteReportText(report);
        deleteResult.textContent = text;
        deleteConfirm.hidden = true;
        deleteBtn.hidden = false;
        settings = parseSettings(undefined);
        consent.forget();
        diag?.forget();
        showLook(HOME_LOOK);
        clearThread();
        conv = "";
        await connect(false);
        status.textContent = text;
        await refreshSettings();
      });
  });

  // ---------- Start ----------
  // iPhone and iPad: keep the composer above the on-screen keyboard (src/panel/keyboard.ts).
  if (matchMedia("(pointer: coarse)").matches && window.visualViewport) {
    const typing = (): boolean => editableFocused(document.activeElement);
    fitAboveKeyboard(window, window.visualViewport, document.body, typing);
    // Summarize / Explain and the question box stay pinned to the bottom of
    // the sheet while it is dragged (src/panel/dock.ts).
    dockComposer(document, composer, el("starters"), typing);
    // Debug builds: log each drag (src/panel/drag-probe.ts).
    if (__SCOUT_DEBUG__) {
      probeDrag(window, {
        starters: () => document.getElementById("starters"),
        composer: () => document.querySelector(".composer-box"),
      }, trace);
    }
  }
  setMode("chat");
  // A key was saved last time: show the question box and this tab's chat now,
  // and let the Keychain read finish behind them (owner request 2026-10-18:
  // Scout should open at once). If the key has gone since, connect() switches
  // to the no-key screen as before.
  const likely = hintedProvider(settings.provider, keyHint);
  if (likely) {
    const pill = prettyModel(likely === settings.provider ? settings.model : DEFAULT_MODEL[likely]);
    modelPillText.textContent = pill;
    modelPill.setAttribute("aria-label", pill + ", change model or effort");
    noKey.hidden = true;
    composer.hidden = false;
    connecting = connect().finally(() => (connecting = null));
    updateEmpty();
    if (__SCOUT_DEBUG__) trace("open:shown " + Math.round(performance.now()) + " ms (from saved key hint)");
    await Promise.all([connecting, restoreConversation()]);
    // The key has gone since: back to the no-key screen, without the old chat.
    if (!session) clearThread();
  } else {
    await connect();
  }
  if (session) {
    if (!likely) await restoreConversation();
    await resumeActive();
    await resumeTask();
    await resumeCoupons();
    await loadTabs();
    // On touch devices focusing the field on open raises the keyboard over the
    // small popup; let the user tap into it instead.
    if (!matchMedia("(pointer: coarse)").matches) question.focus();
  }
  updateEmpty();
}

void main();
