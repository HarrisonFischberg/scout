// Per-tab panel state (Part 1): each tab remembers which conversation the
// Scout panel showed there and whether the panel was open. The popup reads and
// writes it directly, so it works even when the background worker is asleep;
// the worker also updates it from the panel port and drops closed tabs.
import { CHAT_START_KEY, HISTORY_KEY, type StorageArea } from "../settings/settings";
import { withLock } from "../settings/lock";

export const TAB_STATE_KEY = "tabState";

/**
 * Conversations held in Private Browsing tabs, by tab (owner request
 * 2026-10-17: Scout works in Private Browsing). They are kept while the tab is
 * open, so the panel can reopen them, and deleted from history when the tab
 * closes or Safari restarts.
 */
export const PRIVATE_CONVS_KEY = "privateConversations";

export interface TabState {
  conv: string;
  open: boolean;
  at: number;
}

export type TabStates = Record<string, TabState>;

type Store = Pick<StorageArea, "get" | "set">;

/** Tabs without an id (tabs.query failed) share one slot. */
export const tabKey = (tabId: number | undefined): string => (tabId === undefined ? "none" : String(tabId));

export function newConversationId(now: number): string {
  return "c" + now.toString(36) + Math.random().toString(36).slice(2, 8);
}

// Stored data is untrusted input: malformed rows are dropped.
export function parseTabStates(raw: unknown): TabStates {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: TabStates = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const r = v as Partial<TabState> | null;
    if (r && typeof r.conv === "string" && r.conv && typeof r.at === "number") out[k] = { conv: r.conv, open: r.open === true, at: r.at };
  }
  return out;
}

export async function loadTabStates(storage: Store): Promise<TabStates> {
  const got = await storage.get(TAB_STATE_KEY);
  return parseTabStates(got[TAB_STATE_KEY]);
}

// The panel and the worker both change the tab state and the private list,
// often at the same moment (opening the panel on a new tab), so every change
// takes this lock. Order: this lock first, then the history lock, never the
// reverse (audit 2026-10-27).
const tabLock = <T>(fn: () => Promise<T>): Promise<T> => withLock(TAB_STATE_KEY, fn);

async function saveTabStates(storage: Store, states: TabStates): Promise<void> {
  await storage.set({ [TAB_STATE_KEY]: states });
}

// Entries saved before per-tab chats carry no `conv`. The conversation that
// was current then (since the last New chat) moves to the first tab that opens
// the panel, once; older entries stay hidden until they expire.
function adoptLegacyConversation(storage: Store, conv: string): Promise<void> {
  return withLock(HISTORY_KEY, () => adoptLegacy(storage, conv));
}

async function adoptLegacy(storage: Store, conv: string): Promise<void> {
  const got = await storage.get([HISTORY_KEY, CHAT_START_KEY]);
  const raw = got[HISTORY_KEY];
  if (!Array.isArray(raw)) return;
  const start = typeof got[CHAT_START_KEY] === "number" ? (got[CHAT_START_KEY] as number) : 0;
  let changed = false;
  const next = raw.map((e: unknown) => {
    const r = e as { at?: unknown; conv?: unknown } | null;
    if (r && typeof r === "object" && r.conv === undefined && typeof r.at === "number" && r.at >= start) {
      changed = true;
      return { ...r, conv };
    }
    return e;
  });
  if (changed) await storage.set({ [HISTORY_KEY]: next });
}

// Stored data is untrusted input: anything but lists of strings is dropped.
export function parsePrivateConvs(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(v)) out[k] = v.filter((c): c is string => typeof c === "string" && c !== "");
  }
  return out;
}

async function markPrivate(storage: Store, tabId: number | undefined, conv: string): Promise<void> {
  const got = await storage.get(PRIVATE_CONVS_KEY);
  const all = parsePrivateConvs(got[PRIVATE_CONVS_KEY]);
  const key = tabKey(tabId);
  if (all[key]?.includes(conv)) return;
  all[key] = [...(all[key] ?? []), conv];
  await storage.set({ [PRIVATE_CONVS_KEY]: all });
}

