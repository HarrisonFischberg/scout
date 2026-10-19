// Keychain bridge client (T004). On Safari the API key travels over native
// messaging only and is never persisted in extension storage. On Chrome and
// Firefox it is kept in local extension storage (createStorageSend). Never in
// logs or prompts on any browser.
export type Provider = "anthropic" | "openai";

export type NativeSend = (message: unknown) => Promise<unknown>;

export class KeychainError extends Error {
  constructor(readonly code: string) {
    super(`keychain: ${code}`);
    this.name = "KeychainError";
  }
}

interface NativeReply {
  ok?: boolean;
  value?: string;
  error?: string;
}

async function call(send: NativeSend, message: object): Promise<NativeReply> {
  const reply = (await send(message)) as NativeReply | undefined;
  if (!reply || reply.ok !== true) {
    throw new KeychainError(reply?.error ?? "no_reply");
  }
  return reply;
}

export function createKeychain(send: NativeSend) {
  return {
    async setKey(provider: Provider, key: string): Promise<void> {
      if (!key) throw new KeychainError("empty_key");
      await call(send, { type: "keychain.set", account: provider, value: key });
    },
    async getKey(provider: Provider): Promise<string | null> {
      const reply = await call(send, { type: "keychain.get", account: provider });
      return reply.value ?? null;
    },
    async deleteKey(provider: Provider): Promise<void> {
      await call(send, { type: "keychain.delete", account: provider });
    },
  };
}

/** Local extension storage key holding a provider's API key on Chrome and Firefox. */
export const STORED_KEY_PREFIX = "apiKey:";

export interface KeyStorage {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove?(keys: string[]): Promise<void>;
}

/**
 * Chrome and Firefox have no host app, so no Keychain. The key lives in the
 * extension's local storage on this computer (owner's choice 2026-10-19),
 * never synced. Answers the same messages as the Safari native handler;
 * there is no organization policy outside Safari, so policy.get blocks nothing.
 */
export function createStorageSend(storage: KeyStorage): NativeSend {
  const isProvider = (a: unknown): a is Provider => a === "anthropic" || a === "openai";
  return async (message) => {
    const m = (message ?? {}) as { type?: unknown; account?: unknown; value?: unknown };
    if (m.type === "policy.get") return { ok: true, blocked: [] };
    if (typeof m.type !== "string" || !m.type.startsWith("keychain.")) return { ok: false, error: "unsupported" };
    if (!isProvider(m.account)) return { ok: false, error: "bad_account" };
    const key = STORED_KEY_PREFIX + m.account;
    if (m.type === "keychain.get") {
      const value = (await storage.get(key))[key];
      return { ok: true, value: typeof value === "string" && value ? value : undefined };
    }
    if (m.type === "keychain.set") {
      if (typeof m.value !== "string" || !m.value) return { ok: false, error: "empty_key" };
      await storage.set({ [key]: m.value });
      return { ok: true };
    }
    if (m.type === "keychain.delete") {
      if (storage.remove) await storage.remove([key]);
      else await storage.set({ [key]: "" });
      return { ok: true };
    }
    return { ok: false, error: "unsupported" };
  };
}

// Safari ignores the application id and routes to the containing app's extension.
const safariSend: NativeSend = (message) => browser.runtime.sendNativeMessage("com.example.SafariScout", message);

export const nativeSend: NativeSend =
  typeof __SCOUT_TARGET__ !== "undefined" && __SCOUT_TARGET__ !== "safari"
    ? (message) => {
        const local = browser.storage?.local;
        return local ? createStorageSend(local)(message) : Promise.resolve({ ok: false, error: "no_storage" });
      }
    : safariSend;
