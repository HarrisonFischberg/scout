import { describe, expect, it } from "vitest";
import { EXPLAIN_QUESTION, SUMMARIZE_QUESTION, starterLabel } from "../../src/chat/prompt";
import { classifyQuestion } from "../../src/chat/intent";

// Owner, 2026-11-03: "Explain the key points" must open with at most 3 one-sentence bullets, then less detail.
describe("Explain the key points", () => {
  it("asks for a summary of at most 3 one-sentence bullets, then a short detail section", () => {
    expect(EXPLAIN_QUESTION).toMatch(/at most 3 bullet points, one short sentence each/);
    expect(EXPLAIN_QUESTION).toMatch(/"More detail" with at most 4 short bullet points/);
    expect(EXPLAIN_QUESTION).toMatch(/No introduction and no closing line/);
  });
  it("shows a short label instead of the long instruction, old wording included", () => {
    expect(starterLabel(EXPLAIN_QUESTION)).toBe("Explain key points");
    expect(starterLabel("Explain the most important points on this page.")).toBe("Explain key points");
    expect(starterLabel(SUMMARIZE_QUESTION)).toBe("Summarize page");
    expect(starterLabel("what is this?")).toBe("what is this?");
  });
  it("is about the page", () => {
    expect(classifyQuestion({ question: EXPLAIN_QUESTION, pageTitle: "", attachedTabs: 0 })).toBe("page");
  });
});
