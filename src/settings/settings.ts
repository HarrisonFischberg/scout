// Settings (T015): provider/model/effort, history retention, Delete all data.
// The API key is never stored here; it lives in the Keychain (keychain.ts).
import type { Provider } from "../keychain";
import { EFFORTS, type Effort } from "../providers/types";
import { browserName, siteAccessSettings, TARGET } from "../platform";
import { withLock } from "./lock";

export type Retention = "off" | "7" | "30";

/** "default" sends no effort setting, so the model uses its own default. */
export type EffortSetting = "default" | Effort;

export interface Settings {
  provider: Provider;
  model: string;
  effort: EffortSetting;
  retention: Retention;
}

export type HistoryKind = "chat" | "agent" | "coupons";

export interface HistoryEntry {
  at: number;
  question: string;
  answer: string;
  /** What produced the entry. Absent on entries saved before T025 (chat). */
  kind?: HistoryKind;
  /** Conversation the entry belongs to (one per tab, src/panel/state.ts). Absent on entries saved before per-tab chats. */
  conv?: string;
  /** Part 2: tabs and screenshots shared for this answer (title, host, status). Never page text. */
  shared?: Array<{ title: string; host: string; status: string }>;
  /** Host of the page the chat was on (no path), titling it in the chats menu. */
  site?: string;
  /** Numbered sources the answer may cite as [n] (pages shared, then web results): address without query, title, kind. */
  sources?: Array<{ url: string; title?: string; kind?: "page" | "web" }>;
}

/** Start of the single conversation used before per-tab chats. Read only to migrate it (src/panel/state.ts). */
export const CHAT_START_KEY = "chatStartedAt";

// Minimal view of `browser.storage.local`, so tests can pass a fake.
export interface StorageArea {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  clear(): Promise<void>;
  remove?(keys: string[]): Promise<void>;
}

export const DEFAULT_MODEL: Record<Provider, string> = {
  anthropic: "claude-haiku-5-5",
  openai: "gpt-5",
};

/** Effort that goes with each provider's default model (owner decision 2026-10-17: Haiku 5.5 at High). */
export const DEFAULT_EFFORT: Record<Provider, EffortSetting> = {
  anthropic: "high",
  openai: "default",
};

export const DEFAULT_SETTINGS: Settings = {
  provider: "anthropic",
  model: DEFAULT_MODEL.anthropic,
  effort: DEFAULT_EFFORT.anthropic,
  retention: "7",
};

const DAY_MS = 24 * 60 * 60 * 1000;
const SETTINGS_KEY = "settings";
export const HISTORY_KEY = "history";
const MAX_ENTRIES = 200;

function isProvider(v: unknown): v is Provider {
  return v === "anthropic" || v === "openai";
}

function isRetention(v: unknown): v is Retention {
  return v === "off" || v === "7" || v === "30";
}

function isEffortSetting(v: unknown): v is EffortSetting {
  return v === "default" || (EFFORTS as readonly unknown[]).includes(v);
}

// Stored data is untrusted input: anything malformed falls back to the default.
export function parseSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const provider = isProvider(r.provider) ? r.provider : DEFAULT_SETTINGS.provider;
  const hasModel = typeof r.model === "string" && !!r.model.trim();
  const model = hasModel ? (r.model as string).trim() : DEFAULT_MODEL[provider];
  // A missing effort takes the default model's effort only when the model is
  // also the default; a model chosen before efforts existed keeps "default".
  const effort = isEffortSetting(r.effort) ? r.effort : hasModel ? "default" : DEFAULT_EFFORT[provider];
  const retention = isRetention(r.retention) ? r.retention : DEFAULT_SETTINGS.retention;
  return { provider, model, effort, retention };
}

/**
 * One-time switch (owner decision 2026-10-17): installs that already picked an
 * Anthropic model move to the default (Haiku 5.5 at High) once. The flag is
 * written either way, so any model chosen afterwards sticks.
 */
export const MODEL_MIGRATION_KEY = "modelMigration";
const MODEL_MIGRATION = "haiku-5-5-high";

