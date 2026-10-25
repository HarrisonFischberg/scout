// Apple's on-device model over native messaging (owner's choice 2026-10-25:
// Scout should work without an API key). Safari on iOS 26 / macOS 26 with
// Apple Intelligence only. Nothing leaves the device and nothing is billed.
// First version: one reply per request (no streaming, no tools, no web search).
import type { NativeSend } from "../keychain";

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
