// The chats menu (owner request 2026-10-19): earlier conversations from saved
// history, newest first, so a chat can be opened again. A coupon run still
// going in the worker is listed too, before its summary is saved.
import type { HistoryEntry } from "../settings/settings";

export interface ChatSummary {
  conv: string;
  /** The chat's first question, as the thread shows it. */
  title: string;
  /** Site the chat was on, when known (host only). */
  site?: string;
  /** Newest activity. */
  at: number;
  /** Exchanges saved. */
  count: number;
}

export interface ChatTitles {
  summarize: (question: string) => boolean;
  coupons: string;
  agent: string;
}

const MAX_TITLE = 80;

function titleOf(e: HistoryEntry, t: ChatTitles): string {
  if (e.kind === "coupons") return t.coupons;
  const q = t.summarize(e.question) ? "Summarize page" : e.question.replace(/\s+/g, " ").trim();
  const text = e.kind === "agent" ? t.agent + ": " + q : q;
  return text.length > MAX_TITLE ? text.slice(0, MAX_TITLE - 1).trimEnd() + "…" : text;
}

/**
 * One row per conversation in `entries` (saved order is oldest first), newest
 * first. Entries without a conversation (saved before per-tab chats) are left
 * out, as the panel never shows them.
 */
export function summarizeChats(entries: HistoryEntry[], titles: ChatTitles): ChatSummary[] {
  const byConv = new Map<string, ChatSummary>();
  for (const e of entries) {
    if (!e.conv) continue;
    const cur = byConv.get(e.conv);
    if (!cur) {
      byConv.set(e.conv, { conv: e.conv, title: titleOf(e, titles), at: e.at, count: 1, ...(e.site ? { site: e.site } : {}) });
      continue;
    }
    cur.at = Math.max(cur.at, e.at);
    cur.count++;
    if (!cur.site && e.site) cur.site = e.site;
  }
  return [...byConv.values()].sort((a, b) => b.at - a.at);
}

/** "Just now", "5 min ago", "3 h ago", "Yesterday", then the date. */
export function whenText(at: number, now: number, locale?: string): string {
  const min = Math.floor((now - at) / 60_000);
  if (min < 1) return "Just now";
  if (min < 60) return min + " min ago";
  const d = new Date(at);
  const today = new Date(now);
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return Math.floor(min / 60) + " h ago";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(locale, { month: "short", day: "numeric" });
}
