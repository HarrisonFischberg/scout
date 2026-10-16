// Popup chat (S04): ask about the current page, summarize, streamed Markdown.
import { AgentControl, runAgent, type AgentPage, type ApprovalRequest, type StepRecord } from "./agent/loop";
import type { Action, ActionResult } from "./actions/executor";
import type { Snapshot } from "./snapshot/snapshot";
import { SUMMARIZE_QUESTION, type PageContext } from "./chat/prompt";
import { renderMarkdown } from "./chat/markdown";
import { runTurn } from "./chat/session";
import { mergeTabs, resolveMentions, type TabInfo } from "./chat/tabs";
import { suggestCodes } from "./coupons/codes";
import { runCouponSearch } from "./coupons/finder";
import { formatRunCost } from "./cost";
import { createKeychain, nativeSend, type Provider } from "./keychain";
import { createProvider, type ChatMessage } from "./providers";
import {
  appendHistory,
  DEFAULT_MODEL,
  deleteAllData,
  loadHistory,
  loadSettings,
  parseSettings,
  saveSettings,
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
async function findKey(chosen: Settings): Promise<{ settings: Settings; apiKey: string } | null> {
  const keychain = createKeychain(nativeSend);
  const order: Provider[] = chosen.provider === "openai" ? ["openai", "anthropic"] : ["anthropic", "openai"];
  for (const provider of order) {
    try {
      const apiKey = await keychain.getKey(provider);
      if (apiKey) {
        const model = provider === chosen.provider ? chosen.model : DEFAULT_MODEL[provider];
        return { settings: { ...chosen, provider, model }, apiKey };
      }
    } catch {
      // Treat an unreadable item like a missing one.
    }
  }
  return null;
}

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

// The content script is injected on demand into the active tab only.
async function tabAgentPage(): Promise<AgentPage | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return null;
  const tabId = tab.id;
  await browser.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  return {
    snapshot: async () => (await browser.tabs.sendMessage(tabId, { type: "assistant:snapshot" })) as Snapshot,
    act: async (action: Action) =>
      (await browser.tabs.sendMessage(tabId, { type: "assistant:act", action })) as ActionResult,
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

// S08: provider, model, retention, per-site access, Delete all data.
function setupSettings(storage: StorageArea | undefined, initial: Settings, status: HTMLElement): void {
  const openBtn = el<HTMLButtonElement>("settings-open");
  const panel = el("settings");
  const form = el<HTMLFormElement>("settings-form");
  const providerSel = el<HTMLSelectElement>("set-provider");
  const modelIn = el<HTMLInputElement>("set-model");
  const retentionSel = el<HTMLSelectElement>("set-retention");
  const savedMsg = el("settings-saved");
  const sites = el("site-list");
  const historyCount = el("history-count");
  const deleteBtn = el<HTMLButtonElement>("delete-all");
  const confirmBox = el("delete-confirm");
  const confirmYes = el<HTMLButtonElement>("delete-yes");
  const confirmNo = el<HTMLButtonElement>("delete-no");

  providerSel.value = initial.provider;
  modelIn.value = initial.model;
  retentionSel.value = initial.retention;

  async function refresh(): Promise<void> {
    const retention = parseSettings({ retention: retentionSel.value }).retention;
    const entries = storage ? await loadHistory(storage, retention, Date.now()).catch(() => []) : [];
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
      btn.textContent = "Remove";
      btn.setAttribute("aria-label", "Remove access to " + origin);
      btn.addEventListener("click", () => {
        void browser.permissions.remove({ origins: [origin] }).then(refresh, refresh);
      });
      li.append(origin + " ", btn);
      sites.appendChild(li);
    }
  }

  openBtn.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    openBtn.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) {
      void refresh();
      providerSel.focus();
    }
  });

  providerSel.addEventListener("change", () => {
    modelIn.value = DEFAULT_MODEL[providerSel.value === "openai" ? "openai" : "anthropic"];
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const next = parseSettings({
      provider: providerSel.value,
      model: modelIn.value,
      retention: retentionSel.value,
    });
    const done = storage ? saveSettings(storage, next) : Promise.reject(new Error("no storage"));
    done.then(
      () => {
        savedMsg.textContent = "Saved. Reopen the popup to use the new provider and model.";
        void refresh();
      },
      () => {
        savedMsg.textContent = "Could not save settings.";
      },
    );
  });

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
    const keychain = createKeychain(nativeSend);
    const none: StorageArea = { get: async () => ({}), set: async () => undefined, clear: async () => undefined };
    void deleteAllData({
      storage: storage ?? none,
      deleteKey: (p) => keychain.deleteKey(p),
      listGrantedOrigins: listOrigins,
      removeOrigins: async (origins) => void (await browser.permissions.remove({ origins })),
    }).then((report) => {
      const failed = Object.entries(report)
        .filter(([, ok]) => !ok)
        .map(([k]) => k);
      status.textContent = failed.length
        ? "Some data could not be deleted: " + failed.join(", ") + "."
        : "All AssistAnt data on this device was deleted. Reopen the popup.";
      confirmBox.hidden = true;
      deleteBtn.hidden = false;
      void refresh();
    });
  });
}

