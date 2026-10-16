// Candidate coupon codes from the model (T013). This is NOT a live web
// search: the provider layer has no search tool yet (activity.md T013), so the
// codes are the model's suggestions and may be stale or invented. The finder
// verifies every one against the real cart total before trusting it.
import type { ProviderClient } from "../providers/types";
import { MAX_CODES, parseCodes } from "./finder";

export const CODES_SYSTEM_PROMPT = [
  "You suggest publicly advertised coupon codes for an online merchant.",
  "Reply with at most " + MAX_CODES + " codes, one per line, nothing else.",
  "If you do not know any, reply with the single word NONE. Never invent a code and present it as real.",
].join(" ");

export async function suggestCodes(
  provider: ProviderClient,
  model: string,
  merchant: string,
  signal?: AbortSignal,
): Promise<{ codes: string[]; inputTokens: number; outputTokens: number }> {
  let text = "";
  let inputTokens = 0;
  let outputTokens = 0;
  const req = {
    model,
    system: CODES_SYSTEM_PROMPT,
    messages: [{ role: "user" as const, content: "Merchant site: " + merchant }],
    maxTokens: 256,
    ...(signal ? { signal } : {}),
  };
  for await (const ev of provider.stream(req)) {
    if (ev.type === "text") text += ev.delta;
    else if (ev.type === "usage") {
      inputTokens += ev.usage.inputTokens;
      outputTokens += ev.usage.outputTokens;
    }
  }
  return { codes: parseCodes(text), inputTokens, outputTokens };
}
