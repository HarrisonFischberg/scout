// Tool allow-list (Part 2, spec 7). The Scout server can request only these
// tools; the tool host rejects any other name with schema-error. Each tool's
// input is checked with the bridge schema language before it runs.
import type { Schema } from "../bridge/messages";
import type { ToolSpec } from "../providers/types";

export const TOOL_NAMES = [
  "read_page",
  "search_tabs",
  "screenshot_visible",
  "open_tab",
  "close_tabs",
  "group_tabs",
  "ungroup_tabs",
  "run_task",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

/** Results the tool host returns; the same values travel back to the server. */
export type ToolStatus = "ok" | "error" | "schema-error" | "blocked-by-user" | "unsupported" | "declined" | "timeout";

export interface ToolDef {
  description: string;
  /** JSON Schema shown to the model. */
  parameters: Record<string, unknown>;
  /** Checked before the tool runs. */
  input: Schema;
  /** Spec 7 "Changes anything?". */
  changes: "no" | "low" | "yes";
}

const TAB_IDS = { type: "array", items: { type: "integer" }, minItems: 1, maxItems: 20 };

export const TOOLS: Record<ToolName, ToolDef> = {
  read_page: {
    description:
      "Read a tab as Markdown with its metadata. Only the current tab (when the user shares it) and tabs the user attached can be read. Omit tab_id for the current tab.",
    parameters: { type: "object", properties: { tab_id: { type: "integer" } }, additionalProperties: false },
    input: { object: { tab_id: "number" }, optional: ["tab_id"] },
    changes: "no",
  },
  search_tabs: {
    description:
      "Search the user's open tabs (and history or recently closed tabs where the browser allows it) by words in the title or address. Returns titles, addresses, and tab ids.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 20 } },
      required: ["query"],
      additionalProperties: false,
    },
    input: { object: { query: "string", limit: "number" }, optional: ["limit"] },
    changes: "no",
  },
  screenshot_visible: {
    description: "Take a screenshot of the visible part of the current tab. Use only when the page text is not enough (charts, images, layout). The user may be asked first.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    input: { object: {} },
    changes: "no",
  },
  open_tab: {
    description: "Open a web address (http or https) in a new background tab.",
    parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"], additionalProperties: false },
    input: { object: { url: "string" } },
    changes: "low",
  },
  close_tabs: {
    description: "Close specific tabs by id. The user is always asked to confirm first.",
    parameters: { type: "object", properties: { tab_ids: TAB_IDS }, required: ["tab_ids"], additionalProperties: false },
    input: { object: { tab_ids: { array: "number" } } },
    changes: "yes",
  },
  group_tabs: {
    description: "Put tabs into a tab group, optionally with a title.",
    parameters: {
      type: "object",
      properties: { tab_ids: TAB_IDS, title: { type: "string" } },
      required: ["tab_ids"],
      additionalProperties: false,
    },
    input: { object: { tab_ids: { array: "number" }, title: "string" }, optional: ["title"] },
    changes: "low",
  },
  ungroup_tabs: {
    description: "Take tabs out of their tab group.",
    parameters: { type: "object", properties: { tab_ids: TAB_IDS }, required: ["tab_ids"], additionalProperties: false },
    input: { object: { tab_ids: { array: "number" } } },
    changes: "low",
  },
  run_task: {
    description:
      "Start Scout mode: an agent that carries out a task on the current page for the user (clicking, typing, scrolling), step by step, with the user watching. " +
      "Use it only when the user asks you to do something on the page, not to read it. The user is asked before it starts and before any sensitive action (buying, sending, signing in, deleting). " +
      "Returns a summary of what was done.",
    parameters: { type: "object", properties: { goal: { type: "string", description: "What to do on the page, in the user's words." } }, required: ["goal"], additionalProperties: false },
    input: { object: { goal: "string" } },
    changes: "yes",
  },
};

export function isToolName(name: string): name is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(name);
}

export interface ToolCaps {
  /** Settings: Search history and tabs is on. */
  searchTabs: boolean;
  /** The browser has a tab-group API (Safari does not). */
  tabGroups: boolean;
  /** Part 3: Settings > Permissions > Scout mode is not off (and the tab is not private). */
  scoutMode: boolean;
}

/**
 * Tools offered to the model. search_tabs only when the user turned it on,
 * tab groups only where the browser supports them, and run_task only while
 * Scout mode is allowed (Part 3). The host still enforces all of this.
 */
export function offeredTools(caps: ToolCaps): ToolSpec[] {
  return TOOL_NAMES.filter((n) => {
    if (n === "search_tabs") return caps.searchTabs;
    if (n === "group_tabs" || n === "ungroup_tabs") return caps.tabGroups;
    if (n === "run_task") return caps.scoutMode;
    return true;
  }).map((name) => ({ name, description: TOOLS[name].description, parameters: TOOLS[name].parameters }));
}
