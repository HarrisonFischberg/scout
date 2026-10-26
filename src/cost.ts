// Cost display (T014): token usage to an estimated USD figure. Prices are
// list prices per million tokens; sources are recorded in docs/claims-evidence.md.
import type { Usage } from "./providers/types";

export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
  /** Higher prices for the whole request when its prompt is over `overInputTokens`. */
  longPrompt?: { overInputTokens: number; inputPerMTok: number; outputPerMTok: number };
  /** Prompt-cache hits as a share of the input price, when not the standard 0.1x. */
  cacheRead?: number;
}

export const PRICE_TABLE_DATE = "2026-10-16";

// A model absent from this table has no recorded source, so no estimate is shown.
// https://platform.claude.com/docs/en/about-claude/pricing ("Model pricing"), fetched 2026-10-16;
// cache write and hit prices from the same table, fetched 2026-10-26.
export const PRICES: Record<string, ModelPrice> = {
  "claude-fable-5-1": { inputPerMTok: 10, outputPerMTok: 50, cacheRead: 0.025 },
  "claude-fable-5": { inputPerMTok: 10, outputPerMTok: 50 },
  "claude-mythos-5-1": { inputPerMTok: 10, outputPerMTok: 50, cacheRead: 0.025 },
  "claude-mythos-5": { inputPerMTok: 10, outputPerMTok: 50 },
  "claude-opus-5-5": { inputPerMTok: 4, outputPerMTok: 20, cacheRead: 0.05 },
  "claude-opus-5": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-8": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-7": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-6": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-5": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-sonnet-5-5": { inputPerMTok: 2, outputPerMTok: 10, cacheRead: 0.05 },
  "claude-sonnet-5": { inputPerMTok: 2, outputPerMTok: 10 },
  "claude-sonnet-4-6": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-sonnet-4-5": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-haiku-5-5": {
    inputPerMTok: 0.1,
    outputPerMTok: 0.5,
    longPrompt: { overInputTokens: 100_000, inputPerMTok: 0.5, outputPerMTok: 2.5 },
  },
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5 },
};

// Same page, "Web search tool": $10 per 1,000 searches, on top of tokens.
const WEB_SEARCH_USD = 10 / 1000;

/** The price row for a model ID; dated snapshot IDs (…-20251001) use their model's row. */
function priceFor(model: string): ModelPrice | undefined {
  return PRICES[model] ?? PRICES[model.replace(/-\d{8}$/, "")];
}

export function estimateCostUsd(model: string, usage: Usage): number | null {
  const base = priceFor(model);
  if (!base) return null;
  const price = base.longPrompt && usage.inputTokens > base.longPrompt.overInputTokens ? base.longPrompt : base;
  // inputTokens includes the cache tokens: writes bill at 1.25x input (5-minute cache), hits at cacheRead.
  const write = usage.cacheWriteTokens ?? 0;
  const read = usage.cacheReadTokens ?? 0;
  const input = usage.inputTokens - write - read + write * 1.25 + read * (base.cacheRead ?? 0.1);
  return (
    (input * price.inputPerMTok + usage.outputTokens * price.outputPerMTok) / 1_000_000 +
    (usage.webSearches ?? 0) * WEB_SEARCH_USD
  );
}

function formatUsd(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.0001) return "<$0.0001";
  return "$" + usd.toFixed(usd < 1 ? 4 : 2);
}

/** The one line shown under the conversation after a run: "Cost: $0.0123". */
export function formatCostLine(model: string, usage: Usage): string {
  const usd = estimateCostUsd(model, usage);
  return usd === null ? `Cost: not available for ${model}` : `Cost: ${formatUsd(usd)}`;
}

/** One cost line for a run that used more than one model: each part priced with its own model. */
export function formatCostLineParts(parts: Array<{ model: string; usage: Usage }>): string {
  let usd = 0;
  for (const p of parts) {
    if (!p.usage.inputTokens && !p.usage.outputTokens && !p.usage.webSearches) continue;
    const part = estimateCostUsd(p.model, p.usage);
    if (part === null) return `Cost: not available for ${p.model}`;
    usd += part;
  }
  return `Cost: ${formatUsd(usd)}`;
}
