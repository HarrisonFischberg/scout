// Minimal ambient types for the Safari WebExtension `browser` namespace.
// Only what src/ uses. Replace with full typings when more APIs are used.
declare const browser: {
  runtime: {
    sendMessage(message: unknown): Promise<unknown>;
    sendNativeMessage(application: string, message: unknown): Promise<unknown>;
    onMessage: {
      addListener(
        listener: (message: unknown) => Promise<unknown> | unknown,
      ): void;
    };
  };
  tabs: {
    query(info: { active?: boolean; currentWindow?: boolean }): Promise<
      Array<{ id?: number; title?: string; url?: string; active?: boolean }>
    >;
    sendMessage(tabId: number, message: unknown): Promise<unknown>;
  };
  permissions: {
    request(perms: { origins: string[] }): Promise<boolean>;
    getAll(): Promise<{ origins?: string[] }>;
    remove(perms: { origins: string[] }): Promise<boolean>;
  };
  // Optional so a missing storage area (tests, odd contexts) is handled.
  storage?: {
    local: {
      get(keys: string | string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      clear(): Promise<void>;
    };
  };
  scripting: {
    executeScript(injection: {
      target: { tabId: number };
      func?: (...args: never[]) => unknown;
      args?: unknown[];
      files?: string[];
    }): Promise<Array<{ result?: unknown }>>;
  };
};
