// Per-tab panel state (Part 1): each tab remembers which conversation the
// Scout panel showed there and whether the panel was open. The popup reads and
// writes it directly, so it works even when the background worker is asleep;
// the worker also updates it from the panel port and drops closed tabs.
import { CHAT_START_KEY, HISTORY_KEY, type StorageArea } from "../settings/settings";

export const TAB_STATE_KEY = "tabState";

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

async function saveTabStates(storage: Store, states: TabStates): Promise<void> {
  await storage.set({ [TAB_STATE_KEY]: states });
}

// Entries saved before per-tab chats carry no `conv`. The conversation that
// was current then (since the last New chat) moves to the first tab that opens
// the panel, once; older entries stay hidden until they expire.
async function adoptLegacyConversation(storage: Store, conv: string): Promise<void> {
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

/** The conversation the panel shows on this tab, created on first use. */
export async function conversationForTab(storage: Store, tabId: number | undefined, now: number): Promise<string> {
  const states = await loadTabStates(storage);
  const key = tabKey(tabId);
  const existing = states[key];
  if (existing) return existing.conv;
  const conv = newConversationId(now);
  await adoptLegacyConversation(storage, conv);
  states[key] = { conv, open: false, at: now };
  await saveTabStates(storage, states);
  return conv;
}

/** "New chat": this tab gets a fresh conversation. Earlier entries stay in history until they expire. */
export async function startNewConversation(storage: Store, tabId: number | undefined, now: number): Promise<string> {
  const states = await loadTabStates(storage);
  const key = tabKey(tabId);
  const conv = newConversationId(now);
  states[key] = { conv, open: states[key]?.open ?? false, at: now };
  await saveTabStates(storage, states);
  return conv;
}

/** Records whether the panel is open on this tab. Creates the tab's slot if needed. */
export async function setPanelOpen(storage: Store, tabId: number | undefined, open: boolean, now: number): Promise<void> {
  const states = await loadTabStates(storage);
  const key = tabKey(tabId);
  states[key] = { conv: states[key]?.conv ?? newConversationId(now), open, at: now };
  await saveTabStates(storage, states);
}

export async function forgetTab(storage: Store, tabId: number): Promise<void> {
  const states = await loadTabStates(storage);
  if (!(tabKey(tabId) in states)) return;
  delete states[tabKey(tabId)];
  await saveTabStates(storage, states);
}

/** Tab ids are reused after Safari restarts, so old mappings are dropped at startup. */
export async function clearTabStates(storage: Store): Promise<void> {
  await saveTabStates(storage, {});
}