export async function loadSettings(storage: StorageArea): Promise<Settings> {
  const got = await storage.get([SETTINGS_KEY, MODEL_MIGRATION_KEY]);
  const settings = parseSettings(got[SETTINGS_KEY]);
  if (got[MODEL_MIGRATION_KEY] === MODEL_MIGRATION) return settings;
  const migrated: Settings =
    got[SETTINGS_KEY] !== undefined && settings.provider === "anthropic"
      ? { ...settings, model: DEFAULT_MODEL.anthropic, effort: DEFAULT_EFFORT.anthropic }
      : settings;
  await storage.set({
    ...(migrated !== settings ? { [SETTINGS_KEY]: migrated } : {}),
    [MODEL_MIGRATION_KEY]: MODEL_MIGRATION,
  });
  return migrated;
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

function parseShared(raw: unknown[]): NonNullable<HistoryEntry["shared"]> {
  return raw
    .flatMap((x: unknown) => {
      const r = x as { title?: unknown; host?: unknown; status?: unknown } | null;
      return r && typeof r.title === "string" && typeof r.host === "string" && typeof r.status === "string"
        ? [{ title: r.title.slice(0, 200), host: r.host.slice(0, 200), status: r.status.slice(0, 20) }]
        : [];
    })
    .slice(0, 20);
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
            ...(typeof r.conv === "string" && r.conv ? { conv: r.conv } : {}),
            ...(typeof r.site === "string" && /^[a-z0-9.-]{1,253}$/i.test(r.site) ? { site: r.site } : {}),
            ...(Array.isArray(r.shared) ? { shared: parseShared(r.shared) } : {}),
            ...(Array.isArray(r.sources) ? { sources: parseSources(r.sources) } : {}),
          },
        ]
      : [];
  });
}

function parseSources(raw: unknown[]): NonNullable<HistoryEntry["sources"]> {
  return raw
    .flatMap((x: unknown) => {
      const r = x as { url?: unknown; title?: unknown; kind?: unknown } | null;
      return r && typeof r.url === "string" && /^https?:\/\//i.test(r.url)
        ? [
            {
              url: r.url.slice(0, 500),
              ...(typeof r.title === "string" && r.title ? { title: r.title.slice(0, 200) } : {}),
              ...(r.kind === "page" || r.kind === "web" ? { kind: r.kind as "page" | "web" } : {}),
            },
          ]
        : [];
    })
    .slice(0, 50);
}

// Loads history, writes back the pruned list, and returns it.
export async function loadHistory(
  storage: StorageArea,
  retention: Retention,
  now: number,
): Promise<HistoryEntry[]> {
  return withLock(HISTORY_KEY, async () => {
    const got = await storage.get(HISTORY_KEY);
    const all = parseHistory(got[HISTORY_KEY]);
    const kept = pruneHistory(all, retention, now);
    if (kept.length !== all.length) await storage.set({ [HISTORY_KEY]: kept });
    return kept;
  });
}

/** Saves one entry, or several in one write (Branch). */
export async function appendHistory(
  storage: StorageArea,
  retention: Retention,
  entry: HistoryEntry | HistoryEntry[],
): Promise<void> {
  const added = Array.isArray(entry) ? entry : [entry];
  if (retention === "off" || !added.length) return;
  const now = Math.max(...added.map((e) => e.at));
  await withLock(HISTORY_KEY, async () => {
    const got = await storage.get(HISTORY_KEY);
    const next = pruneHistory([...parseHistory(got[HISTORY_KEY]), ...added], retention, now);
    await storage.set({ [HISTORY_KEY]: next });
  });
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
  // Under the history lock, so a save that already read the old list cannot write it back after the wipe.
  const storage = await attempt(() => withLock(HISTORY_KEY, () => deps.storage.clear()));
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
    r.keychain ? "" : "your API keys in " + (TARGET === "safari" ? "Keychain" : "this browser"),
    r.storage ? "" : "saved settings and history",
  ].filter(Boolean);
  if (failed.length) parts.push("Could not delete " + failed.join(" or ") + ". Try again.");
  if (r.remainingOrigins.length) {
    const sites = r.remainingOrigins.map((o) => o.replace(/^\*:\/\/\*?\.?/, "").replace(/\/\*$/, "")).join(", ");
    parts.push(
      browserName() + " still lets Scout read: " + sites + ". Remove it in " + browserName() + "'s extension settings. " + siteAccessSettings(),
    );
  } else if (!r.siteAccess) {
    parts.push("Could not remove site access. Check " + browserName() + "'s extension settings.");
  }
  if (r.keychain && r.storage) parts.unshift("Deleted your API keys, settings, and history from this device.");
  return parts.join(" ");
}

