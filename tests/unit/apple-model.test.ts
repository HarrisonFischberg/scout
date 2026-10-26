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

describe("key problems in chat errors", () => {
  it("recognizes the messages fixed in Settings, and nothing else", async () => {
    const { ProviderError, isKeyProblem } = await import("../../src/providers/errors");
    expect(isKeyProblem(new ProviderError("anthropic", "auth_invalid").message)).toBe(true);
    expect(isKeyProblem(new ProviderError("openai", "no_credit").message)).toBe(true);
    expect(isKeyProblem(new ProviderError("anthropic", "provider_unavailable").message)).toBe(false);
    expect(isKeyProblem("Something went wrong. Try again.")).toBe(false);
  });
});

describe("Apple model as a chat provider", () => {
  it("cuts a long page to fit but keeps the question at the end", async () => {
    const { applePrompt, APPLE_PROMPT_CHARS } = await import("../../src/providers/apple");
    const long = "x".repeat(50_000) + "\n\nUser question: what does it cost?";
    const p = applePrompt([{ role: "user", content: long }]);
    expect(p.length).toBeLessThanOrEqual(APPLE_PROMPT_CHARS);
    expect(p).toContain("what does it cost?");
    expect(p).toContain("shortened to fit");
  });

  it("streams one reply, and retries once with half the page when it is too long", async () => {
    const { createApple } = await import("../../src/providers/apple");
    const prompts: string[] = [];
    const client = createApple(async (m) => {
      const msg = m as { prompt: string };
      prompts.push(msg.prompt);
      return prompts.length === 1 ? { ok: false, error: "too_long" } : { ok: true, text: "Short answer." };
    });
    const events = [];
    for await (const ev of client.stream({ model: "apple-on-device", system: "Be brief.", messages: [{ role: "user", content: "y".repeat(20_000) }], maxTokens: 2000 })) events.push(ev);
    expect(events[0]).toEqual({ type: "text", delta: "Short answer." });
    expect(events[events.length - 1]).toEqual({ type: "done" });
    expect(prompts).toHaveLength(2);
    expect(prompts[1]!.length).toBeLessThan(prompts[0]!.length);
  });
});
