import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHROME_SHIM, GECKO_ID, manifestFor } from "../../scripts/targets.mjs";
import { STORED_KEY_PREFIX, createKeychain, createStorageSend } from "../../src/keychain";

const source = JSON.parse(readFileSync(new URL("../../src/manifest.json", import.meta.url).pathname, "utf8")) as Record<string, unknown>;

describe("per-browser manifests", () => {
  it("Safari keeps the source manifest as is", () => {
    expect(manifestFor("safari", source)).toEqual(source);
  });

  it("Chrome uses a service worker and drops native messaging", () => {
    const m = manifestFor("chrome", source);
    expect(m.background).toEqual({ service_worker: "background.js" });
    expect(m.permissions).not.toContain("nativeMessaging");
    expect(m.permissions).toEqual(expect.arrayContaining(["storage", "scripting", "tabs", "activeTab"]));
    expect(m.browser_specific_settings).toBeUndefined();
    expect(m.manifest_version).toBe(3);
  });

  it("Firefox keeps background scripts and has a fixed add-on ID and data-use declaration", () => {
    const m = manifestFor("firefox", source);
    expect(m.background).toEqual({ scripts: ["background.js"] });
    expect(m.permissions).not.toContain("nativeMessaging");
    expect(m.browser_specific_settings.gecko.id).toBe(GECKO_ID);
    expect(GECKO_ID).toBe("scout-ai-assistant@harrisonfischberg");
    expect(m.browser_specific_settings.gecko.data_collection_permissions.required).toEqual(["websiteContent", "browsingActivity"]);
  });

  it("does not change the source object", () => {
    const before = JSON.stringify(source);
    manifestFor("chrome", source);
    manifestFor("firefox", source);
    expect(JSON.stringify(source)).toBe(before);
  });

  it("rejects an unknown browser", () => {
    expect(() => manifestFor("edge", source)).toThrow(/unknown target/);
  });
});

describe("Chrome shim", () => {
  type Listener = (m: unknown, s: unknown, respond: (v: unknown) => void) => unknown;
  function fakeChrome() {
    const listeners: Listener[] = [];
    const tabs = {
      calls: 0,
      query(this: unknown) {
        if (this !== tabs) throw new TypeError("Illegal invocation");
        tabs.calls++;
        return Promise.resolve([]);
      },
    };
    const chrome = {
      tabs,
      runtime: {
        id: "abc",
        onMessage: {
          addListener: (fn: Listener) => listeners.push(fn),
          removeListener: (fn: Listener) => listeners.splice(listeners.indexOf(fn), 1),
          hasListener: (fn: Listener) => listeners.includes(fn),
        },
      },
    };
    return { chrome, listeners };
  }
  const install = (chrome: unknown): Record<string, any> => {
    const g: Record<string, unknown> = {};
    new Function("globalThis", "chrome", CHROME_SHIM)(g, chrome);
    return g.browser as Record<string, any>;
  };

  it("answers a returned Promise through sendResponse", async () => {
    const { chrome, listeners } = fakeChrome();
    const browser = install(chrome);
    browser.runtime.onMessage.addListener(async (m: unknown) => ({ echo: m }));
    let answer: unknown;
    const keepOpen = listeners[0]("hi", {}, (v) => (answer = v));
    expect(keepOpen).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(answer).toEqual({ echo: "hi" });
  });

  it("leaves the channel closed for listeners that answer nothing", () => {
    const { chrome, listeners } = fakeChrome();
    const browser = install(chrome);
    const fn = () => undefined;
    browser.runtime.onMessage.addListener(fn);
    expect(listeners[0]("hi", {}, () => undefined)).toBe(false);
    expect(browser.runtime.onMessage.hasListener(fn)).toBe(true);
    browser.runtime.onMessage.removeListener(fn);
    expect(listeners).toHaveLength(0);
  });

  it("calls Chrome's functions on their own object", async () => {
    const { chrome } = fakeChrome();
    const browser = install(chrome);
    await browser.tabs.query({});
    expect(chrome.tabs.calls).toBe(1);
    expect(browser.runtime.id).toBe("abc");
  });

  it("does nothing where `browser` already exists (Safari, Firefox)", () => {
    const g: Record<string, unknown> = { browser: "native" };
    new Function("globalThis", "chrome", CHROME_SHIM)(g, fakeChrome().chrome);
    expect(g.browser).toBe("native");
  });
});

describe("key storage on Chrome and Firefox", () => {
  function fakeStorage() {
    const items: Record<string, unknown> = {};
    return {
      items,
      get: async (k: string | string[]) => Object.fromEntries([k].flat().filter((x) => x in items).map((x) => [x, items[x]])),
      set: async (v: Record<string, unknown>) => void Object.assign(items, v),
      remove: async (keys: string[]) => keys.forEach((k) => delete items[k]),
    };
  }

  it("saves, reads and removes a key in local storage", async () => {
    const storage = fakeStorage();
    const keychain = createKeychain(createStorageSend(storage));
    expect(await keychain.getKey("anthropic")).toBeNull();
    await keychain.setKey("anthropic", "sk-ant-test-synthetic-0000");
    expect(storage.items[STORED_KEY_PREFIX + "anthropic"]).toBe("sk-ant-test-synthetic-0000");
    expect(await keychain.getKey("anthropic")).toBe("sk-ant-test-synthetic-0000");
    expect(await keychain.getKey("openai")).toBeNull();
    await keychain.deleteKey("anthropic");
    expect(await keychain.getKey("anthropic")).toBeNull();
    expect(Object.keys(storage.items)).toEqual([]);
  });

  it("refuses an empty key and an unknown provider", async () => {
    const send = createStorageSend(fakeStorage());
    await expect(createKeychain(send).setKey("openai", "")).rejects.toThrow(/empty_key/);
    expect(await send({ type: "keychain.get", account: "other" })).toEqual({ ok: false, error: "bad_account" });
  });

  it("has no organization blocklist outside Safari", async () => {
    expect(await createStorageSend(fakeStorage())({ type: "policy.get" })).toEqual({ ok: true, blocked: [] });
  });

  it("answers other native requests as unsupported", async () => {
    expect(await createStorageSend(fakeStorage())({ type: "debug.stage", stage: "x" })).toEqual({ ok: false, error: "unsupported" });
  });
});