async function main(): Promise<void> {
  const status = el("status");
  const log = el("log");
  const noKey = el("no-key");
  const composer = el<HTMLFormElement>("composer");
  const question = el<HTMLTextAreaElement>("question");
  const send = el<HTMLButtonElement>("send");
  const summarize = el<HTMLButtonElement>("summarize");
  const stop = el<HTMLButtonElement>("stop");
  const agentRun = el<HTMLButtonElement>("agent-run");
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

  // S06: the run waits here until the user answers. Deny is the default focus.
  function askApproval(req: ApprovalRequest): Promise<boolean> {
    return new Promise((resolve) => {
      const a = req.action;
      approvalWhat.textContent =
        "Agent wants to " + a.type + (req.target ? ' "' + req.target + '"' : "") + ("ref" in a && a.ref ? " (" + a.ref + ")" : "") + ".";
      approvalReason.textContent = req.classification.reason ?? "";
      approvalBox.hidden = false;
      status.textContent = "Waiting for your approval.";
      approvalDeny.focus();
      const done = (ok: boolean): void => {
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

  const storage: StorageArea | undefined = browser.storage?.local;
  let chosen = parseSettings(undefined);
  if (storage) chosen = await loadSettings(storage).catch(() => chosen);
  setupSettings(storage, chosen, status);

  const found = await findKey(chosen);
  if (!found) {
    status.textContent = "No API key saved.";
    noKey.hidden = false;
    return;
  }
  const { settings, apiKey } = found;
  const provider = createProvider(settings.provider, {
    apiKey,
    fetch: (input, init) => fetch(input, init),
  });
  status.textContent = "Ready. Using " + settings.provider + " " + settings.model + ".";
  composer.hidden = false;
  question.focus();

  const allTabs = await listTabs();
  const others = allTabs.filter((t) => !t.active);
  const tabsBox = el("tabs");
  const tabList = el("tab-list");
  const checked = new Set<number>();
  for (const t of others) {
    const label = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.addEventListener("change", () => (box.checked ? checked.add(t.id) : checked.delete(t.id)));
    label.append(box, document.createTextNode(t.title));
    tabList.appendChild(label);
  }
  tabsBox.hidden = others.length === 0;

  const history: ChatMessage[] = [];
  let controller: AbortController | null = null;

  function addMessage(kind: "user" | "assistant" | "error", text: string): HTMLElement {
    const node = document.createElement("div");
    node.className = "msg " + kind;
    if (kind === "assistant") renderMarkdown(document, node, text);
    else node.textContent = text;
    log.appendChild(node);
    log.scrollTop = log.scrollHeight;
    return node;
  }

  function setBusy(busy: boolean): void {
    send.disabled = busy;
    summarize.disabled = busy;
    question.disabled = busy;
    stop.hidden = !busy;
    if (busy) stop.focus();
    else question.focus();
  }

  async function ask(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || controller) return;
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
    addMessage("user", trimmed);
    question.value = "";
    const bubble = addMessage("assistant", "");
    bubble.textContent = "Thinking…";
    status.textContent = "Reading the page and waiting for the answer.";
    controller = new AbortController();
    setBusy(true);
    const page = await readPage();
    if (!page) status.textContent = "Could not read this page. Answering without it.";
    const extraPages: PageContext[] = [];
    if (granted) {
      for (const t of extra) {
        const p = await readPage(t.id);
        if (p) extraPages.push(p);
      }
    }
    if (extra.length && extraPages.length < extra.length) {
      status.textContent =
        "Read " + extraPages.length + " of " + extra.length + " extra tabs. Site access may have been declined.";
    }
    const result = await runTurn({
      provider,
      model: settings.model,
      history,
      question: trimmed,
      page,
      extraPages,
      signal: controller.signal,
      onText: (full) => renderMarkdown(document, bubble, full),
    });
    controller = null;
    if (result.ok) {
      history.push({ role: "user", content: trimmed }, { role: "assistant", content: result.text });
      if (storage) {
        await appendHistory(storage, settings.retention, {
          at: Date.now(),
          question: trimmed,
          answer: result.text,
        }).catch(() => undefined);
      }
      status.textContent =
        "Done." + (result.usage ? " " + formatRunCost(settings.model, result.usage) : "");
    } else {
      if (result.partial) renderMarkdown(document, bubble, result.partial);
      else bubble.remove();
      addMessage("error", result.error);
      status.textContent = "The request failed.";
    }
    setBusy(false);
  }

  let control: AgentControl | null = null;

  async function runTask(goal: string): Promise<void> {
    const trimmed = goal.trim();
    if (!trimmed || controller || control) return;
    const page = await tabAgentPage().catch(() => null);
    if (!page) {
      addMessage("error", "Could not reach this page. Reload it and try again.");
      return;
    }
    addMessage("user", trimmed);
    question.value = "";
    control = new AgentControl();
    steps.replaceChildren();
    agentPlan.textContent = "";
    agentBox.hidden = false;
    agentPause.textContent = "Pause";
    agentRun.disabled = send.disabled = summarize.disabled = true;
    status.textContent = "Agent running.";
    agentStop.focus();
    const outcome = await runAgent({
      provider,
      model: settings.model,
      goal: trimmed,
      page,
      control,
      approve: askApproval,
      onEvent: (e) => {
        if (e.type === "plan") agentPlan.textContent = e.text;
        else if (e.type === "step_end") {
          const li = document.createElement("li");
          li.textContent = describeStep(e.step);
          steps.appendChild(li);
        }
      },
    });
    control = null;
    addMessage(outcome.status === "done" ? "assistant" : "error", outcome.message);
    status.textContent =
      "Agent " + outcome.status + ". " + formatRunCost(settings.model, outcome.usage);
    agentRun.disabled = send.disabled = summarize.disabled = false;
    question.focus();
  }

  const couponsRun = el<HTMLButtonElement>("coupons-run");
  const couponsBox = el("coupons");
  const couponsRows = el("coupons-rows");
  const couponsSummary = el("coupons-summary");
  const couponsStop = el<HTMLButtonElement>("coupons-stop");

  // S07: codes are tried by plain code, one at a time; the model only suggests them.
  async function runCoupons(): Promise<void> {
    if (controller || control) return;
    const page = await tabAgentPage().catch(() => null);
    if (!page) {
      addMessage("error", "Could not reach this page. Reload it and try again.");
      return;
    }
    control = new AgentControl();
    couponsRows.replaceChildren();
    couponsBox.hidden = false;
    couponsSummary.textContent = "Asking the model for codes…";
    agentRun.disabled = send.disabled = summarize.disabled = couponsRun.disabled = true;
    status.textContent = "Finding coupons.";
    couponsStop.focus();
    const onStop = (): void => control?.stop();
    couponsStop.addEventListener("click", onStop);
    let used = { inputTokens: 0, outputTokens: 0 };
    try {
      const snap = await page.snapshot();
      const merchant = new URL(snap.url).hostname;
      const ac = new AbortController();
      couponsStop.addEventListener("click", () => ac.abort(), { once: true });
      const sug = await suggestCodes(provider, settings.model, merchant, ac.signal);
      used = { inputTokens: sug.inputTokens, outputTokens: sug.outputTokens };
      couponsSummary.textContent = "Trying " + sug.codes.length + " codes…";
      const outcome = await runCouponSearch({
        page,
        codes: sug.codes,
        ...(control ? { control } : {}),
        onAttempt: (a) => {
          const tr = document.createElement("tr");
          for (const t of [a.code, a.total === null ? "unknown" : "$" + a.total.toFixed(2), a.note]) {
            const td = document.createElement("td");
            td.textContent = t;
            tr.appendChild(td);
          }
          couponsRows.appendChild(tr);
        },
      });
      couponsSummary.textContent =
        outcome.status === "done" && outcome.baseline !== null
          ? "Started at $" + outcome.baseline.toFixed(2) + ". " + outcome.message
          : outcome.message;
      status.textContent = "Coupons " + outcome.status + ". " + formatRunCost(settings.model, used);
    } catch {
      couponsSummary.textContent = "Could not finish the coupon search. Nothing was ordered.";
      status.textContent = "Coupons error.";
    }
    couponsStop.removeEventListener("click", onStop);
    control = null;
    agentRun.disabled = send.disabled = summarize.disabled = couponsRun.disabled = false;
    question.focus();
  }

  couponsRun.addEventListener("click", () => void runCoupons());
  agentRun.addEventListener("click", () => void runTask(question.value));
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
  agentStop.addEventListener("click", () => control?.stop());

  composer.addEventListener("submit", (event) => {
    event.preventDefault();
    void ask(question.value);
  });
  question.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void ask(question.value);
    }
  });
  summarize.addEventListener("click", () => void ask(SUMMARIZE_QUESTION));
  stop.addEventListener("click", () => controller?.abort());
}

void main();
