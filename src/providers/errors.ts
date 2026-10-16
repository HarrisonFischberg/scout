import type { ProviderId } from "./types";

export type ProviderErrorCode =
  | "auth_invalid"
  | "rate_limited"
  | "provider_unavailable"
  | "network"
  | "bad_request"
  | "stream_error";

const MESSAGES: Record<ProviderErrorCode, string> = {
  auth_invalid: "The API key was rejected. Check the key in AssistAnt settings.",
  rate_limited: "The provider is rate limiting requests. Wait a moment and try again.",
  provider_unavailable: "The provider is having problems. Try again shortly.",
  network: "Could not reach the provider. Check your connection.",
  bad_request: "The provider rejected the request.",
  stream_error: "The response stream ended with an error.",
};

export class ProviderError extends Error {
  constructor(
    readonly provider: ProviderId,
    readonly code: ProviderErrorCode,
    readonly status?: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(MESSAGES[code]);
    this.name = "ProviderError";
  }

  /** Safe to show the user: never contains the key or provider response body. */
  get userMessage(): string {
    return this.message;
  }
}

export function errorFromStatus(provider: ProviderId, res: Response): ProviderError {
  const s = res.status;
  const retry = Number(res.headers.get("retry-after"));
  const retryAfter = Number.isFinite(retry) && retry > 0 ? retry : undefined;
  if (s === 401 || s === 403) return new ProviderError(provider, "auth_invalid", s);
  if (s === 429) return new ProviderError(provider, "rate_limited", s, retryAfter);
  if (s >= 500) return new ProviderError(provider, "provider_unavailable", s);
  return new ProviderError(provider, "bad_request", s);
}