/** Entries in one conversation (see conversationForTab in src/panel/state.ts). */
export async function loadConversation(
  storage: StorageArea,
  retention: Retention,
  now: number,
  conv: string,
): Promise<HistoryEntry[]> {
  const all = await loadHistory(storage, retention, now);
  return all.filter((e) => e.conv === conv);
}

// Thumbs up or down on an answer: kept on this device only, never sent.
export type Rating = "up" | "down";
const RATINGS_KEY = "ratings";
const MAX_RATINGS = 200;

/** Key for an answer's rating: a short hash of its question and answer. */
export function ratingKey(question: string, answer: string): string {
  let h = 5381;
  for (const ch of question + "\u0000" + answer) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  return h.toString(36);
}

export async function loadRatings(storage: StorageArea): Promise<Record<string, Rating>> {
  const raw = (await storage.get(RATINGS_KEY))[RATINGS_KEY];
  const out: Record<string, Rating> = {};
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (v === "up" || v === "down") out[k] = v;
  }
  return out;
}

/** Sets or clears (null) a rating; the oldest go first past MAX_RATINGS. */
export async function saveRating(storage: StorageArea, key: string, rating: Rating | null): Promise<void> {
  const all = await loadRatings(storage);
  delete all[key];
  if (rating) all[key] = rating;
  const kept = Object.fromEntries(Object.entries(all).slice(-MAX_RATINGS));
  await storage.set({ [RATINGS_KEY]: kept });
}

/** Deletes one conversation's saved entries (the chats menu). */
export async function deleteConversation(storage: StorageArea, conv: string): Promise<void> {
  await withLock(HISTORY_KEY, async () => {
    const got = await storage.get(HISTORY_KEY);
    const raw = got[HISTORY_KEY];
    if (!Array.isArray(raw)) return;
    await storage.set({ [HISTORY_KEY]: raw.filter((e: unknown) => (e as { conv?: unknown } | null)?.conv !== conv) });
  });
}

/** Host of a page address for HistoryEntry.site; undefined for anything but http(s). */
export function siteOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.hostname.replace(/^www\./, "") || undefined : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Removes all saved chat history and the ratings given to its answers. Removes
 * the keys rather than writing empty values (owner bug 2026-10-19: in Safari
 * the button showed nothing at all, so the write never finished).
 */
export async function clearHistory(storage: StorageArea): Promise<void> {
  // Under the lock, so a save that already read the old list cannot write it back after this.
  await withLock(HISTORY_KEY, async () => {
    if (storage.remove) await storage.remove([HISTORY_KEY, RATINGS_KEY]);
    else await storage.set({ [HISTORY_KEY]: [], [RATINGS_KEY]: {} });
  });
}

/** Part 3, spec 10: what each conversation shared (tabs, screenshots, tools), for Settings > Permissions. */
export interface SharedSummary {
  conv: string;
  /** Newest entry in the conversation. */
  at: number;
  items: NonNullable<HistoryEntry["shared"]>;
}

export function summarizeShared(entries: HistoryEntry[]): SharedSummary[] {
  const byConv = new Map<string, SharedSummary>();
  for (const e of entries) {
    if (!e.shared?.length) continue;
    const key = e.conv ?? "";
    const cur = byConv.get(key) ?? { conv: key, at: e.at, items: [] };
    cur.at = Math.max(cur.at, e.at);
    cur.items.push(...e.shared);
    byConv.set(key, cur);
  }
  return [...byConv.values()].sort((a, b) => b.at - a.at);
}

/** Forgets what was shared in one conversation (all of them when `conv` is undefined); the messages stay. */
export async function clearShared(storage: StorageArea, conv?: string): Promise<void> {
  await withLock(HISTORY_KEY, async () => {
    const got = await storage.get(HISTORY_KEY);
    const all = parseHistory(got[HISTORY_KEY]);
    const next = all.map((e) => {
      if (!e.shared || (conv !== undefined && (e.conv ?? "") !== conv)) return e;
      const { shared: _s, ...rest } = e;
      return rest;
    });
    await storage.set({ [HISTORY_KEY]: next });
  });
}
