// One answer in the Scout app's own chat (owner request 2026-11-01): the
// question goes to Claude with the user's key and web search, as the panel's
// general questions do (src/server/engine.ts), without a page or browser tools.
// Apple's on-device model answers when there is no key, or first when the
// user turned "Apple first" on; it hands off to Claude when it can't answer.
import { APPLE_NO_PAGE_PROMPT, APPLE_WEB_RULE, appSystemPrompt } from "../chat/prompt";
import { CHAT_MAX_TOKENS } from "../chat/session";
import type { Source } from "../chat/sources";
import { AppleModelError, appleCouldNotAnswer, appleRepeats, needsFreshFacts, stripSourceMarkers } from "../providers/apple";
import { ProviderError } from "../providers/errors";
import type { ChatMessage, Effort, ProviderClient, Usage } from "../providers/types";

/** Web searches per answer, as in the panel (CHAT_WEB_SEARCHES). */
export const APP_WEB_SEARCHES = 5;

export interface AskInput {
  /** Claude with the user's key; absent when no key is saved. */
  claude?: { client: ProviderClient; model: string; effort?: Effort };
  /** Apple's on-device model, when it is available on this device. */
  apple?: ProviderClient;
  /** Ask Apple first and hand off to Claude when it can't answer. Without Claude, Apple always answers. */
  appleFirst?: boolean;
  history: ChatMessage[];
  question: string;
  signal?: AbortSignal;
  /** The answer so far, with citation markers, on every change. */
  onText: (text: string) => void;
}

export interface AskResult {
  text: string;
  /** Web pages, numbered as the answer's [n] markers count them. */
  sources: Source[];
  /** Which model answered: "apple" or Claude's model id. */
  model: string;
  usage?: Usage;
  stopped?: true;
  /** Safe to show. Set when the answer failed; `text` holds any partial answer. */
  error?: string;
}

export const NO_MODEL = "Add your Anthropic API key to start chatting.";
const FAILED = "Something went wrong. Try again.";
const INTERRUPTED = "The answer stopped early. Try again.";

async function askApple(apple: ProviderClient, input: AskInput, mustAnswer: boolean): Promise<string | null> {
  let text = "";
  for await (const ev of apple.stream({
    model: "apple",
    system: APPLE_NO_PAGE_PROMPT + (mustAnswer ? "" : " " + APPLE_WEB_RULE),
    messages: [...input.history, { role: "user", content: input.question }],
    maxTokens: CHAT_MAX_TOKENS,
    ...(input.signal ? { signal: input.signal } : {}),
  })) {
    if (ev.type === "text") text += ev.delta;
  }
  if (!mustAnswer && (appleCouldNotAnswer(text) || appleRepeats(text, input.history))) return null;
  return stripSourceMarkers(text);
}

export async function ask(input: AskInput): Promise<AskResult> {
  const { claude, apple, signal } = input;
  if (!claude && !apple) return { text: "", sources: [], model: "", error: NO_MODEL };

  // Apple answers alone without a key; first (and hands off) when the user chose it.
  const tryApple = !!apple && (!claude || (!!input.appleFirst && !needsFreshFacts(input.question, false)));
  if (tryApple) {
    try {
      const text = await askApple(apple!, input, !claude);
      if (signal?.aborted) return { text: text ?? "", sources: [], model: "apple", stopped: true };
      if (text !== null) {
        input.onText(text);
        return { text, sources: [], model: "apple" };
      }
    } catch (err) {
      if (!claude) {
        return { text: "", sources: [], model: "apple", error: err instanceof AppleModelError ? err.userMessage : FAILED };
      }
      // With a key, Claude answers instead.
    }
  }
  if (!claude) return { text: "", sources: [], model: "apple", error: FAILED };

  const sources: Source[] = [];
  const index = new Map<string, number>();
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  let text = "";
  try {
    for await (const ev of claude.client.stream({
      model: claude.model,
      system: appSystemPrompt({ webSearch: true }),
      messages: [...input.history, { role: "user", content: input.question }],
      webSearch: true,
      webSearchMaxUses: APP_WEB_SEARCHES,
      maxTokens: CHAT_MAX_TOKENS,
      ...(claude.effort ? { effort: claude.effort } : {}),
      ...(signal ? { signal } : {}),
    })) {
      if (ev.type === "text") {
        text += ev.delta;
        input.onText(text);
      } else if (ev.type === "source") {
        // Web pages only: a source becomes a link (QA 2026-10-29: no javascript: or data:).
        if (!/^https?:\/\//i.test(ev.url)) continue;
        if (!index.has(ev.url)) {
          sources.push({ url: ev.url, ...(ev.title ? { title: ev.title } : {}), kind: "web" });
          index.set(ev.url, sources.length);
        }
        // The provider's own citation: a numbered marker after the cited text, shown as a site chip.
        if (ev.cite && text && !/\n\s*$/.test(text)) {
          const marker = " [" + index.get(ev.url) + "]";
          if (!text.endsWith(marker)) {
            text += marker;
            input.onText(text);
          }
        }
      } else if (ev.type === "usage") {
        usage.inputTokens += ev.usage.inputTokens;
        usage.outputTokens += ev.usage.outputTokens;
        if (ev.usage.webSearches) usage.webSearches = (usage.webSearches ?? 0) + ev.usage.webSearches;
      }
    }
  } catch (err) {
    if (signal?.aborted) return { text, sources, model: claude.model, usage, stopped: true };
    const pe = err instanceof ProviderError ? err : null;
    const interrupted = text.length > 0 && (!pe || pe.code === "network" || pe.code === "stream_error");
    return { text, sources, model: claude.model, usage, error: interrupted ? INTERRUPTED : (pe?.userMessage ?? FAILED) };
  }
  if (signal?.aborted) return { text, sources, model: claude.model, usage, stopped: true };
  return { text, sources, model: claude.model, usage };
}
