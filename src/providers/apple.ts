// Apple's on-device model over native messaging (owner's choice 2026-10-25:
// Scout should work without an API key). Safari on iOS 26 / macOS 26 with
// Apple Intelligence only. Nothing leaves the device and nothing is billed.
// One reply per request (no streaming, no tools, no web search). The model's
// context is about 4,000 tokens, so long prompts are cut to fit.
import type { NativeSend } from "../keychain";
import { APPLE_NEEDS_WEB } from "../chat/prompt";
import { textOf, type ChatMessage, type ChatRequest, type ProviderClient, type StreamEvent } from "./types";

/** The model id used when Scout runs on Apple's on-device model (no key). */
export const APPLE_MODEL = "apple-on-device";
/** Shown on the model pill. */
export const APPLE_MODEL_LABEL = "Apple · on device";

export type AppleUnavailable = "device_not_eligible" | "not_enabled" | "model_not_ready" | "os_too_old" | "not_safari" | "unknown";

export type AppleStatus = { available: true } | { available: false; reason: AppleUnavailable };

/** Plain words for each reason Apple's model can't be used. */
export const APPLE_UNAVAILABLE_TEXT: Record<AppleUnavailable, string> = {
  device_not_eligible: "This device doesn't support Apple Intelligence.",
  not_enabled: "Turn on Apple Intelligence in the Settings app to use it.",
  model_not_ready: "Apple Intelligence is still downloading. Try again later.",
  os_too_old: "Needs iOS 26 or macOS 26.",
  not_safari: "Only in Safari.",
  unknown: "Apple Intelligence isn't available right now.",
};

const REASONS = new Set<string>(Object.keys(APPLE_UNAVAILABLE_TEXT));

export async function appleStatus(send: NativeSend): Promise<AppleStatus> {
  try {
    const r = (await send({ type: "ai.apple.status" })) as { ok?: boolean; available?: boolean; reason?: string } | undefined;
    if (r?.ok && r.available === true) return { available: true };
    const reason = r?.reason && REASONS.has(r.reason) ? (r.reason as AppleUnavailable) : "unknown";
    return { available: false, reason };
  } catch {
    return { available: false, reason: "unknown" };
  }
}

export class AppleModelError extends Error {
  /** Safe to show, like ProviderError.userMessage. */
  get userMessage(): string {
    return this.message;
  }
  constructor(readonly code: string) {
    super(
      code === "too_long"
        ? "This page is too long for Apple's on-device model. Ask about a smaller part, or add an API key in Settings."
        : code === "refused"
          ? "Apple's on-device model declined this request."
          : code === "unavailable"
            ? "Apple Intelligence isn't available on this device."
            : code === "timeout"
              ? "Apple's on-device model took too long to answer. Try again."
            : "Apple's on-device model couldn't answer. Try again.",
    );
    this.name = "AppleModelError";
  }
}

export async function appleGenerate(send: NativeSend, req: { system?: string; prompt: string; maxTokens?: number }): Promise<string> {
  let r: { ok?: boolean; text?: string; error?: string } | undefined;
  try {
    r = (await send({ type: "ai.apple.generate", system: req.system, prompt: req.prompt, maxTokens: req.maxTokens ?? 800 })) as typeof r;
  } catch {
    throw new AppleModelError("generation_failed");
  }
  if (!r?.ok || typeof r.text !== "string") throw new AppleModelError(r?.error ?? "generation_failed");
  return r.text;
}

// Budgets in characters (about 4 per token): instructions + prompt + reply
// stay under the model's ~4,000-token context.
export const APPLE_SYSTEM_CHARS = 2_000;
export const APPLE_PROMPT_CHARS = 8_000;
const APPLE_MAX_TOKENS = 700;

/** Keeps the start and the end (where the question is) of a long text. */
export function fitText(text: string, max: number): string {
  if (text.length <= max) return text;
  const tail = Math.min(1_200, Math.floor(max / 3));
  return text.slice(0, max - tail - 30) + "\n[… shortened to fit …]\n" + text.slice(text.length - tail);
}

/** The conversation as one prompt: earlier turns briefly, the newest message in full (cut to fit). */
export function applePrompt(messages: ChatMessage[], max = APPLE_PROMPT_CHARS): string {
  const last = messages[messages.length - 1];
  const before = messages.slice(0, -1);
  const recent = before.slice(-4);
  // The chat's first message says what it is about; keep it when it scrolls out (owner report 2026-10-28).
  const first = before.find((m) => m.role === "user");
  const kept = first && !recent.includes(first) ? [first, ...recent] : recent;
  const earlier = kept.map((m) => (m.role === "user" ? "User: " : "Assistant: ") + fitText(textOf(m.content), 600));
  const head = earlier.length ? "Earlier in this conversation:\n" + earlier.join("\n") + "\n\n" : "";
  const room = Math.max(1_000, max - head.length);
  return head + fitText(last ? textOf(last.content) : "", room);
}

