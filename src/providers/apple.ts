// Apple's on-device model over native messaging (owner's choice 2026-10-25:
// Scout should work without an API key). Safari on iOS 26 / macOS 26 with
// Apple Intelligence only. Nothing leaves the device and nothing is billed.
// One reply per request (no streaming, no tools, no web search). The model's
// context is about 4,000 tokens, so long prompts are cut to fit.
import type { NativeSend } from "../keychain";
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
  const earlier = messages.slice(0, -1).slice(-4).map((m) => (m.role === "user" ? "User: " : "Assistant: ") + fitText(textOf(m.content), 600));
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

/** True when Apple's reply is empty or says it can't answer, so a key's model should try instead (owner, 2026-10-27). */
export function appleCouldNotAnswer(text: string): boolean {
  const t = text.trim().replace(/[\u2018\u2019]/g, "'");
  if (!t) return true;
  return t.length < 700 && COULD_NOT.test(t.slice(0, 300));
}

/** A provider client for the chat engine, over native messaging to Apple's model. */
export function createApple(send: NativeSend): ProviderClient {
  return {
    id: "apple",
    async *stream(req: ChatRequest): AsyncGenerator<StreamEvent, void, void> {
      const system = req.system ? fitText(req.system, APPLE_SYSTEM_CHARS) : undefined;
      const maxTokens = Math.min(req.maxTokens, APPLE_MAX_TOKENS);
      let text: string;
      try {
        text = await appleGenerate(send, { system, prompt: applePrompt(req.messages), maxTokens });
      } catch (err) {
        // Too long even after cutting: try once more with half the page.
        if (!(err instanceof AppleModelError) || err.code !== "too_long") throw err;
        text = await appleGenerate(send, { system, prompt: applePrompt(req.messages, APPLE_PROMPT_CHARS / 2), maxTokens });
      }
      if (req.signal?.aborted) return;
      yield { type: "text", delta: text };
      yield { type: "stop", reason: "end_turn" };
      yield { type: "done" };
    },
  };
}
