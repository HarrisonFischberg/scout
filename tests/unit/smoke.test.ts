import { describe, expect, it } from "vitest";

describe("harness", () => {
  it("runs a unit test", () => {
    expect([1, 2, 3].reduce((a, b) => a + b, 0)).toBe(6);
  });
});
