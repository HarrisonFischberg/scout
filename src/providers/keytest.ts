// Checks an API key from the popup before it is saved (Settings view). Calls
// each provider's read-only model list, which bills no tokens. The key is
// sent only to the provider it belongs to.
import type { FetchLike, ProviderId } from "./types";

export type KeyCheck = "valid" | "invalid" | "network";

const ENDPOINT: Record<ProviderId, string> = {
  anthropic: "https://api.anthropic.com/v1/models?limit=1",
  openai: "https://api.openai.com/v1/models",
};

export async function checkKey(provider: ProviderId, key: string, fetchFn: FetchLike): Promise<KeyCheck> {
  const trimmed = key.trim();
  if (!trimmed) return "invalid";
  const headers: Record<string, string> =
    provider === "anthropic"
      ? {
          "x-api-key": trimmed,
          "anthropic-version": "2023-06-01",
          // Browser-origin call with the user's own key (see anthropic.ts).
          "anthropic-dangerous-direct-browser-access": "true",
        }
      : { authorization: `Bearer ${trimmed}` };
  try {
    const res = await fetchFn(ENDPOINT[provider], { method: "GET", headers });
    if (res.ok) return "valid";
    return res.status === 401 || res.status === 403 ? "invalid" : "network";
  } catch {
    return "network";
  }
}

/** Basic shape check so obvious paste mistakes are caught before any request. */
export function looksLikeKey(provider: ProviderId, key: string): boolean {
  const k = key.trim();
  if (k.length < 20 || /\s/.test(k)) return false;
  return provider === "anthropic" ? k.startsWith("sk-ant-") : k.startsWith("sk-");
}
