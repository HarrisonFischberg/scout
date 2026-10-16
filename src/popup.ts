// Popup chat (S04): ask about the current page, summarize, streamed Markdown.
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

async function main(): Promise<void> {
  const status = el("status");
  const log = el("log");
  const noKey = el("no-key");
  const composer = el<HTMLFormElement>("composer");
  const question = el<HTMLTextAreaElement>("question");
  const send = el<HTMLButtonElement>("send");
  const summarize = el<HTMLButtonElement>("summarize");
  const stop = el<HTMLButtonElement>("stop");

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
