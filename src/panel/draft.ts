// Unsent text in the question box, kept per tab (owner request 2026-11-01):
// closing the panel (switching tabs, tapping the page) and opening it again
// on the same tab brings the text back. Sending clears it. A tab's draft goes
// when the tab closes or Safari restarts (src/panel/state.ts), and any draft
// left behind expires after DRAFT_MAX_AGE_MS. Stays on the device.
import type { StorageArea } from "../settings/settings";

/** One storage key per tab, so a save is a single write with no read first: it
 * still lands when Safari closes the panel right after the last keystroke. */
export const DRAFT_PREFIX = "draft:";
export const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Longer text is cut: a draft is a question, not a document. */
export const DRAFT_MAX_CHARS = 20_000;

type Store = Pick<StorageArea, "get" | "set" | "remove">;

export interface Draft {
  text: string;
  at: number;
}

export const draftKey = (tab: string): string => DRAFT_PREFIX + tab;

// Stored data is untrusted input: a malformed or expired draft is ignored.
export function parseDraft(raw: unknown, now: number): string {
  const r = raw as Partial<Draft> | null;
  if (!r || typeof r !== "object" || typeof r.text !== "string" || typeof r.at !== "number" || now - r.at >= DRAFT_MAX_AGE_MS) return "";
  return r.text.slice(0, DRAFT_MAX_CHARS);
}

export async function loadDraft(storage: Store, tab: string, now: number): Promise<string> {
  const k = draftKey(tab);
  return parseDraft((await storage.get(k))[k], now);
}

/** Saves this tab's draft; empty or blank text removes it. */
export function saveDraft(storage: Store, tab: string, text: string, now: number): Promise<void> {
  const k = draftKey(tab);
  if (text.trim()) return storage.set({ [k]: { text: text.slice(0, DRAFT_MAX_CHARS), at: now } });
  return storage.remove ? storage.remove([k]) : storage.set({ [k]: null });
}

/** Drops one tab's draft. */
export function dropDraft(storage: Store, tab: string): Promise<void> {
  return saveDraft(storage, tab, "", 0);
}

/** Drops every tab's draft (Safari restarted, so tab ids start over). */
export async function dropAllDrafts(storage: Store): Promise<void> {
  // get(null) reads every key; StorageArea types only the key forms.
  const all = await (storage.get as unknown as (this: Store, k: null) => Promise<Record<string, unknown>>).call(storage, null);
  const keys = Object.keys(all ?? {}).filter((k) => k.startsWith(DRAFT_PREFIX));
  if (!keys.length) return;
  if (storage.remove) await storage.remove(keys);
  else await storage.set(Object.fromEntries(keys.map((k) => [k, null])));
}

/**
 * Saves the box's text a moment after typing stops, and at once when asked
 * (the panel is closing, or the box was cleared on send).
 */
export class DraftSaver {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private last: string;

  constructor(
    private readonly save: (text: string) => Promise<void>,
    initial = "",
    private readonly delayMs = 300,
  ) {
    this.last = initial;
  }

  changed(text: string): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(text), this.delayMs);
  }

  flush(text: string): Promise<void> {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    if (text === this.last) return Promise.resolve();
    this.last = text;
    return this.save(text).catch(() => undefined);
  }
}
