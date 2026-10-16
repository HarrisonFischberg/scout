// Popup chat (S04): ask about the current page, summarize, streamed Markdown.
import { AgentControl, runAgent, type AgentPage, type StepRecord } from "./agent/loop";
import type { Action, ActionResult } from "./actions/executor";
import type { Snapshot } from "./snapshot/snapshot";
import { SUMMARIZE_QUESTION, type PageContext } from "./chat/prompt";
import { renderMarkdown } from "./chat/markdown";
import { runTurn } from "./chat/session";
import { createKeychain, nativeSend, type Provider } from "./keychain";
import { createProvider, type ChatMessage } from "./providers";

// Model IDs are defaults only. Claude ID from the claude-api skill; the OpenAI
// default is UNKNOWN until confirmed against OpenAI docs (activity.md T005).
const DEFAULT_MODEL: Record<Provider, string> = {
  anthropic: "claude-sonnet-5-5",
  openai: "gpt-5",
};

interface Settings {
  provider: Provider;
  model: string;
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error("missing #" + id);
  return node as T;
}

// Provider/model persistence arrives with Settings in T015. Until then the
// popup uses whichever provider has a saved key, and touches no extension storage.
async function findKey(): Promise<{ settings: Settings; apiKey: string } | null> {
  const keychain = createKeychain(nativeSend);
  for (const provider of ["anthropic", "openai"] as const) {
    try {
      const apiKey = await keychain.getKey(provider);
      if (apiKey) return { settings: { provider, model: DEFAULT_MODEL[provider] }, apiKey };
    } catch {
      // Treat an unreadable item like a missing one.
    }
  }
  return null;
}

async function readPage(): Promise<PageContext | null> {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) return null;
    const results = await browser.scripting.executeScript({
      target: { tabId: tab.id },
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

  const found = await findKey();
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
    addMessage("user", trimmed);
    question.value = "";
    const bubble = addMessage("assistant", "");
    bubble.textContent = "Thinking…";
    status.textContent = "Reading the page and waiting for the answer.";
    controller = new AbortController();
    setBusy(true);
    const page = await readPage();
    if (!page) status.textContent = "Could not read this page. Answering without it.";
    const result = await runTurn({
      provider,
      model: settings.model,
      history,
      question: trimmed,
      page,
      signal: controller.signal,
      onText: (full) => renderMarkdown(document, bubble, full),
    });
    controller = null;
    if (result.ok) {
      history.push({ role: "user", content: trimmed }, { role: "assistant", content: result.text });
      status.textContent = "Done.";
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
      "Agent " + outcome.status + ". Tokens: " + (outcome.usage.inputTokens + outcome.usage.outputTokens) + ".";
    agentRun.disabled = send.disabled = summarize.disabled = false;
    question.focus();
  }

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
