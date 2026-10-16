// Popup (S04, redesigned T021–T026): chat-first panel with a Chat / Control
// Browser mode switch, saved conversation, and an in-popup Settings view.
import { AgentControl, runAgent, type AgentPage, type ApprovalRequest, type StepRecord } from "./agent/loop";
import type { Action, ActionResult } from "./actions/executor";
import type { Snapshot } from "./snapshot/snapshot";
import { CONTENT_HANDLER, type ContentRequest } from "./content-api";
import { LEGACY_SUMMARIZE_QUESTIONS, SUMMARIZE_QUESTION, type PageContext } from "./chat/prompt";
import { renderMarkdown } from "./chat/markdown";
import { runTurn } from "./chat/session";
import { mergeTabs, resolveMentions, type TabInfo } from "./chat/tabs";
import { suggestCodes } from "./coupons/codes";
import { originLabel } from "./coupons/candidates";
import { BATCH_SIZE, couponStatusText, couponSummary, runCouponSearch, type BatchState, type CartApi, type CartState } from "./coupons/finder";
import { formatRunCost } from "./cost";
import { buildReport, describeBrowser, Diagnostics, disabledRun, type RunHandle, type RunKind } from "./diagnostics";
import { createKeychain, nativeSend, type Provider } from "./keychain";
import { createProvider, type ChatMessage, type ProviderClient } from "./providers";
import { checkKey, looksLikeKey } from "./providers/keytest";
import {
  appendHistory,
  clearHistory,
  DEFAULT_MODEL,
  deleteAllData,
  deleteReportText,
  loadConversation,
  loadHistory,
  loadSettings,
  parseSettings,
  saveSettings,
  startNewConversation,
  type HistoryKind,
  type Settings,
  type StorageArea,
} from "./settings/settings";

// Model defaults live in settings.ts. The OpenAI default is UNKNOWN until
// confirmed against OpenAI docs (activity.md T005).

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error("missing #" + id);
  return node as T;
}

