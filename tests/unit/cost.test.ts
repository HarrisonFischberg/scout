import { describe, expect, it } from "vitest";
import { estimateCostUsd, formatCostLine } from "../../src/cost";

describe("cost", () => {
  it("computes input and output cost per million tokens", () => {
    expect(estimateCostUsd("claude-sonnet-5-5", { inputTokens: 1_000_000, outputTokens: 0 })).toBe(2);
    expect(estimateCostUsd("claude-sonnet-5-5", { inputTokens: 0, outputTokens: 1_000_000 })).toBe(10);
    expect(
      estimateCostUsd("claude-sonnet-5-5", { inputTokens: 1500, outputTokens: 500 }),
    ).toBeCloseTo(0.008, 10);
  });
  it("prices the current Claude models from the recorded table", () => {
    expect(estimateCostUsd("claude-opus-5-5", { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(24);
    expect(estimateCostUsd("claude-opus-5", { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(30);
    expect(estimateCostUsd("claude-fable-5-1", { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(60);
    expect(estimateCostUsd("claude-haiku-4-5", { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(6);
  });
  it("uses a dated snapshot's model row", () => {
    expect(estimateCostUsd("claude-haiku-4-5-20251001", { inputTokens: 1_000_000, outputTokens: 0 })).toBe(1);
  });
  it("prices a Haiku 5.5 prompt over 100,000 tokens at the long-prompt rate", () => {
    expect(estimateCostUsd("claude-haiku-5-5", { inputTokens: 100_000, outputTokens: 0 })).toBeCloseTo(0.01, 10);
    expect(estimateCostUsd("claude-haiku-5-5", { inputTokens: 100_001, outputTokens: 1_000_000 })).toBeCloseTo(0.0500005 + 2.5, 10);
  });
  it("prices prompt-cache writes at 1.25x input and hits at the model's cache price", () => {
    const u = { inputTokens: 3_000_000, outputTokens: 0, cacheWriteTokens: 1_000_000, cacheReadTokens: 1_000_000 };
    expect(estimateCostUsd("claude-sonnet-5", u)).toBeCloseTo(2 + 2.5 + 0.2, 10);
    expect(estimateCostUsd("claude-sonnet-5-5", u)).toBeCloseTo(2 + 2.5 + 0.1, 10);
    expect(estimateCostUsd("claude-opus-5-5", u)).toBeCloseTo(4 + 5 + 0.2, 10);
    expect(estimateCostUsd("claude-fable-5-1", u)).toBeCloseTo(10 + 12.5 + 0.25, 10);
    // Over 100,000 tokens (cache tokens count) Haiku 5.5 uses its long-prompt row for all three.
    expect(estimateCostUsd("claude-haiku-5-5", u)).toBeCloseTo(0.5 + 0.625 + 0.05, 10);
  });
  it("adds $10 per 1,000 web searches", () => {
    expect(estimateCostUsd("claude-sonnet-5-5", { inputTokens: 0, outputTokens: 0, webSearches: 3 })).toBeCloseTo(0.03, 10);
  });
  it("returns null for a model with no recorded price", () => {
    expect(estimateCostUsd("gpt-5", { inputTokens: 10, outputTokens: 10 })).toBeNull();
  });
  it("formats one cost line", () => {
    expect(formatCostLine("claude-sonnet-5-5", { inputTokens: 1500, outputTokens: 500 })).toBe("Cost: $0.0080");
    expect(formatCostLine("claude-opus-5-5", { inputTokens: 200_000, outputTokens: 100_000 })).toBe("Cost: $2.80");
    expect(formatCostLine("claude-sonnet-5-5", { inputTokens: 20, outputTokens: 5 })).toBe("Cost: <$0.0001");
    expect(formatCostLine("claude-sonnet-5-5", { inputTokens: 0, outputTokens: 0 })).toBe("Cost: $0.00");
  });
  it("says not available instead of guessing", () => {
    const s = formatCostLine("gpt-5", { inputTokens: 10, outputTokens: 5 });
    expect(s).toBe("Cost: not available for gpt-5");
    expect(s).not.toContain("$");
  });
});
