import { describe, expect, it, vi } from "vitest";
import { runTurn } from "../../src/chat/session";
import { createProvider, ProviderError, type FetchLike } from "../../src/providers";
import { checkKey } from "../../src/providers/keytest";
import { loadModelList } from "../../src/providers/models";
import {
  CONSENT_KEY,
  CONSENT_VERSION,
  Consent,
  consentText,
  ensureConsent,
  gatedFetch,
  parseConsent,
  API_TERMS,
  PRIVACY_POLICY,
  providerForUrl,
} from "../../src/settings/consent";
import { deleteAllData, type StorageArea } from "../../src/settings/settings";

// App Store Review Guideline 5.1.2(i): nothing reaches a third-party AI
// provider before the user allows it. Synthetic data, no network.
function fakeStorage(initial: Record<string, unknown> = {}): StorageArea & { data: Record<string, unknown> } {
  const data = { ...initial };
  return {
    data,
    async get(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((k) => k in data).map((k) => [k, data[k]]));
    },
    async set(items) {
      Object.assign(data, items);
    },
    async clear() {
      for (const k of Object.keys(data)) delete data[k];
    },
  };
}

const NOW = Date.UTC(2026, 9, 16);
const okFetch = (): FetchLike & { mock: { calls: unknown[][] } } =>
  vi.fn(async () => new Response("{}", { status: 200 })) as unknown as FetchLike & { mock: { calls: unknown[][] } };

describe("consent storage", () => {
  it("starts with no consent for either provider", async () => {
    const c = await Consent.load(fakeStorage());
    expect(c.has("anthropic")).toBe(false);
    expect(c.has("openai")).toBe(false);
  });

  it("is per provider: allowing Anthropic does not allow OpenAI", async () => {
    const storage = fakeStorage();
    const c = await Consent.load(storage);
    await c.grant("anthropic", NOW);
    expect(c.has("anthropic")).toBe(true);
    expect(c.has("openai")).toBe(false);
    expect(storage.data[CONSENT_KEY]).toEqual({ anthropic: { at: NOW, version: CONSENT_VERSION } });
    const reloaded = await Consent.load(storage);
    expect(reloaded.has("anthropic")).toBe(true);
    expect(reloaded.has("openai")).toBe(false);
    expect(reloaded.record("anthropic")).toEqual({ at: NOW, version: CONSENT_VERSION });
  });

  it("withdrawal removes only that provider and persists", async () => {
    const storage = fakeStorage();
    const c = await Consent.load(storage);
    await c.grant("anthropic", NOW);
    await c.grant("openai", NOW);
    await c.withdraw("anthropic");
    expect(c.has("anthropic")).toBe(false);
    expect(c.has("openai")).toBe(true);
    expect((await Consent.load(storage)).has("anthropic")).toBe(false);
  });

  it("opens the gate at once, before storage finishes, and keeps it open if storage fails", async () => {
    const broken: StorageArea = {
      get: async () => ({}),
      set: () => Promise.reject(new Error("quota")),
      clear: async () => undefined,
    };
    const c = await Consent.load(broken);
    const pending = c.grant("openai", NOW);
    expect(c.has("openai")).toBe(true);
    await expect(pending).rejects.toThrow("quota");
    expect(c.has("openai")).toBe(true);
  });

  it("works with no storage (kept for this popup only)", async () => {
    const c = await Consent.load(undefined);
    await c.grant("anthropic", NOW);
    expect(c.has("anthropic")).toBe(true);
  });

  it("treats malformed or older-version records as no consent", () => {
    expect(parseConsent(undefined)).toEqual({});
    expect(parseConsent("yes")).toEqual({});
    expect(parseConsent({ anthropic: true, openai: { at: "x", version: CONSENT_VERSION } })).toEqual({});
    expect(parseConsent({ anthropic: { at: NOW, version: CONSENT_VERSION - 1 } })).toEqual({});
    expect(parseConsent({ other: { at: NOW, version: CONSENT_VERSION } })).toEqual({});
    expect(parseConsent({ openai: { at: NOW, version: CONSENT_VERSION } })).toEqual({ openai: { at: NOW, version: CONSENT_VERSION } });
  });

  it("Delete all data clears consent", async () => {
    const storage = fakeStorage();
    const c = await Consent.load(storage);
    await c.grant("anthropic", NOW);
    await deleteAllData({
      storage,
      deleteKey: async () => undefined,
      listGrantedOrigins: async () => [],
      removeOrigins: async () => undefined,
    });
    expect((await Consent.load(storage)).has("anthropic")).toBe(false);
    c.forget();
    expect(c.has("anthropic")).toBe(false);
  });
});

