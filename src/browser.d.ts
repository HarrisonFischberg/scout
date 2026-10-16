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
    query(info: { active: boolean; currentWindow: boolean }): Promise<Array<{ id?: number }>>;
    sendMessage(tabId: number, message: unknown): Promise<unknown>;
  };
  scripting: {
    executeScript(injection: {
      target: { tabId: number };
      func?: () => unknown;
      files?: string[];
    }): Promise<Array<{ result?: unknown }>>;
  };
};
