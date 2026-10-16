// Keychain bridge client (T004). The API key travels over native messaging
// only. It is never persisted in extension storage, logs, or prompts.
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

// Safari ignores the application id and routes to the containing app's extension.
export const nativeSend: NativeSend = (message) =>
  browser.runtime.sendNativeMessage("com.example.AssistAnt", message);
