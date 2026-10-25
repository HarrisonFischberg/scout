import { describe, expect, it } from "vitest";
import { AppleModelError, appleGenerate, appleStatus } from "../../src/providers/apple";

describe("Apple on-device model client", () => {
  it("reports available, or the reason it is not", async () => {
    expect(await appleStatus(async () => ({ ok: true, available: true }))).toEqual({ available: true });
    expect(await appleStatus(async () => ({ ok: true, available: false, reason: "not_enabled" }))).toEqual({ available: false, reason: "not_enabled" });
    expect(await appleStatus(async () => ({ ok: true, available: false, reason: "something_new" }))).toEqual({ available: false, reason: "unknown" });
  });

  it("treats an old extension (no handler) or a failed call as unavailable", async () => {
    expect(await appleStatus(async () => ({ ok: false, error: "unknown_type" }))).toEqual({ available: false, reason: "unknown" });
    expect(await appleStatus(async () => { throw new Error("no native app"); })).toEqual({ available: false, reason: "unknown" });
  });

  it("sends the prompt and returns the reply text", async () => {
    let sent: unknown;
    const text = await appleGenerate(async (m) => { sent = m; return { ok: true, text: "Hello!" }; }, { system: "Be brief.", prompt: "Hi", maxTokens: 50 });
    expect(text).toBe("Hello!");
    expect(sent).toEqual({ type: "ai.apple.generate", system: "Be brief.", prompt: "Hi", maxTokens: 50 });
  });

  it("explains a page that is too long in plain words", async () => {
    const err = await appleGenerate(async () => ({ ok: false, error: "too_long" }), { prompt: "x" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppleModelError);
    expect((err as Error).message).toMatch(/too long for Apple's on-device model/);
  });
});