describe("gatedFetch: no request reaches a provider before Allow", () => {
  it("maps provider API hosts", () => {
    expect(providerForUrl("https://api.anthropic.com/v1/messages")).toBe("anthropic");
    expect(providerForUrl("https://api.openai.com/v1/responses")).toBe("openai");
    expect(providerForUrl("https://api.anthropic.com.evil.test/v1")).toBeNull();
    expect(providerForUrl("not a url")).toBeNull();
  });

  it("blocks Anthropic and OpenAI calls until that provider is allowed", async () => {
    const c = await Consent.load(fakeStorage());
    const inner = okFetch();
    const f = gatedFetch((p) => c.has(p), inner);
    await expect(f("https://api.anthropic.com/v1/messages", { method: "POST" })).rejects.toMatchObject({
      code: "consent_required",
      provider: "anthropic",
    });
    expect(inner).not.toHaveBeenCalled();
    await c.grant("anthropic", NOW);
    await f("https://api.anthropic.com/v1/messages", { method: "POST" });
    expect(inner).toHaveBeenCalledTimes(1);
    await expect(f("https://api.openai.com/v1/responses", { method: "POST" })).rejects.toBeInstanceOf(ProviderError);
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it("blocks calls again after withdrawal", async () => {
    const c = await Consent.load(fakeStorage());
    await c.grant("openai", NOW);
    const inner = okFetch();
    const f = gatedFetch((p) => c.has(p), inner);
    await f("https://api.openai.com/v1/models", { method: "GET" });
    await c.withdraw("openai");
    await expect(f("https://api.openai.com/v1/models", { method: "GET" })).rejects.toMatchObject({ code: "consent_required" });
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it("a chat turn without consent sends nothing and says why", async () => {
    const c = await Consent.load(fakeStorage());
    const inner = okFetch();
    const provider = createProvider("anthropic", { apiKey: "sk-ant-test-synthetic", fetch: gatedFetch((p) => c.has(p), inner) });
    const result = await runTurn({
      provider,
      model: "claude-sonnet-5-5",
      history: [],
      question: "What does this page say?",
      page: { url: "https://shop.test/", title: "Shop", text: "Synthetic page text" },
      onText: () => undefined,
    });
    expect(inner).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false });
    expect(result.ok ? "" : result.error).toMatch(/permission/i);
  });

  it("OpenAI client keeps the consent error instead of reporting a network error", async () => {
    const c = await Consent.load(fakeStorage());
    const inner = okFetch();
    const provider = createProvider("openai", { apiKey: "sk-test-synthetic", fetch: gatedFetch((p) => c.has(p), inner) });
    const gen = provider.stream({ model: "gpt-5", messages: [{ role: "user", content: "hi" }], maxTokens: 16 });
    await expect(gen.next()).rejects.toMatchObject({ code: "consent_required" });
    expect(inner).not.toHaveBeenCalled();
  });

  it("key test and model list do not call the provider without consent", async () => {
    const c = await Consent.load(fakeStorage());
    const inner = okFetch();
    const f = gatedFetch((p) => c.has(p), inner);
    expect(await checkKey("anthropic", "sk-ant-test-synthetic-0000000000", f)).not.toBe("valid");
    const list = await loadModelList(undefined, "openai", "sk-test-synthetic", f, NOW);
    expect(list.source).toBe("builtin");
    expect(inner).not.toHaveBeenCalled();
  });
});

describe("ensureConsent", () => {
  it("does not ask again once allowed", async () => {
    const c = await Consent.load(fakeStorage());
    await c.grant("anthropic", NOW);
    const ask = vi.fn(async () => true);
    expect(await ensureConsent(c, "anthropic", ask, NOW)).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });

  it("Allow stores consent for that provider only", async () => {
    const storage = fakeStorage();
    const c = await Consent.load(storage);
    const ask = vi.fn(async () => true);
    expect(await ensureConsent(c, "openai", ask, NOW)).toBe(true);
    expect(ask).toHaveBeenCalledWith("openai");
    expect(c.has("openai")).toBe(true);
    expect(c.has("anthropic")).toBe(false);
    expect((await Consent.load(storage)).has("openai")).toBe(true);
  });

  it("Not now stores nothing and keeps the gate closed", async () => {
    const storage = fakeStorage();
    const c = await Consent.load(storage);
    const inner = okFetch();
    const f = gatedFetch((p) => c.has(p), inner);
    expect(await ensureConsent(c, "anthropic", async () => false, NOW)).toBe(false);
    expect(c.has("anthropic")).toBe(false);
    expect(storage.data[CONSENT_KEY]).toBeUndefined();
    await expect(f("https://api.anthropic.com/v1/messages", { method: "POST" })).rejects.toBeInstanceOf(ProviderError);
    expect(inner).not.toHaveBeenCalled();
  });

  it("asks again after withdrawal", async () => {
    const c = await Consent.load(fakeStorage());
    await c.grant("anthropic", NOW);
    await c.withdraw("anthropic");
    const ask = vi.fn(async () => false);
    expect(await ensureConsent(c, "anthropic", ask, NOW)).toBe(false);
    expect(ask).toHaveBeenCalledTimes(1);
  });
});

describe("consent text", () => {
  for (const p of ["anthropic", "openai"] as const) {
    it(`names ${p}, what is sent, and its privacy policy`, () => {
      const t = consentText(p);
      const name = p === "anthropic" ? "Anthropic" : "OpenAI";
      const all = [t.title, t.intro, ...t.items, t.after].join(" ");
      expect(t.title).toContain(name);
      expect(t.intro).toContain(name);
      expect(all).toMatch(/message/i);
      expect(all).toMatch(/page/i);
      expect(all).toMatch(/API key/);
      expect(t.policyUrl).toBe(PRIVACY_POLICY[p]);
      expect(t.policyLabel).toContain(name);
      // The privacy policies exclude API content; the API terms govern it.
      expect(t.termsUrl).toBe(API_TERMS[p]);
      expect(t.termsLabel).toBe("How " + name + " handles API data");
      expect(t.after).toMatch(/Settings/);
      // The other provider is never named, so the user knows exactly who receives data.
      expect(all).not.toContain(p === "anthropic" ? "OpenAI" : "Anthropic");
    });
  }

  it("links to each provider's own privacy policy over HTTPS", () => {
    expect(new URL(PRIVACY_POLICY.anthropic).hostname).toBe("www.anthropic.com");
    expect(new URL(PRIVACY_POLICY.openai).hostname).toBe("openai.com");
    for (const u of Object.values(PRIVACY_POLICY)) expect(u.startsWith("https://")).toBe(true);
  });

  it("links to each provider's own API data terms over HTTPS", () => {
    expect(API_TERMS.anthropic).toBe("https://www.anthropic.com/legal/commercial-terms");
    expect(API_TERMS.openai).toBe("https://openai.com/enterprise-privacy/");
  });
});
