// Settings (T015): provider/model, history retention, Delete all data.
// The API key is never stored here; it lives in the Keychain (keychain.ts).
import type { Provider } from "../keychain";

export type Retention = "off" | "7" | "30";

export interface Settings {
  provider: Provider;
  model: string;
  retention: Retention;
}

export type HistoryKind = "chat" | "agent" | "coupons";

export interface HistoryEntry {
  at: number;
  question: string;
  answer: string;
  /** What produced the entry. Absent on entries saved before T025 (chat). */
  kind?: HistoryKind;
}

/** Storage key for the start of the current conversation ("New chat" resets it). */
export const CHAT_START_KEY = "chatStartedAt";

// Minimal view of `browser.storage.local`, so tests can pass a fake.
export interface StorageArea {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  clear(): Promise<void>;
}

export const DEFAULT_MODEL: Record<Provider, string> = {
  anthropic: "claude-sonnet-5-5",
  openai: "gpt-5",
};

export const DEFAULT_SETTINGS: Settings = {
  provider: "anthropic",
  model: DEFAULT_MODEL.anthropic,
  retention: "7",
};

const DAY_MS = 24 * 60 * 60 * 1000;
const SETTINGS_KEY = "settings";
const HISTORY_KEY = "history";
const MAX_ENTRIES = 200;

function isProvider(v: unknown): v is Provider {
  return v === "anthropic" || v === "openai";
}

function isRetention(v: unknown): v is Retention {
  return v === "off" || v === "7" || v === "30";
}

// Stored data is untrusted input: anything malformed falls back to the default.
export function parseSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const provider = isProvider(r.provider) ? r.provider : DEFAULT_SETTINGS.provider;
  const model =
    typeof r.model === "string" && r.model.trim() ? r.model.trim() : DEFAULT_MODEL[provider];
  const retention = isRetention(r.retention) ? r.retention : DEFAULT_SETTINGS.retention;
  return { provider, model, retention };
}

export async function loadSettings(storage: StorageArea): Promise<Settings> {
  const got = await storage.get(SETTINGS_KEY);
  return parseSettings(got[SETTINGS_KEY]);
}

export async function saveSettings(storage: StorageArea, settings: Settings): Promise<void> {
  await storage.set({ [SETTINGS_KEY]: parseSettings(settings) });
}

// Entries older than the retention window are dropped. "off" keeps nothing.
export function pruneHistory(
  entries: HistoryEntry[],
  retention: Retention,
  now: number,
): HistoryEntry[] {
  if (retention === "off") return [];
  const cutoff = now - Number(retention) * DAY_MS;
  return entries.filter((e) => e.at > cutoff).slice(-MAX_ENTRIES);
}

function parseHistory(raw: unknown): HistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((e: unknown) => {
    const r = e as Partial<HistoryEntry> | null;
    return r && typeof r.at === "number" && typeof r.question === "string" && typeof r.answer === "string"
      ? [
          {
            at: r.at,
            question: r.question,
            answer: r.answer,
            ...(r.kind === "agent" || r.kind === "coupons" || r.kind === "chat" ? { kind: r.kind } : {}),
          },
        ]
      : [];
  });
}

// Loads history, writes back the pruned list, and returns it.
export async function loadHistory(
  storage: StorageArea,
  retention: Retention,
  now: number,
): Promise<HistoryEntry[]> {
  const got = await storage.get(HISTORY_KEY);
  const all = parseHistory(got[HISTORY_KEY]);
  const kept = pruneHistory(all, retention, now);
  if (kept.length !== all.length) await storage.set({ [HISTORY_KEY]: kept });
  return kept;
}

export async function appendHistory(
  storage: StorageArea,
  retention: Retention,
  entry: HistoryEntry,
): Promise<void> {
  if (retention === "off") return;
  const got = await storage.get(HISTORY_KEY);
  const next = pruneHistory([...parseHistory(got[HISTORY_KEY]), entry], retention, entry.at);
  await storage.set({ [HISTORY_KEY]: next });
}

export interface DeleteDeps {
  storage: StorageArea;
  deleteKey(provider: Provider): Promise<void>;
  listGrantedOrigins(): Promise<string[]>;
  removeOrigins(origins: string[]): Promise<void>;
}

export interface DeleteReport {
  keychain: boolean;
  storage: boolean;
  siteAccess: boolean;
  // Sites still granted after removal. Safari can keep access the user gave
  // through its own prompt, so this is re-read, never assumed empty.
  remainingOrigins: string[];
}

// Each step runs even if an earlier one fails; the report says which did.
export async function deleteAllData(deps: DeleteDeps): Promise<DeleteReport> {
  const attempt = async (fn: () => Promise<void>): Promise<boolean> => {
    try {
      await fn();
      return true;
    } catch {
      return false;
    }
  };
  const keychain = await attempt(async () => {
    await deps.deleteKey("anthropic");
    await deps.deleteKey("openai");
  });
  const storage = await attempt(() => deps.storage.clear());
  let remainingOrigins: string[] = [];
  const removed = await attempt(async () => {
    const origins = await deps.listGrantedOrigins();
    if (origins.length) await deps.removeOrigins(origins);
  });
  try {
    remainingOrigins = await deps.listGrantedOrigins();
  } catch {
    remainingOrigins = [];
  }
  const siteAccess = removed && remainingOrigins.length === 0;
  return { keychain, storage, siteAccess, remainingOrigins };
}

// Plain-language result shown next to the Delete button.
export function deleteReportText(r: DeleteReport): string {
  const parts: string[] = [];
  const failed = [
    r.keychain ? "" : "your API keys in Keychain",
    r.storage ? "" : "saved settings and history",
  ].filter(Boolean);
  if (failed.length) parts.push("Could not delete " + failed.join(" or ") + ". Try again.");
  if (r.remainingOrigins.length) {
    const sites = r.remainingOrigins.map((o) => o.replace(/^\*:\/\/\*?\.?/, "").replace(/\/\*$/, "")).join(", ");
    parts.push(
      "Safari still lets AssistAnt read: " + sites + ". Remove it in Safari's extension settings: " +
        "on iPhone, Settings > Apps > Safari > Extensions > AssistAnt; on Mac, Safari > Settings > Extensions > AssistAnt > Edit Websites.",
    );
  } else if (!r.siteAccess) {
    parts.push("Could not remove site access. Check Safari's extension settings.");
  }
  if (r.keychain && r.storage) parts.unshift("Deleted your API keys, settings, and history from this device.");
  return parts.join(" ");
}

/** Entries in the current conversation: those saved since the last "New chat". */
export async function loadConversation(
  storage: StorageArea,
  retention: Retention,
  now: number,
): Promise<HistoryEntry[]> {
  const all = await loadHistory(storage, retention, now);
  const got = await storage.get(CHAT_START_KEY);
  const start = typeof got[CHAT_START_KEY] === "number" ? (got[CHAT_START_KEY] as number) : 0;
  return all.filter((e) => e.at >= start);
}

/** Starts a new conversation; earlier entries stay in history until they expire. */
export async function startNewConversation(storage: StorageArea, now: number): Promise<void> {
  await storage.set({ [CHAT_START_KEY]: now });
}

/** Removes all saved chat history. */
export async function clearHistory(storage: StorageArea): Promise<void> {
  await storage.set({ [HISTORY_KEY]: [] });
}
