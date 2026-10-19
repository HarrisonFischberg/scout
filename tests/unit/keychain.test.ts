import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KeychainError, createKeychain } from "../../src/keychain";

// Fake native side: an in-memory map standing in for the Keychain.
function fakeNative() {
  const items = new Map<string, string>();
  const log: unknown[] = [];
  const send = async (message: unknown) => {
    log.push(message);
    const m = message as { type: string; account: string; value?: string };
    if (m.type === "keychain.set") items.set(m.account, m.value ?? "");
    if (m.type === "keychain.delete") items.delete(m.account);
    if (m.type === "keychain.get") {
      const value = items.get(m.account);
      return value === undefined ? { ok: true } : { ok: true, value };
    }
    return { ok: true };
  };
  return { send, items, log };
}

describe("keychain bridge", () => {
  it("sets, gets, and deletes a key", async () => {
    const native = fakeNative();
    const kc = createKeychain(native.send);
    expect(await kc.getKey("anthropic")).toBeNull();
    await kc.setKey("anthropic", "sk-test-synthetic");
    expect(await kc.getKey("anthropic")).toBe("sk-test-synthetic");
    await kc.deleteKey("anthropic");
    expect(await kc.getKey("anthropic")).toBeNull();
  });

  it("keeps providers separate", async () => {
    const kc = createKeychain(fakeNative().send);
    await kc.setKey("anthropic", "a-key");
    await kc.setKey("openai", "o-key");
    expect(await kc.getKey("anthropic")).toBe("a-key");
    expect(await kc.getKey("openai")).toBe("o-key");
  });

  it("maps native errors to KeychainError", async () => {
    const kc = createKeychain(async () => ({ ok: false, error: "keychain_error" }));
    await expect(kc.getKey("openai")).rejects.toMatchObject({ code: "keychain_error" });
    const silent = createKeychain(async () => undefined);
    await expect(silent.getKey("openai")).rejects.toBeInstanceOf(KeychainError);
  });

  it("rejects an empty key without a native call", async () => {
    const native = fakeNative();
    await expect(createKeychain(native.send).setKey("openai", "")).rejects.toMatchObject({
      code: "empty_key",
    });
    expect(native.log).toHaveLength(0);
  });

  it("source never persists the key in extension storage", () => {
    const src = join(__dirname, "../../src");
    for (const name of readdirSync(src).filter((f) => f.endsWith(".ts"))) {
      let text = readFileSync(join(src, name), "utf8");
      // Chrome and Firefox have no Keychain (owner's choice 2026-10-19): only
      // createStorageSend keeps the key in local extension storage, and only
      // non-Safari builds use it (check:release proves Safari bundles drop it).
      if (name === "keychain.ts") {
        expect(text).toMatch(/__SCOUT_TARGET__ !== "safari"\s*\?\s*\(message\) => \{\s*const local = browser\.storage\?\.local;/);
        text = text.replace(/export const nativeSend[\s\S]*$/, "");
      }
      expect(text, `${name} uses browser.storage`).not.toMatch(/\bstorage\.(local|sync|session)\b/);
      expect(text, `${name} uses localStorage`).not.toMatch(/\b(localStorage|sessionStorage)\b/);
    }
  });
});
