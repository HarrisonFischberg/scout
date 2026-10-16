// Cost display (T014): token usage to an estimated USD figure. Prices are
// list prices per million tokens; sources are recorded in docs/claims-evidence.md.
import type { Usage } from "./providers/types";

export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
}

export const PRICE_TABLE_DATE = "2026-10-15";

// A model absent from this table has no recorded source, so no estimate is shown.
export const PRICES: Record<string, ModelPrice> = {
  // https://platform.claude.com/docs/en/about-claude/pricing, fetched 2026-10-15
  "claude-sonnet-5-5": { inputPerMTok: 2, outputPerMTok: 10 },
};

export function estimateCostUsd(model: string, usage: Usage): number | null {
  const price = PRICES[model];
  if (!price) return null;
  return (
    (usage.inputTokens * price.inputPerMTok + usage.outputTokens * price.outputPerMTok) / 1_000_000
  );
}

function formatUsd(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.0001) return "<$0.0001";
  return "$" + usd.toFixed(usd < 0.01 ? 4 : 2);
}

export function formatRunCost(model: string, usage: Usage): string {
  const total = usage.inputTokens + usage.outputTokens;
  const tokens = `${total} tokens (${usage.inputTokens} in, ${usage.outputTokens} out)`;
  const usd = estimateCostUsd(model, usage);
  if (usd === null) {
    return `${tokens}. Cost estimate unavailable for ${model}: no recorded price.`;
  }
  return `${tokens}. Estimated cost ${formatUsd(usd)} (list price as of ${PRICE_TABLE_DATE}; your provider bill governs).`;
}