// Replies that mean Apple's model could not help: a refusal, "I can't
// browse", "I don't have current information". Only the model speaking about
// itself counts, so a page about "real-time bidding" or "guests without access"
// keeps its answer (audit 2026-10-27). Only short replies count, so a full
// answer that starts with an apology is kept.
const COULD_NOT =
  /\b(?:i(?:'m| am) (?:sorry|unable|not able)|i (?:can't|cannot|can not|couldn't|could not|don't know|do not know|don't have|do not have|lack)|as an ai|my (?:knowledge|training)(?: data)? (?:cutoff|only goes))\b/i;

// Questions about things that change (prices, news, scores, weather) with no
// page to answer from. Apple's model has no web access and, asked anyway,
// makes up an answer instead of saying NEEDS_WEB (live QA 2026-10-29: a
// "closing price yesterday" got an invented number), so these go straight to
// the key's model. The question is checked, not the model's own confidence.
const FRESH =
  /\b(?:today|tonight|yesterday|tomorrow|this (?:morning|afternoon|evening|week|weekend|month)|last night|right now|currently|latest|recent(?:ly)?|news|headlines?|stocks?|share price|closing price|market cap|exchange rate|bitcoin|crypto|weather|forecast|scores?|standings|who won|election|polls?|open now|opening hours)\b/i;

/** True when a question with no page needs current facts, so Apple's model is skipped. */
export function needsFreshFacts(question: string, hasPage: boolean): boolean {
  return !hasPage && FRESH.test(question);
}

/** True when Apple's reply is empty or says it can't answer, so a key's model should try instead (owner, 2026-10-27). */
export function appleCouldNotAnswer(text: string): boolean {
  const t = text.trim().replace(/[\u2018\u2019]/g, "'");
  if (!t || t.includes(APPLE_NEEDS_WEB)) return true;
  return t.length < 700 && COULD_NOT.test(t.slice(0, 300));
}

/** Source markers like [1] or [1, 2], for a reply that had no numbered sources. */
export function stripSourceMarkers(text: string): string {
  return text.replace(/ ?\[\d+(?:\s*,\s*\d+)*\]/g, "");
}

/** The last question in a text, lowercased without punctuation. */
function lastQuestion(text: string): string {
  const qs = text.match(/[^.?!\n]*\?/g);
  return qs ? qs[qs.length - 1].toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim() : "";
}

/**
 * True when Apple's reply asks the same question as its previous reply (owner
 * report 2026-10-28: "traditional or smart?" asked again after each answer),
 * so the key's model should answer instead.
 */
export function appleRepeats(text: string, history: ChatMessage[]): boolean {
  const q = lastQuestion(text);
  if (!q) return false;
  const prev = [...history].reverse().find((m) => m.role === "assistant");
  return !!prev && lastQuestion(textOf(prev.content)) === q;
}

/** Longest wait for one on-device reply; a native call that never answers would otherwise hang the chat (QA 2026-10-29). */
export const APPLE_TIMEOUT_MS = 60_000;

/** A provider client for the chat engine, over native messaging to Apple's model. */
export function createApple(send: NativeSend, opts: { timeoutMs?: number } = {}): ProviderClient {
  const timeoutMs = opts.timeoutMs ?? APPLE_TIMEOUT_MS;
  return {
    id: "apple",
    async *stream(req: ChatRequest): AsyncGenerator<StreamEvent, void, void> {
      const system = req.system ? fitText(req.system, APPLE_SYSTEM_CHARS) : undefined;
      const maxTokens = Math.min(req.maxTokens, APPLE_MAX_TOKENS);
      // Ends early on Stop (resolves null) or after the time limit (throws), so neither waits on the native side.
      const bounded = (call: Promise<string>): Promise<string | null> => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let onAbort = (): void => undefined;
        const stop = new Promise<null>((resolve, reject) => {
          timer = setTimeout(() => reject(new AppleModelError("timeout")), timeoutMs);
          onAbort = () => resolve(null);
          if (req.signal?.aborted) resolve(null);
          req.signal?.addEventListener("abort", onAbort, { once: true });
        });
        return Promise.race([call, stop]).finally(() => {
          clearTimeout(timer);
          req.signal?.removeEventListener("abort", onAbort);
        });
      };
      let text: string | null;
      try {
        text = await bounded(appleGenerate(send, { system, prompt: applePrompt(req.messages), maxTokens }));
      } catch (err) {
        // Too long even after cutting: try once more with half the page.
        if (!(err instanceof AppleModelError) || err.code !== "too_long") throw err;
        text = await bounded(appleGenerate(send, { system, prompt: applePrompt(req.messages, APPLE_PROMPT_CHARS / 2), maxTokens }));
      }
      if (text === null || req.signal?.aborted) return;
      yield { type: "text", delta: text };
      yield { type: "stop", reason: "end_turn" };
      yield { type: "done" };
    },
  };
}
