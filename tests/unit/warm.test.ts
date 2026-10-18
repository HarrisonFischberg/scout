import { describe, expect, it, vi } from "vitest";
import { envelope } from "../../src/bridge/messages";
import { createWarmer, hintedProvider, parseKeyHint, sameHint, WARM_EVERY_MS } from "../../src/panel/warm";

// Owner request 2026-10-18: from Safari not running to Scout open took 2-5 s
// on iPhone; it should be immediate. The worker wakes the app's native handler
// before the panel needs it, and the panel shows the question box from a
// remembered "has a key" flag instead of waiting for the Keychain.
describe("waking the native handler", () => {
  it("sends one harmless request, then waits WARM_EVERY_MS before the next", async () => {
    let t = 1_000;
    const send = vi.fn(async (_m: unknown) => ({ ok: true }));
    const warm = createWarmer(send, () => t);
    expect(await warm()).toBe(true);
    expect(send).toHaveBeenCalledWith({ type: "policy.get" });
    t += WARM_EVERY_MS - 1;
    expect(await warm()).toBe(false);
    t += 1;
    expect(await warm()).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("shares one request between calls made while it is out, and survives a failure", async () => {
    let answer: (v: unknown) => void = () => undefined;
    const send = vi.fn(() => new Promise((res) => (answer = res)));
    const warm = createWarmer(send, () => 0);
    const a = warm();
    const b = warm();
    expect(send).toHaveBeenCalledTimes(1);
    answer({ ok: true });
    expect(await a).toBe(true);
    expect(await b).toBe(true);
    const failing = createWarmer(async () => Promise.reject(new Error("no handler")), () => 0);
    expect(await failing()).toBe(false);
  });
});

describe("key hint", () => {
  it("reads only true as a saved key", () => {
    expect(parseKeyHint(undefined)).toEqual({ anthropic: false, openai: false });
    expect(parseKeyHint({ anthropic: true, openai: "yes" })).toEqual({ anthropic: true, openai: false });
    expect(parseKeyHint({ anthropic: "sk-ant-x", openai: 1 })).toEqual({ anthropic: false, openai: false });
    expect(sameHint({ anthropic: true, openai: false }, { anthropic: true, openai: false })).toBe(true);
    expect(sameHint({ anthropic: true, openai: false }, { anthropic: true, openai: true })).toBe(false);
  });

  it("picks the provider the real key lookup would: the chosen one first, then the other", () => {
    expect(hintedProvider("anthropic", { anthropic: true, openai: true })).toBe("anthropic");
    expect(hintedProvider("openai", { anthropic: true, openai: true })).toBe("openai");
    expect(hintedProvider("openai", { anthropic: true, openai: false })).toBe("anthropic");
    expect(hintedProvider("anthropic", { anthropic: false, openai: false })).toBeNull();
  });
});

// Real worker, minimal Safari stub.
describe("worker panel.warm", () => {
  it("answers the page button at once and wakes the native handler once", async () => {
    type Listener = (m: unknown, s: unknown) => Promise<unknown>;
    let onMessage: Listener | undefined;
    const on = () => ({ addListener: () => undefined });
    const native = vi.fn(async (_app: string, _m: unknown) => ({ ok: true, list: [] }));
    (globalThis as unknown as Record<string, unknown>).browser = {
      runtime: {
        id: "scout-test",
        getURL: (p: string) => "safari-web-extension://scout-test/" + p,
        getPlatformInfo: async () => ({ os: "ios" }),
        sendNativeMessage: native,
        onMessage: { addListener: (f: Listener) => void (onMessage = f) },
        onConnect: on(),
        onStartup: on(),
        onInstalled: on(),
      },
      storage: { local: { get: async () => ({}), set: async () => undefined, remove: async () => undefined }, onChanged: on() },
      action: { setTitle: async () => undefined, setIcon: async () => undefined },
      tabs: { onRemoved: on(), onUpdated: on(), query: async () => [] },
      scripting: { executeScript: async () => [] },
      permissions: { getAll: async () => ({ origins: [] }), onAdded: on(), onRemoved: on() },
    };
    vi.resetModules();
    await import("../../src/background");
    const page = { id: "scout-test", url: "https://news.test/a", tab: { id: 4 } };
    const reply = (await onMessage?.(envelope("panel.warm", {}), page)) as { type: string };
    expect(reply.type).toBe("panel.warm.result");
    await onMessage?.(envelope("panel.warm", {}), page);
    await new Promise((r) => setTimeout(r, 10));
    const warms = native.mock.calls.filter(([, m]) => (m as { type: string }).type === "policy.get");
    expect(warms).toHaveLength(1);
    // A web page without Scout's id cannot ask.
    expect(await onMessage?.(envelope("panel.warm", {}), { ...page, id: "other" })).toBeUndefined();
  });
});
