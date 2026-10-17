// Panel helpers for Part 2: the @ tab picker, the "Shared:" line under each
// message, and Settings > Activity rows. Pure, so they are unit-tested.
import { MAX_EXTRA_TABS, type TabInfo } from "../chat/tabs";
import type { ToolLogEntry } from "../tools/log";

export const MAX_SUGGESTIONS = 8;

function host(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** The "@word" being typed just before the caret, if any. */
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const m = /(?:^|\s)@([\w.-]*)$/.exec(text.slice(0, caret));
  if (!m) return null;
  return { start: caret - m[1]!.length - 1, query: m[1]!.toLowerCase() };
}

/** Tabs that match what follows @: host contains it, or a title word starts with it. Empty query lists all. */
export function suggestTabs(query: string, tabs: TabInfo[], attached: ReadonlySet<number>): TabInfo[] {
  if (attached.size >= MAX_EXTRA_TABS) return [];
  const q = query.toLowerCase();
  return tabs
    .filter((t) => !t.active && !attached.has(t.id))
    .filter((t) => !q || host(t.url).includes(q) || t.title.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)))
    .slice(0, MAX_SUGGESTIONS);
}

/** Removes the "@word" at `start` from the text once its tab is attached. */
export function dropMention(text: string, start: number, caret: number): { text: string; caret: number } {
  const before = text.slice(0, start);
  let after = text.slice(caret);
  if ((before === "" || /\s$/.test(before)) && /^\s/.test(after)) after = after.replace(/^\s+/, "");
  return { text: before + after, caret: before.length };
}

export type SharedStatus = "read" | "partial" | "timeout" | "blocked" | "failed";

const STATUS_NOTE: Record<string, string> = {
  read: "",
  partial: "partly read",
  timeout: "timed out",
  blocked: "blocked",
  failed: "could not read",
};

/** One item of the "Shared:" line, e.g. "Test shop (shop.test)" or "Bank (bank.test), blocked". */
export function sharedLabel(s: { title: string; host: string; status: string }): string {
  const title = s.title || s.host || "Tab";
  const base = s.host && s.host !== title ? title + " (" + s.host + ")" : title;
  const note = STATUS_NOTE[s.status] ?? "";
  return note ? base + ", " + note : base;
}

const TOOL_LABEL: Record<string, string> = {
  read_page: "Read page",
  search_tabs: "Searched tabs",
  screenshot_visible: "Screenshot",
  open_tab: "Opened tab",
  close_tabs: "Closed tabs",
  group_tabs: "Grouped tabs",
  ungroup_tabs: "Ungrouped tabs",
  run_task: "Agent task",
};

export function toolLabel(name: string): string {
  return TOOL_LABEL[name] ?? "Unknown tool";
}

/** One Settings > Activity row: time, tool, site, result, duration. */
export function activityLine(e: ToolLogEntry, locale?: string): string {
  const time = new Date(e.at).toLocaleString(locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  // Part 3: Scout actions are logged as "scout:<action>", rejected ones included.
  const tool = e.tool.startsWith("unknown:") ? "Unknown tool (" + e.tool.slice(8) + ")" : e.tool.startsWith("scout:") ? "Scout action (" + e.tool.slice(6) + ")" : toolLabel(e.tool);
  return [time, tool, e.site || "no site", e.status, e.ms + " ms"].join(" · ");
}
