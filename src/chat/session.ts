// One chat turn: stream a provider answer, report text deltas, map errors.
import { ProviderError } from "../providers/errors";
import type { ChatMessage, Effort, ProviderClient, Usage } from "../providers/types";
import { SYSTEM_PROMPT, buildMessages, type PageContext } from "./prompt";

export type TurnResult =
  | { ok: true; text: string; usage?: Usage }
  | { ok: false; error: string; partial: string };

export interface TurnInput {
  provider: ProviderClient;
  model: string;
  /** Omitted: the model's default effort. */
  effort?: Effort;
  history: ChatMessage[];
  question: string;
  page: PageContext | null;
  extraPages?: PageContext[];
  signal?: AbortSignal;
  onText: (full: string) => void;
}

export const CHAT_MAX_TOKENS = 16_000;

export async function runTurn(input: TurnInput): Promise<TurnResult> {
  let text = "";
  let usage: Usage | undefined;
  try {
    const req = {
      model: input.model,
      system: SYSTEM_PROMPT,
      messages: buildMessages(input.history, input.question, input.page, input.extraPages ?? []),
      // Current models think before answering and thinking counts toward this
      // cap, so a small cap cut answers short at higher effort. Streaming, so
      // no timeout risk; only tokens actually used are billed.
      maxTokens: CHAT_MAX_TOKENS,
      ...(input.effort ? { effort: input.effort } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    };
    for await (const ev of input.provider.stream(req)) {
      if (ev.type === "text") {
        text += ev.delta;
        input.onText(text);
      } else if (ev.type === "usage") usage = ev.usage;
    }
    return { ok: true, text, ...(usage ? { usage } : {}) };
  } catch (err) {
    if (input.signal?.aborted) return { ok: false, error: "Stopped.", partial: text };
    const error =
      err instanceof ProviderError ? err.userMessage : "Something went wrong. Try again.";
    return { ok: false, error, partial: text };
  }
}