// Prefers the provider chosen in settings, then any provider with a saved key.
// A fallback provider uses its own default model, not the chosen model.
// Uses the chosen provider's key. Falls back to the other provider only with
// a note the popup shows, never silently (seen in T018: OpenAI chosen, Anthropic
// used with no explanation).
async function findKey(
  chosen: Settings,
): Promise<{ settings: Settings; apiKey: string; fellBackFrom?: Provider } | null> {
  const keychain = createKeychain(nativeSend);
  const order: Provider[] = chosen.provider === "openai" ? ["openai", "anthropic"] : ["anthropic", "openai"];
  for (const provider of order) {
    let apiKey: string | null = null;
    try {
      apiKey = await keychain.getKey(provider);
      trace("key:" + provider + (apiKey ? " found" : " missing"));
    } catch (err) {
      // Treat an unreadable item like a missing one.
      trace("key:" + provider + " error " + (err instanceof Error ? err.message : "unknown"));
    }
    if (apiKey) {
      const model = provider === chosen.provider ? chosen.model : DEFAULT_MODEL[provider];
      return {
        settings: { ...chosen, provider, model },
        apiKey,
        ...(provider !== chosen.provider ? { fellBackFrom: chosen.provider } : {}),
      };
    }
  }
  return null;
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

// tabId omitted: the active tab (covered by activeTab). Other tabs need a
// per-site grant requested from the user first.
async function readPage(tabId?: number): Promise<PageContext | null> {
  try {
    let id = tabId;
    if (id === undefined) {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      id = tab?.id;
    }
    if (id === undefined) return null;
    const results = await browser.scripting.executeScript({
      target: { tabId: id },
      func: () => ({
        url: location.href,
        title: document.title,
        text: document.body ? document.body.innerText : "",
      }),
    });
    return (results[0]?.result as PageContext | undefined) ?? null;
  } catch {
    return null;
  }
}

// Debug builds only: local run recorder (src/diagnostics.ts). `current` is the
// run in progress; every stage also goes to the native log. Stage names only,
// never content.
let diag: Diagnostics | null = null;
let current: RunHandle = disabledRun;

function startRun(kind: RunKind, meta: { provider?: string; model?: string; question?: string } = {}): RunHandle {
  current = diag ? diag.start(kind, meta) : disabledRun;
  return current;
}

function trace(stage: string): void {
  current.stage(stage);
  if (!__ASSISTANT_DEBUG__) return;
  void Promise.resolve()
    .then(() => browser.runtime.sendNativeMessage("com.example.AssistAnt", { type: "debug.stage", stage }))
    .catch(() => undefined);
}

function diagnosticsReport(): string {
  return buildReport(diag?.runs ?? [], {
    version: __ASSISTANT_VERSION__,
    build: __ASSISTANT_DEBUG__ ? "debug" : "release",
    browser: describeBrowser(navigator.userAgent),
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
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

// The content script is injected on demand into the active tab only.
async function tabAgentPage(): Promise<(AgentPage & { cart: CartApi }) | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return null;
  current.page(tab.url);
  const tabId = tab.id;
  await browser.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  // Same isolated world as content.js, so its handler is visible here.
  const call = async (req: ContentRequest): Promise<unknown> => {
    const [res] = await browser.scripting.executeScript({
      target: { tabId },
      // Returns an envelope so a failure inside the page is reported, not
      // silently turned into null by Safari.
      func: (r: ContentRequest, name: string) => {
        try {
          const h = (globalThis as unknown as Record<string, ((x: ContentRequest) => unknown) | undefined>)[name];
          if (typeof r !== "object" || r === null) return { ok: false, why: "no-args" };
          if (!h) {
            const loaded = (globalThis as unknown as Record<string, unknown>).__assistAntContent === true;
            return { ok: false, why: "no-handler loaded=" + String(loaded) };
          }
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
      args: [req, CONTENT_HANDLER],
    });
    const env = res?.result as { ok?: boolean; value?: unknown; why?: string } | null | undefined;
    if (!env || env.ok !== true) {
      trace("content:" + req.type + " " + (env ? env.why ?? "bad-envelope" : "null-result"));
      return null;
    }
    return env.value;
  };

  return {
    snapshot: async () => (await call({ type: "assistant:snapshot" })) as Snapshot,
    act: async (action: Action) => (await call({ type: "assistant:act", action })) as ActionResult,
    cart: {
      info: async () => (await call({ type: "assistant:cart-info" })) as CartState | null,
      update: async (discount: string) => (await call({ type: "assistant:cart-update", discount })) as CartState | { rateLimited: true } | null,
      reload: async () => void (await call({ type: "assistant:reload" })),
    },
  };
}

function describeStep(step: StepRecord): string {
  const a = step.action;
  const what = a ? a.type + ("ref" in a && a.ref ? " " + a.ref : "") : "finish";
  const res = step.result ? (step.result.ok ? "ok" : "failed: " + step.result.message) : "done";
  return (step.note ? step.note + " " : "") + "(" + what + ", " + res + ")";
}

// Granted site origins, minus the provider API hosts the manifest always holds.
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


type Mode = "chat" | "control";

interface Session {
  settings: Settings;
  provider: ProviderClient;
  fellBackFrom?: Provider;
}

const MODEL_LABEL: Record<string, string> = {
  "claude-sonnet-5-5": "Sonnet 5.5",
  "claude-opus-5-5": "Opus 5.5",
  "claude-haiku-5-5": "Haiku 5.5",
};

const prettyModel = (id: string): string => MODEL_LABEL[id] ?? id;

/** Marks the label of each checked radio in a segmented control. */
function syncSegmented(inputs: HTMLInputElement[]): void {
  for (const i of inputs) i.closest("label")?.classList.toggle("on", i.checked);
}

const CONTEXT_TURNS = 10;

async function main(): Promise<void> {
  const chatView = el("chat-view");
  const settingsView = el("settings-view");
  const thread = el("thread");
  const status = el("status");
  const log = el("log");
  const noKey = el("no-key");
  const empty = el("empty");
  const composer = el<HTMLFormElement>("composer");
  const question = el<HTMLTextAreaElement>("question");
  const send = el<HTMLButtonElement>("send");
  const stop = el<HTMLButtonElement>("stop");
  const plus = el<HTMLButtonElement>("plus");
  const plusMenu = el("plus-menu");
  const summarize = el<HTMLButtonElement>("summarize");
  const couponsRun = el<HTMLButtonElement>("coupons-run");
  const tabsToggle = el<HTMLButtonElement>("tabs-toggle");
  const tabsBox = el("tabs");
  const tabList = el("tab-list");
  const modeChip = el("mode-chip");
  const modelPill = el<HTMLButtonElement>("model-pill");
  const modeInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="mode"]'));
  const agentBox = el("agent");
  const agentPlan = el("agent-plan");
  const steps = el<HTMLOListElement>("steps");
  const agentPause = el<HTMLButtonElement>("agent-pause");
  const agentStop = el<HTMLButtonElement>("agent-stop");
  const approvalBox = el("approval");
  const approvalWhat = el("approval-what");
  const approvalReason = el("approval-reason");
  const approvalAllow = el<HTMLButtonElement>("approval-allow");
  const approvalDeny = el<HTMLButtonElement>("approval-deny");
  const couponsBox = el("coupons");
  const couponsRows = el("coupons-rows");
  const couponsSummary = el("coupons-summary");
  const couponsStop = el<HTMLButtonElement>("coupons-stop");

  const storage: StorageArea | undefined = browser.storage?.local;
  const keychain = createKeychain(nativeSend);
  let settings = parseSettings(undefined);
  if (storage) settings = await loadSettings(storage).catch(() => settings);

  let session: Session | null = null;
  const history: ChatMessage[] = [];
  let controller: AbortController | null = null;
  let control: AgentControl | null = null;
  let others: TabInfo[] = [];
  const checked = new Set<number>();

  // ---------- Diagnostics (debug builds only) ----------
  if (__ASSISTANT_DEBUG__) {
    const diagBox = el("diag");
    diag = new Diagnostics(storage);
    await diag.load();
    const diagStatus = el("diag-status");
    const diagQuestion = el<HTMLInputElement>("diag-question");
    const diagCopy = el<HTMLButtonElement>("diag-copy");
    diagQuestion.checked = diag.includeQuestion;
    diagQuestion.addEventListener("change", () => void diag?.setIncludeQuestion(diagQuestion.checked));
    diagCopy.addEventListener("click", () => void copyDiagnostics(diagCopy.parentElement ?? diagCopy, diagStatus));
    el("diag-clear").addEventListener("click", () => {
      void diag?.clear().then(() => (diagStatus.textContent = "Diagnostics cleared."));
    });
    diagBox.hidden = false;
  }

  // ---------- Thread ----------
  // Stay pinned to the newest message when the thread grows or shrinks (the
  // composer grows as you type or when Control Browser adds its chip), unless
  // the user has scrolled up to read. Scrolls the app makes always count as
  // "at the bottom"; only later scroll events can unpin it.
  let atBottom = true;
  let programmaticAt = 0;
  const scrollToEnd = (): void => {
    atBottom = true;
    programmaticAt = performance.now();
    thread.scrollTop = thread.scrollHeight;
  };
  thread.addEventListener("scroll", () => {
    if (performance.now() - programmaticAt < 150) return;
    atBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 24;
  });
  new ResizeObserver(() => {
    if (atBottom) scrollToEnd();
  }).observe(thread);

  function addMessage(kind: "user" | "assistant" | "error", text: string, opts: { mode?: string } = {}): HTMLElement {
    const node = document.createElement("div");
    node.className = "msg " + kind;
    if (kind === "assistant") renderMarkdown(document, node, text);
    else if (kind === "user" && opts.mode) {
      const label = document.createElement("span");
      label.className = "mode";
      label.textContent = opts.mode;
      node.append(label, document.createTextNode(text));
    } else if (kind === "error" && __ASSISTANT_DEBUG__) {
      // Own element, so the message reads on its own next to the copy button.
      const span = document.createElement("span");
      span.textContent = text;
      node.appendChild(span);
    } else node.textContent = text;
    if (kind === "error") {
      current.error(text);
      if (__ASSISTANT_DEBUG__) {
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
    const busyCards = !agentBox.hidden || !approvalBox.hidden || !couponsBox.hidden;
    empty.hidden = !session || log.childElementCount > 0 || busyCards;
  }

  async function saveEntry(kind: HistoryKind, q: string, answer: string): Promise<void> {
    if (!storage) return;
    await appendHistory(storage, settings.retention, { at: Date.now(), question: q, answer, kind }).catch(() => undefined);
  }

  async function restoreConversation(): Promise<void> {
    if (!storage) return;
    const entries = await loadConversation(storage, settings.retention, Date.now()).catch(() => []);
    history.length = 0;
    for (const e of entries) {
      const mode = e.kind === "agent" ? "Control Browser" : e.kind === "coupons" ? "Find coupons" : undefined;
      const isSummary = e.question === SUMMARIZE_QUESTION || LEGACY_SUMMARIZE_QUESTIONS.includes(e.question);
      addMessage("user", isSummary ? "Summarize page" : e.question, mode ? { mode } : {});
      addMessage("assistant", e.answer);
      if (!e.kind || e.kind === "chat") history.push({ role: "user", content: e.question }, { role: "assistant", content: e.answer });
    }
    history.splice(0, Math.max(0, history.length - CONTEXT_TURNS * 2));
    if (entries.length) trace("conversation:restored " + entries.length);
    // Again after layout and images settle, so the newest message is in view.
    requestAnimationFrame(scrollToEnd);
    window.addEventListener("load", scrollToEnd, { once: true });
  }

  function clearThread(): void {
    log.replaceChildren();
    steps.replaceChildren();
    couponsRows.replaceChildren();
    agentBox.hidden = approvalBox.hidden = couponsBox.hidden = true;
    history.length = 0;
    updateEmpty();
  }

  // ---------- Session (provider + key) ----------
  let fallbackNotice: HTMLElement | null = null;

  // record=false after Delete all data, so no new diagnostics land in the
  // storage that was just cleared.
  async function connect(record = true): Promise<void> {
    if (record) startRun("startup", { provider: settings.provider, model: settings.model });
    else current = disabledRun;
    const found = await findKey(settings);
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
    session = {
      settings: found.settings,
      provider: createProvider(found.settings.provider, { apiKey: found.apiKey, fetch: (i, init) => fetch(i, init) }),
      ...(found.fellBackFrom ? { fellBackFrom: found.fellBackFrom } : {}),
    };
    noKey.hidden = true;
    composer.hidden = false;
    modelPill.textContent = prettyModel(session.settings.model);
    // Accessible name starts with the visible text (WCAG 2.5.3 Label in Name).
    modelPill.setAttribute("aria-label", prettyModel(session.settings.model) + ", change model");
    status.textContent = "Ready. Using " + session.settings.provider + " " + session.settings.model + ".";
    current.finish(found.fellBackFrom ? "ready_fallback" : "ready", status.textContent);
    if (found.fellBackFrom) {
      fallbackNotice = addMessage(
        "error",
        "No " + PROVIDER_NAME[found.fellBackFrom] + " key is saved, so AssistAnt is using your " +
          PROVIDER_NAME[session.settings.provider] + " key. Add your " + PROVIDER_NAME[found.fellBackFrom] + " key in Settings to use it.",
      );
    }
    updateEmpty();
  }

  // ---------- Composer ----------
  const mode = (): Mode => (modeInputs.find((i) => i.checked)?.value === "control" ? "control" : "chat");

  function setMode(next: Mode): void {
    for (const i of modeInputs) i.checked = i.value === next;
    syncSegmented(modeInputs);
    modeChip.hidden = next !== "control";
    question.placeholder = next === "control" ? "Tell AssistAnt what to do on this page…" : "Ask anything…";
    send.setAttribute("aria-label", next === "control" ? "Start task" : "Send");
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

  function closePlus(focusButton = false): void {
    plusMenu.hidden = true;
    plus.setAttribute("aria-expanded", "false");
    if (focusButton) plus.focus();
  }
  plus.addEventListener("click", () => {
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
    if (!plusMenu.hidden && !plusMenu.contains(e.target as Node) && e.target !== plus && !plus.contains(e.target as Node)) closePlus();
  });

  function setBusy(busy: boolean): void {
    send.hidden = busy;
    stop.hidden = !busy;
    plus.disabled = busy;
    question.disabled = busy;
    for (const i of modeInputs) i.disabled = busy;
    for (const c of empty.querySelectorAll<HTMLButtonElement>("button")) c.disabled = busy;
    if (busy) stop.focus();
    else if (!matchMedia("(pointer: coarse)").matches) question.focus();
  }

  async function loadTabs(): Promise<void> {
    others = (await listTabs()).filter((t) => !t.active);
    tabList.replaceChildren();
    for (const t of others) {
      const label = document.createElement("label");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.addEventListener("change", () => (box.checked ? checked.add(t.id) : checked.delete(t.id)));
      label.append(box, document.createTextNode(t.title));
      tabList.appendChild(label);
    }
    tabsToggle.disabled = others.length === 0;
  }
  tabsToggle.addEventListener("click", () => {
    tabsBox.hidden = !tabsBox.hidden;
    tabsToggle.setAttribute("aria-expanded", String(!tabsBox.hidden));
    closePlus();
    if (!tabsBox.hidden) tabList.querySelector<HTMLInputElement>("input")?.focus();
    else question.focus();
  });

  // ---------- Chat ----------
  async function ask(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || controller || control || !session) return;
    const s = session;
    const extra = mergeTabs(
      others.filter((t) => checked.has(t.id)),
      resolveMentions(trimmed, others),
    );
    // Asked first: the permission prompt needs this click's user gesture.
    let granted = extra.length === 0;
    if (!granted) {
      const origins = [...new Set(extra.map((t) => new URL(t.url).origin + "/*"))];
      granted = await browser.permissions.request({ origins }).catch(() => false);
    }
    const isSummary = trimmed === SUMMARIZE_QUESTION;
    startRun(isSummary ? "summarize" : "ask", { provider: s.settings.provider, model: s.settings.model, question: trimmed });
    trace("tabs:extra " + extra.length + (extra.length ? (granted ? " granted" : " declined") : ""));
    addMessage("user", isSummary ? "Summarize page" : trimmed);
    question.value = "";
    autosize();
    const bubble = addMessage("assistant", "");
    bubble.textContent = "Thinking…";
    status.textContent = "Reading the page and waiting for the answer.";
    controller = new AbortController();
    setBusy(true);
    const page = await readPage();
    current.page(page?.url);
    trace(page ? "page:read ok" : "page:read failed");
    if (!page) status.textContent = "Could not read this page. Answering without it.";
    const extraPages: PageContext[] = [];
    if (granted) {
      for (const t of extra) {
        const p = await readPage(t.id);
        if (p) extraPages.push(p);
      }
    }
    if (extra.length) trace("tabs:read " + extraPages.length + "/" + extra.length);
    // Shown in the conversation, not only the status line, which the answer's
    // "Done" overwrites. iOS Safari cannot read background tabs (seen in T018).
    if (extra.length && extraPages.length < extra.length) {
      const missed = extra.filter((t) => !extraPages.some((p) => p.url === t.url)).map((t) => t.title);
      addMessage(
        "error",
        "Could not read: " + missed.join(", ") +
          ". The answer uses only the pages listed as read. Site access may have been declined, or this browser cannot read background tabs (Safari on iPhone and iPad).",
      );
    }
    trace("model:start");
    const result = await runTurn({
      provider: s.provider,
      model: s.settings.model,
      history,
      question: trimmed,
      page,
      extraPages,
      signal: controller.signal,
      onText: (full) => {
        renderMarkdown(document, bubble, full);
        scrollToEnd();
      },
    });
    controller = null;
    if (result.ok) {
      history.push({ role: "user", content: trimmed }, { role: "assistant", content: result.text });
      history.splice(0, Math.max(0, history.length - CONTEXT_TURNS * 2));
      await saveEntry("chat", trimmed, result.text);
      status.textContent = "Done." + (result.usage ? " " + formatRunCost(s.settings.model, result.usage) : "");
      current.finish("done", "Answered (" + result.text.length + " characters).", result.usage);
    } else {
      if (result.partial) renderMarkdown(document, bubble, result.partial);
      else bubble.remove();
      addMessage("error", result.error);
      status.textContent = "The request failed.";
      current.finish("error", result.error);
    }
    setBusy(false);
  }

  // ---------- Approval (S06): the run waits here. Deny is the default focus. ----------
  function askApproval(req: ApprovalRequest): Promise<boolean> {
    return new Promise((resolve) => {
      const a = req.action;
      approvalWhat.textContent =
        "Agent wants to " + a.type + (req.target ? ' "' + req.target + '"' : "") + ("ref" in a && a.ref ? " (" + a.ref + ")" : "") + ".";
      approvalReason.textContent = req.classification.reason ?? "";
      approvalBox.hidden = false;
      scrollToEnd();
      status.textContent = "Waiting for your approval.";
      approvalDeny.focus();
      trace("approval:asked " + a.type + " " + (req.classification.kind ?? "sensitive"));
      const done = (ok: boolean): void => {
        trace("approval:" + (ok ? "allowed" : "denied"));
        approvalAllow.removeEventListener("click", onAllow);
        approvalDeny.removeEventListener("click", onDeny);
        agentStop.removeEventListener("click", onDeny);
        approvalBox.hidden = true;
        status.textContent = "Agent running.";
        resolve(ok);
      };
      const onAllow = (): void => done(true);
      const onDeny = (): void => done(false);
      approvalAllow.addEventListener("click", onAllow);
      approvalDeny.addEventListener("click", onDeny);
      agentStop.addEventListener("click", onDeny);
    });
  }

  // ---------- Control Browser ----------
  async function runTask(goal: string): Promise<void> {
    const trimmed = goal.trim();
    if (!trimmed || controller || control || !session) return;
    const s = session;
    startRun("agent", { provider: s.settings.provider, model: s.settings.model, question: trimmed });
    const page = await tabAgentPage().catch(() => null);
    if (!page) {
      addMessage("error", "Could not reach this page. Reload it and try again.");
      current.finish("error", "Could not reach this page.");
      return;
    }
    addMessage("user", trimmed, { mode: "Control Browser" });
    question.value = "";
    autosize();
    control = new AgentControl();
    steps.replaceChildren();
    agentPlan.textContent = "";
    couponsBox.hidden = true;
    agentBox.hidden = false;
    agentPause.textContent = "Pause";
    send.hidden = true;
    plus.disabled = true;
    status.textContent = "Agent running.";
    scrollToEnd();
    agentStop.focus();
    let outcome: Awaited<ReturnType<typeof runAgent>>;
    try {
      outcome = await runAgent({
        provider: s.provider,
        model: s.settings.model,
        goal: trimmed,
        page,
        control,
        trace,
        webSearch: true,
        approve: askApproval,
        onEvent: (e) => {
          if (e.type === "plan") agentPlan.textContent = e.text;
          else if (e.type === "step_end") {
            const li = document.createElement("li");
            li.textContent = describeStep(e.step);
            steps.appendChild(li);
            scrollToEnd();
            const a = e.step.action;
            trace(
              "step " + e.step.index + " " + (a ? a.type : "finish") +
                (e.step.result ? (e.step.result.ok ? " ok" : " failed:" + (e.step.result.error ?? "")) : ""),
            );
          }
        },
      });
    } catch {
      // Never leave the popup stuck on "Agent running." (seen on iOS, T018).
      outcome = {
        status: "error",
        steps: [],
        usage: { inputTokens: 0, outputTokens: 0 },
        message: "The task stopped because of an unexpected error. Nothing more was done on the page.",
      };
    }
    control = null;
    addMessage(outcome.status === "done" ? "assistant" : "error", outcome.message);
    current.finish(outcome.status, outcome.message, outcome.usage);
    await saveEntry("agent", trimmed, outcome.message);
    status.textContent = "Agent " + outcome.status + ". " + formatRunCost(s.settings.model, outcome.usage);
    send.hidden = false;
    plus.disabled = false;
    if (!matchMedia("(pointer: coarse)").matches) question.focus();
  }

  agentPause.addEventListener("click", () => {
    if (!control) return;
    if (control.isPaused) {
      control.resume();
      agentPause.textContent = "Pause";
      status.textContent = "Agent running.";
    } else {
      control.pause();
      agentPause.textContent = "Resume";
      status.textContent = "Agent paused after the current step.";
    }
  });
  agentStop.addEventListener("click", () => {
    trace("ui:stop-click " + (control ? "has-control" : "no-control"));
    control?.stop();
  });

  // ---------- Coupons (S07, T031): find many codes, test them in batches of 25. ----------
  const couponsMore = el("coupons-more");
  const couponsMoreText = el("coupons-more-text");
  const couponsMoreYes = el<HTMLButtonElement>("coupons-more-yes");
  const couponsMoreNo = el<HTMLButtonElement>("coupons-more-no");

  function askMoreCodes(state: BatchState): Promise<boolean> {
    return new Promise((resolve) => {
      const next = Math.min(BATCH_SIZE, state.remaining);
      couponsMoreText.textContent = state.best
        ? "Tried " + state.tried + " codes. Best so far: " + state.best.code + " saves $" + (state.best.saving ?? 0).toFixed(2) +
          ". Try " + next + " more to look for a bigger saving?"
        : "We've tried " + state.tried + " codes and none lowered your total. Would you like to try " + next + " more?";
      couponsMoreYes.textContent = "Try " + next + " more";
      couponsMore.hidden = false;
      status.textContent = "Waiting for you: try more codes?";
      scrollToEnd();
      couponsMoreYes.focus();
      trace("coupons:ask-more tried=" + state.tried + " remaining=" + state.remaining);
      const done = (ok: boolean): void => {
        couponsMore.hidden = true;
        couponsMoreYes.removeEventListener("click", yes);
        couponsMoreNo.removeEventListener("click", no);
        couponsStop.removeEventListener("click", no);
        trace("coupons:more " + (ok ? "yes" : "no"));
        if (ok) couponsStop.focus();
        resolve(ok);
      };
      const yes = (): void => done(true);
      const no = (): void => done(false);
      couponsMoreYes.addEventListener("click", yes);
      couponsMoreNo.addEventListener("click", no);
      couponsStop.addEventListener("click", no);
    });
  }

  function addAttemptRow(a: { code: string; total: number | null; note: string; origin: Parameters<typeof originLabel>[0]["origin"]; sourceUrl?: string }): void {
    const tr = document.createElement("tr");
    for (const t of [a.code, a.total === null ? "unknown" : "$" + a.total.toFixed(2), a.note]) {
      const td = document.createElement("td");
      td.textContent = t;
      tr.appendChild(td);
    }
    const src = document.createElement("td");
    const label = originLabel(a);
    if (a.sourceUrl && (a.origin === "sourced" || a.origin === "unverified")) {
      const link = document.createElement("a");
      link.href = a.sourceUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = label;
      src.appendChild(link);
    } else src.textContent = label;
    tr.appendChild(src);
    couponsRows.appendChild(tr);
  }

  async function runCoupons(): Promise<void> {
    if (controller || control || !session) return;
    const s = session;
    startRun("coupons", { provider: s.settings.provider, model: s.settings.model });
    const page = await tabAgentPage().catch(() => null);
    if (!page) {
      addMessage("error", "Could not reach this page. Reload it and try again.");
      current.finish("error", "Could not reach this page.");
      return;
    }
    const ask = "Find the best coupon for this cart.";
    addMessage("user", ask, { mode: "Find coupons" });
    control = new AgentControl();
    couponsRows.replaceChildren();
    couponsMore.hidden = true;
    agentBox.hidden = true;
    couponsBox.hidden = false;
    couponsSummary.textContent = "Searching the web for codes…";
    send.hidden = true;
    plus.disabled = true;
    status.textContent = "Finding coupons. This can take up to a minute.";
    scrollToEnd();
    couponsStop.focus();
    const onStop = (): void => control?.stop();
    couponsStop.addEventListener("click", onStop);
    let used = { inputTokens: 0, outputTokens: 0 };
    let summary = "";
    try {
      const snap = await page.snapshot();
      const merchant = new URL(snap.url).hostname;
      const ac = new AbortController();
      couponsStop.addEventListener("click", () => ac.abort(), { once: true });
      trace("coupons:search");
      const sug = await suggestCodes(s.provider, s.settings.model, merchant, ac.signal);
      used = { inputTokens: sug.inputTokens, outputTokens: sug.outputTokens };
      trace("coupons:candidates found=" + sug.found + " guessed=" + sug.guessed);
      couponsSummary.textContent =
        "Found " + sug.found + " code" + (sug.found === 1 ? "" : "s") + " online and " + sug.guessed + " common guesses. Testing them on your cart…";
      const outcome = await runCouponSearch({
        page,
        codes: sug.codes,
        control,
        delayMs: 250,
        askMore: askMoreCodes,
        onAttempt: (a, index, total) => {
          trace("coupons:attempt " + index + (a.accepted === false ? " rejected" : a.saving && a.saving > 0 ? " saving" : " none"));
          couponsSummary.textContent = "Testing code " + index + " of " + total + "…";
          addAttemptRow(a);
          scrollToEnd();
        },
      });
      trace("coupons:method " + (outcome.method ?? "none") + " status " + outcome.status);
      summary = couponSummary(outcome);
      couponsSummary.textContent = outcome.best
        ? "Best: " + outcome.best.code + (outcome.applied ? " (applied)" : "")
        : outcome.status === "done" || outcome.status === "stopped"
          ? "No code lowered the total."
          : outcome.message;
      status.textContent = couponStatusText(outcome.status) + " " + formatRunCost(s.settings.model, used);
      current.finish(outcome.status, outcome.message, used);
      if (outcome.status === "no_form" || outcome.status === "error" || outcome.status === "no_codes") addMessage("error", summary);
      else addMessage("assistant", summary);
    } catch {
      summary = "Could not finish the coupon search. Nothing was ordered.";
      couponsSummary.textContent = summary;
      status.textContent = couponStatusText("error");
      addMessage("error", summary);
      current.finish("error", summary, used);
    }
    couponsMore.hidden = true;
    await saveEntry("coupons", ask, summary);
    couponsStop.removeEventListener("click", onStop);
    control = null;
    send.hidden = false;
    plus.disabled = false;
    if (!matchMedia("(pointer: coarse)").matches) question.focus();
  }

  // ---------- Wiring ----------
  composer.addEventListener("submit", (event) => {
    event.preventDefault();
    closePlus();
    if (mode() === "control") void runTask(question.value);
    else void ask(question.value);
  });
  question.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      composer.requestSubmit();
    }
  });
  summarize.addEventListener("click", () => {
    closePlus();
    void ask(SUMMARIZE_QUESTION);
  });
  couponsRun.addEventListener("click", () => {
    closePlus();
    void runCoupons();
  });
  for (const chip of empty.querySelectorAll<HTMLButtonElement>("button[data-prompt]")) {
    chip.addEventListener("click", () => {
      const p = chip.dataset.prompt ?? "";
      if (p === "summarize") void ask(SUMMARIZE_QUESTION);
      else if (p === "coupons") void runCoupons();
      else void ask(p);
    });
  }
  stop.addEventListener("click", () => controller?.abort());
  el("new-chat").addEventListener("click", () => {
    if (controller || control) return;
    clearThread();
    if (storage) void startNewConversation(storage, Date.now());
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
  const modelIn = el<HTMLInputElement>("set-model");
  const modelHelp = el("model-help");
  const retentionSel = el<HTMLSelectElement>("set-retention");
  const savedMsg = el("settings-saved");
  const sites = el("site-list");
  const historyCount = el("history-count");

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
    keyStatus.textContent = has ? PROVIDER_NAME[p] + " key saved in your Keychain." : "No " + PROVIDER_NAME[p] + " key saved yet.";
    keyRemove.hidden = !has;
    keyInput.placeholder = has ? "Paste a new key to replace it" : p === "anthropic" ? "sk-ant-…" : "sk-…";
  }

  async function refreshSettings(): Promise<void> {
    for (const i of providerInputs) i.checked = i.value === settings.provider;
    syncSegmented(providerInputs);
    modelIn.value = settings.model;
    modelHelp.textContent = "Default for " + PROVIDER_NAME[settings.provider] + ": " + DEFAULT_MODEL[settings.provider] + ".";
    retentionSel.value = settings.retention;
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
  }

  async function openSettings(focusKey = false): Promise<void> {
    closePlus();
    chatView.hidden = true;
    settingsView.hidden = false;
    savedMsg.textContent = "";
    keyError.textContent = "";
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
  modelPill.addEventListener("click", () => void openSettings());
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
      void persist({ ...settings, provider: p, model: DEFAULT_MODEL[p] }).then(refreshSettings);
    });
  }
  modelIn.addEventListener("change", () => void persist({ ...settings, model: modelIn.value }));
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
    keySave.disabled = true;
    keyStatus.textContent = "Testing the key with " + PROVIDER_NAME[p] + "…";
    void (async () => {
      const result = await checkKey(p, key, (i, init) => fetch(i, init));
      trace("key:test " + p + " " + result);
      if (result === "valid") {
        try {
          await keychain.setKey(p, key);
          keyInput.value = "";
          await refreshKeyStatus();
          keyStatus.textContent = PROVIDER_NAME[p] + " key works and is saved in your Keychain.";
          await connect();
        } catch {
          keyError.textContent = "The key works, but it could not be saved to the Keychain. Try again.";
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
        () => (keyStatus.textContent = PROVIDER_NAME[p] + " key removed from your Keychain."),
        () => (keyError.textContent = "Could not remove the key. Try again."),
      )
      .then(async () => {
        keyRemove.hidden = true;
        await connect();
      });
  });

  el("history-clear").addEventListener("click", () => {
    if (!storage) return;
    void clearHistory(storage).then(async () => {
      clearThread();
      savedMsg.textContent = "Chat history cleared.";
      await refreshSettings();
    });
  });

  const deleteBtn = el<HTMLButtonElement>("delete-all");
  const deleteResult = el("delete-result");
  const confirmBox = el("delete-confirm");
  const confirmYes = el<HTMLButtonElement>("delete-yes");
  const confirmNo = el<HTMLButtonElement>("delete-no");
  deleteBtn.addEventListener("click", () => {
    confirmBox.hidden = false;
    deleteBtn.hidden = true;
    confirmNo.focus();
  });
  confirmNo.addEventListener("click", () => {
    confirmBox.hidden = true;
    deleteBtn.hidden = false;
    deleteBtn.focus();
  });
  confirmYes.addEventListener("click", () => {
    const none: StorageArea = { get: async () => ({}), set: async () => undefined, clear: async () => undefined };
    void deleteAllData({
      storage: storage ?? none,
      deleteKey: (p) => keychain.deleteKey(p),
      listGrantedOrigins: listOrigins,
      removeOrigins: async (origins) => void (await browser.permissions.remove({ origins })),
    }).then(async (report) => {
      const text = deleteReportText(report);
      deleteResult.textContent = text;
      confirmBox.hidden = true;
      deleteBtn.hidden = false;
      settings = parseSettings(undefined);
      diag?.forget();
      clearThread();
      await connect(false);
      status.textContent = text;
      await refreshSettings();
    });
  });

  // ---------- Start ----------
  setMode("chat");
  await connect();
  if (session) {
    await restoreConversation();
    await loadTabs();
    // On touch devices focusing the field on open raises the keyboard over the
    // small popup; let the user tap into it instead.
    if (!matchMedia("(pointer: coarse)").matches) question.focus();
  }
  updateEmpty();
}

void main();
