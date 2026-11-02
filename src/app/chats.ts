// Saved chats in the Scout app (owner choice 2026-11-01: keep chats on the
// iPhone, with a Chats list and New chat, like the Claude app). Kept in the
// app's own web storage on the device; never synced and never sent anywhere
// except as the conversation the user continues.
import { dropUnmatchedCites, linkHref, type Source } from "../chat/sources";
import type { ChatMessage } from "../providers/types";

export interface AppTurn {
  role: "user" | "assistant";
  text: string;
  /** Assistant only: web pages the answer's [n] markers count. */
  sources?: Source[];
  /** Assistant only: "apple" or Claude's model id. */
  model?: string;
  /** Assistant only: the answer failed; `text` is the error shown. */
  error?: true;
}

export interface AppChat {
  id: string;
  title: string;
  /** Last change, ms since epoch. */
  at: number;
  turns: AppTurn[];
}

export interface TextStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const CHATS_KEY = "scout.app.chats";
/** Oldest chats beyond this are dropped. */
export const MAX_CHATS = 100;
/** Turns sent back to the model with a new question (about 10 exchanges). */
export const HISTORY_TURNS = 20;

/** The chat list's name for a chat: its first question, on one line. */
export function chatTitle(question: string): string {
  const one = question.replace(/\s+/g, " ").trim();
  return one.length > 60 ? one.slice(0, 57).trimEnd() + "…" : one || "New chat";
}

function parseSources(raw: unknown): Source[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: Source[] = [];
  for (const s of raw) {
    const url = (s as { url?: unknown })?.url;
    const title = (s as { title?: unknown })?.title;
    // Stored data is untrusted input: only http(s) pages come back as links.
    if (typeof url === "string" && linkHref(url)) out.push({ url, ...(typeof title === "string" && title ? { title } : {}), kind: "web" });
  }
  return out;
}

/** Saved chats, newest first. Anything malformed is skipped. */
export function loadChats(storage: TextStorage): AppChat[] {
  let raw: unknown;
  try {
    raw = JSON.parse(storage.getItem(CHATS_KEY) ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const chats: AppChat[] = [];
  for (const c of raw) {
    const o = (c ?? {}) as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.at !== "number" || !Array.isArray(o.turns)) continue;
    const turns: AppTurn[] = [];
    for (const t of o.turns) {
      const r = (t ?? {}) as Record<string, unknown>;
      if ((r.role !== "user" && r.role !== "assistant") || typeof r.text !== "string") continue;
      const sources = r.role === "assistant" ? parseSources(r.sources) : undefined;
      turns.push({
        role: r.role,
        text: r.text,
        ...(sources?.length ? { sources } : {}),
        ...(typeof r.model === "string" ? { model: r.model } : {}),
        ...(r.error === true ? { error: true as const } : {}),
      });
    }
    if (!turns.length) continue;
    chats.push({ id: o.id, title: typeof o.title === "string" && o.title ? o.title : chatTitle(turns[0]!.text), at: o.at, turns });
  }
  return chats.sort((a, b) => b.at - a.at);
}

export function saveChats(storage: TextStorage, chats: AppChat[]): void {
  const kept = [...chats].filter((c) => c.turns.length).sort((a, b) => b.at - a.at).slice(0, MAX_CHATS);
  try {
    storage.setItem(CHATS_KEY, JSON.stringify(kept));
  } catch {
    // Storage full: drop the older half and try once more.
    storage.setItem(CHATS_KEY, JSON.stringify(kept.slice(0, Math.ceil(kept.length / 2))));
  }
}

/** Replaces (or adds) one chat and saves the list. */
export function upsertChat(storage: TextStorage, chat: AppChat): AppChat[] {
  const chats = [chat, ...loadChats(storage).filter((c) => c.id !== chat.id)];
  saveChats(storage, chats);
  return loadChats(storage);
}

export function deleteChat(storage: TextStorage, id: string): AppChat[] {
  saveChats(storage, loadChats(storage).filter((c) => c.id !== id));
  return loadChats(storage);
}

/**
 * The conversation so far as the model gets it: answered turns only (failed
 * answers and their questions left out), citation markers removed, the last
 * HISTORY_TURNS turns, starting with a question.
 */
export function historyFor(turns: AppTurn[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (let i = 0; i < turns.length; i++) {
    const q = turns[i]!;
    const a = turns[i + 1];
    if (q.role !== "user" || a?.role !== "assistant") continue;
    i++;
    if (a.error || !a.text.trim()) continue;
    out.push({ role: "user", content: q.text }, { role: "assistant", content: dropUnmatchedCites(a.text, 0).trim() });
  }
  return out.slice(-HISTORY_TURNS);
}

/** A short random id for a new chat. */
export function newChatId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