/** Deletes the history of private conversations: one tab's, or every tab's when `tabId` is undefined. */
function dropPrivate(storage: Store, tabId?: number): Promise<void> {
  return withLock(HISTORY_KEY, () => dropPrivateNow(storage, tabId));
}

async function dropPrivateNow(storage: Store, tabId?: number): Promise<void> {
  const got = await storage.get([PRIVATE_CONVS_KEY, HISTORY_KEY]);
  const all = parsePrivateConvs(got[PRIVATE_CONVS_KEY]);
  const keys = tabId === undefined ? Object.keys(all) : [tabKey(tabId)].filter((k) => k in all);
  if (!keys.length) return;
  const convs = new Set(keys.flatMap((k) => all[k] ?? []));
  for (const k of keys) delete all[k];
  const raw = got[HISTORY_KEY];
  const history = Array.isArray(raw) ? raw.filter((e: unknown) => !convs.has((e as { conv?: unknown } | null)?.conv as string)) : raw;
  await storage.set({ [PRIVATE_CONVS_KEY]: all, ...(Array.isArray(raw) ? { [HISTORY_KEY]: history } : {}) });
}

/** The conversation the panel shows on this tab, created on first use. `priv`: a Private Browsing tab. */
export function conversationForTab(storage: Store, tabId: number | undefined, now: number, priv = false): Promise<string> {
  return tabLock(async () => {
    const states = await loadTabStates(storage);
    const key = tabKey(tabId);
    const existing = states[key];
    if (existing) {
      if (priv) await markPrivate(storage, tabId, existing.conv);
      return existing.conv;
    }
    const conv = newConversationId(now);
    // A private tab never adopts history saved outside it.
    if (!priv) await adoptLegacyConversation(storage, conv);
    states[key] = { conv, open: false, at: now };
    await saveTabStates(storage, states);
    if (priv) await markPrivate(storage, tabId, conv);
    return conv;
  });
}

/** "New chat": this tab gets a fresh conversation. Earlier entries stay in history until they expire (private ones until the tab closes). */
export async function startNewConversation(storage: Store, tabId: number | undefined, now: number, priv = false): Promise<string> {
  return reopenConversation(storage, tabId, newConversationId(now), now, priv);
}

/** This tab shows `conv` again (back to a coupon run's chat from its chip). */
export function reopenConversation(storage: Store, tabId: number | undefined, conv: string, now: number, priv = false): Promise<string> {
  return tabLock(async () => {
    const states = await loadTabStates(storage);
    const key = tabKey(tabId);
    states[key] = { conv, open: states[key]?.open ?? false, at: now };
    await saveTabStates(storage, states);
    if (priv) await markPrivate(storage, tabId, conv);
    return conv;
  });
}

/** Records whether the panel is open on this tab. Creates the tab's slot if needed. */
export function setPanelOpen(storage: Store, tabId: number | undefined, open: boolean, now: number): Promise<void> {
  return tabLock(async () => {
    const states = await loadTabStates(storage);
    const key = tabKey(tabId);
    states[key] = { conv: states[key]?.conv ?? newConversationId(now), open, at: now };
    await saveTabStates(storage, states);
  });
}

export function forgetTab(storage: Store, tabId: number): Promise<void> {
  return tabLock(async () => {
    await dropPrivate(storage, tabId);
    const states = await loadTabStates(storage);
    if (!(tabKey(tabId) in states)) return;
    delete states[tabKey(tabId)];
    await saveTabStates(storage, states);
  });
}

/** Tab ids are reused after Safari restarts, so old mappings are dropped at startup. */
export function clearTabStates(storage: Store): Promise<void> {
  return tabLock(async () => {
    await dropPrivate(storage);
    await saveTabStates(storage, {});
  });
}
