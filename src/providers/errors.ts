import type { ProviderId } from "./types";

export type ProviderErrorCode =
  | "auth_invalid"
  | "rate_limited"
  | "provider_unavailable"
  | "network"
  | "bad_request"
  | "stream_error"
  | "consent_required"
  | "no_key";

const MESSAGES: Record<ProviderErrorCode, string> = {
  auth_invalid: "The API key was rejected. Check the key in Scout for Safari settings.",
  rate_limited: "The provider is rate limiting requests. Wait a moment and try again.",
  provider_unavailable: "The provider is having problems. Try again shortly.",
  network: "Could not reach the provider. Check your connection.",
  bad_request: "The provider rejected the request.",
  stream_error: "The response stream ended with an error.",
  consent_required: "Scout for Safari needs your permission before it sends anything to this provider. Nothing was sent.",
  no_key: "No API key is saved for this provider. Add one in Settings.",
};

export class ProviderError extends Error {
  constructor(
    readonly provider: ProviderId,
    readonly code: ProviderErrorCode,
    readonly status?: number,
    readonly retryAfterSeconds?: number,
    /** The provider's own one-line reason for a rejected request (see `errorDetail`), when it gave one. */
    readonly detail?: string,
  ) {
    super(MESSAGES[code]);
    this.name = "ProviderError";
  }

  /**
   * Safe to show the user: never contains the key or a raw provider response.
   * A rejected request (400) or a refused key (401/403) also carries the
   * provider's own reason, because "rejected" alone hides what to fix: an
   * exhausted credit balance, a model the account cannot use, a bad field.
   */
  get userMessage(): string {
    const withReason = this.code === "bad_request" || this.code === "auth_invalid";
    return this.message + (withReason && this.detail ? " The provider said: " + this.detail : "");
  }
}

const MAX_DETAIL = 200;
// Anything that looks like a key never goes into a message shown to the user.
const KEY_LIKE = /\b(?:sk|key|token)[-_][A-Za-z0-9_-]{8,}\b/gi;

/**
 * The provider's error message from a JSON error body ({"error":{"message":...}}),
 * one line, bounded, with key-like strings removed; undefined for any other body.
 */
export async function errorDetail(res: Response): Promise<string | undefined> {
  let text = "";
  try {
    text = await res.text();
  } catch {
    return undefined;
  }
  try {
    const j = JSON.parse(text) as { error?: { message?: unknown } } | null;
    const m = j?.error?.message;
    if (typeof m !== "string" || !m.trim()) return undefined;
    const line = m.replace(/\s+/g, " ").replace(KEY_LIKE, "[removed]").trim();
    return line.length > MAX_DETAIL ? line.slice(0, MAX_DETAIL - 1) + "…" : line;
  } catch {
    return undefined;
  }
}

export function errorFromStatus(provider: ProviderId, res: Response, detail?: string): ProviderError {
  const s = res.status;
  const retry = Number(res.headers.get("retry-after"));
  const retryAfter = Number.isFinite(retry) && retry > 0 ? retry : undefined;
  if (s === 401 || s === 403) return new ProviderError(provider, "auth_invalid", s, undefined, detail);
  if (s === 429) return new ProviderError(provider, "rate_limited", s, retryAfter, detail);
  if (s >= 500) return new ProviderError(provider, "provider_unavailable", s, undefined, detail);
  return new ProviderError(provider, "bad_request", s, undefined, detail);
}
