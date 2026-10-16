import { describe, expect, it } from "vitest";
import { estimateCostUsd, formatRunCost } from "../../src/cost";

describe("cost", () => {
  it("computes input and output cost per million tokens", () => {
    expect(estimateCostUsd("claude-sonnet-5-5", { inputTokens: 1_000_000, outputTokens: 0 })).toBe(2);
    expect(estimateCostUsd("claude-sonnet-5-5", { inputTokens: 0, outputTokens: 1_000_000 })).toBe(10);
    expect(
      estimateCostUsd("claude-sonnet-5-5", { inputTokens: 1500, outputTokens: 500 }),
    ).toBeCloseTo(0.008, 10);
  });
  it("returns null for a model with no recorded price", () => {
    expect(estimateCostUsd("gpt-5", { inputTokens: 10, outputTokens: 10 })).toBeNull();
  });
  it("formats a priced run", () => {
    const s = formatRunCost("claude-sonnet-5-5", { inputTokens: 1500, outputTokens: 500 });
    expect(s).toContain("2000 tokens (1500 in, 500 out)");
    expect(s).toContain("$0.0080");
  });
  it("says unavailable instead of guessing", () => {
    const s = formatRunCost("gpt-5", { inputTokens: 10, outputTokens: 5 });
    expect(s).toContain("15 tokens");
    expect(s).toContain("unavailable");
    expect(s).not.toContain("$");
  });
});
