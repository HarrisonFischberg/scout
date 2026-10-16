// Minimal ambient types for the Safari WebExtension `browser` namespace.
// Only what src/ uses. Replace with full typings when more APIs are used.
interface BrowserMessageSender {
  id?: string;
  url?: string;
  origin?: string;
  tab?: { id?: number };
  frameId?: number;
}

interface BrowserPort {
  name: string;
  sender?: BrowserMessageSender;
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: { addListener(fn: (message: unknown) => void): void };
  onDisconnect: { addListener(fn: () => void): void };
}

interface BrowserContentScript {
  id: string;
  js?: string[];
  matches?: string[];
  runAt?: "document_start" | "document_end" | "document_idle";
  allFrames?: boolean;
}

declare const browser: {
  runtime: {
    // Optional where the e2e stubs leave them out; the popup degrades without them.
    id?: string;
    getURL?(path: string): string;
    sendMessage(message: unknown): Promise<unknown>;
    sendNativeMessage(application: string, message: unknown): Promise<unknown>;
    connect?(info: { name: string }): BrowserPort;
    onMessage: {
      addListener(
        listener: (message: unknown, sender?: BrowserMessageSender) => Promise<unknown> | unknown,
      ): void;
    };
    onConnect?: { addListener(fn: (port: BrowserPort) => void): void };
    onStartup?: { addListener(fn: () => void): void };
    onInstalled?: { addListener(fn: () => void): void };
  };
  tabs: {
    query(info: { active?: boolean; currentWindow?: boolean }): Promise<
      Array<{ id?: number; windowId?: number; title?: string; url?: string; active?: boolean; incognito?: boolean }>
    >;
    sendMessage?(tabId: number, message: unknown): Promise<unknown>;
    onActivated?: { addListener(fn: (info: { tabId: number; windowId?: number }) => void): void };
    onRemoved?: { addListener(fn: (tabId: number) => void): void };
  };
  action?: {
    setIcon?(details: { path: Record<string, string>; tabId?: number }): Promise<void>;
    setTitle?(details: { title: string; tabId?: number }): Promise<void>;
    openPopup?(): Promise<void>;
  };
  extension?: { inIncognitoContext?: boolean };
  permissions: {
    request(perms: { origins: string[] }): Promise<boolean>;
    getAll(): Promise<{ origins?: string[] }>;
    remove(perms: { origins: string[] }): Promise<boolean>;
    onAdded?: { addListener(fn: () => void): void };
    onRemoved?: { addListener(fn: () => void): void };
  };
  // Optional so a missing storage area (tests, odd contexts) is handled.
  storage?: {
    local: {
      get(keys: string | string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      clear(): Promise<void>;
    };
    onChanged?: {
      addListener(fn: (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string) => void): void;
    };
  };
  scripting: {
    executeScript(injection: {
      target: { tabId: number };
      func?: (...args: never[]) => unknown;
      args?: unknown[];
      files?: string[];
    }): Promise<Array<{ result?: unknown }>>;
    // Safari 16.4+. Optional so older Safari and the e2e stubs degrade.
    registerContentScripts?(scripts: BrowserContentScript[]): Promise<void>;
    unregisterContentScripts?(filter: { ids: string[] }): Promise<void>;
    getRegisteredContentScripts?(filter: { ids: string[] }): Promise<BrowserContentScript[]>;
  };
};

/** Set by scripts/build.mjs: true for debug builds, false for release. */
declare const __SCOUT_DEBUG__: boolean;
declare const __SCOUT_VERSION__: string;
