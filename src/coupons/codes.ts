// Candidate coupon codes (T013, T019). A code is only offered to the finder
// when the provider's web search returned the page the model says it came
// from. A code the model cannot tie to a searched page is dropped, never
// presented as found. The finder still verifies each against the real total.
import type { ProviderClient } from "../providers/types";
import { MAX_CODES, parseCodes, type CouponCandidate } from "./finder";

export const CODES_SYSTEM_PROMPT = [
  "You find publicly advertised coupon codes for an online merchant. Use web search.",
  "Reply with at most " + MAX_CODES + " lines, each exactly: CODE | https://source-page-url",
  "The URL must be a page your search returned that shows the code. Nothing else.",
  "If you found none, reply with the single word NONE. Never invent a code or a URL.",
].join(" ");

export interface SuggestedCodes {
  /** Only codes whose source URL was returned by the provider's search. */
  codes: CouponCandidate[];
  /** Model lines dropped because no searched page backed them. */
  unsourced: number;
  searched: boolean;
  inputTokens: number;
  outputTokens: number;
}

function norm(url: string): string {
  try {
    const u = new URL(url);
    return (u.origin + u.pathname.replace(/\/+$/, "") + u.search).toLowerCase();
  } catch {
    return "";
  }
}

export async function suggestCodes(
  provider: ProviderClient,
  model: string,
  merchant: string,
  signal?: AbortSignal,
  opts: { webSearch?: boolean } = {},
): Promise<SuggestedCodes> {
  // With search off there is nothing to source a code from: do not ask a
  // model to guess, and say so.
  if (opts.webSearch === false) return { codes: [], unsourced: 0, searched: false, inputTokens: 0, outputTokens: 0 };
  let text = "";
  let inputTokens = 0;
  let outputTokens = 0;
  const seen = new Set<string>();
  const req = {
    model,
    system: CODES_SYSTEM_PROMPT,
    messages: [{ role: "user" as const, content: "Merchant site: " + merchant }],
    maxTokens: 512,
    webSearch: true,
    ...(signal ? { signal } : {}),
  };
  for await (const ev of provider.stream(req)) {
    if (ev.type === "text") text += ev.delta;
    else if (ev.type === "source") seen.add(norm(ev.url));
    else if (ev.type === "usage") {
      inputTokens += ev.usage.inputTokens;
      outputTokens += ev.usage.outputTokens;
    }
  }
  const codes: CouponCandidate[] = [];
  let unsourced = 0;
  for (const line of text.split("\n")) {
    const m = /^\W*([^\s|]+)\s*\|\s*(https?:\/\/\S+)/.exec(line);
    if (!m) continue;
    const code = parseCodes(m[1] ?? "")[0];
    const url = (m[2] ?? "").replace(/[)>.,;]+$/, "");
    if (!code || codes.some((c) => c.code === code)) continue;
    if (norm(url) !== "" && seen.has(norm(url))) codes.push({ code, sourceUrl: url });
    else unsourced++;
  }
  return { codes: codes.slice(0, MAX_CODES), unsourced, searched: true, inputTokens, outputTokens };
}
