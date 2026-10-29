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
    getPlatformInfo?(): Promise<{ os: string }>;
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
      Array<{ id?: number; windowId?: number; title?: string; url?: string; active?: boolean; incognito?: boolean; favIconUrl?: string }>
    >;
    // Part 2 tool host. Optional where the e2e stubs leave them out.
    get?(tabId: number): Promise<{ id?: number; windowId?: number; title?: string; url?: string; active?: boolean; incognito?: boolean; status?: string }>;
    create?(props: { url: string; active?: boolean; windowId?: number }): Promise<{ id?: number; windowId?: number; title?: string; url?: string }>;
    remove?(tabIds: number | number[]): Promise<void>;
    update?(tabId: number, props: { active?: boolean; url?: string }): Promise<unknown>;
    captureVisibleTab?(windowId?: number, options?: { format?: "jpeg" | "png"; quality?: number }): Promise<string>;
    // Not in Safari (MDN browser-compat-data); kept so the host can use them where they exist.
    group?(options: { tabIds: number[] }): Promise<number>;
    ungroup?(tabIds: number[]): Promise<void>;
    sendMessage?(tabId: number, message: unknown): Promise<unknown>;
    onActivated?: { addListener(fn: (info: { tabId: number; windowId?: number }) => void): void };
    onRemoved?: { addListener(fn: (tabId: number) => void): void };
    // Coupon browser fallback: tabs a background coupon page opens are closed with it.
    onCreated?: {
      addListener(fn: (tab: { id?: number; openerTabId?: number }) => void): void;
      removeListener?(fn: (tab: { id?: number; openerTabId?: number }) => void): void;
    };
  };
  // Not in Safari (MDN browser-compat-data); search_tabs uses them where they exist.
  history?: {
    search(query: { text: string; maxResults?: number; startTime?: number }): Promise<Array<{ url?: string; title?: string }>>;
  };
  sessions?: {
    getRecentlyClosed(filter?: { maxResults?: number }): Promise<Array<{ tab?: { url?: string; title?: string } }>>;
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
    contains?(perms: { origins: string[] }): Promise<boolean>;
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
      remove?(keys: string[]): Promise<void>;
    };
    /** Kept while Safari runs, cleared when it quits; survives the worker being unloaded. */
    session?: {
      get(keys: string | string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
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
/** Which browser this bundle is for (scripts/build.mjs, SCOUT_TARGET). */
declare const __SCOUT_TARGET__: "safari" | "chrome" | "firefox";
