// Tool host (Part 2, spec 7), run by the background worker for the panel.
// One entry point: allow-list and input check, permission gate, the tool
// itself, then one log entry with tool, site, duration and status. The
// panel asks the user first where a tool needs it (close_tabs, screenshots)
// and passes the answer as `decision`; the host refuses without it.
import { checkSchema } from "../bridge/messages";
import { fencePage } from "../chat/prompt";
import { cleanUrl } from "../context/clean";
import type { TabRead, TabRef } from "../context/gather";
import { blockedBy, hostOf, screenshotDecision, type PageAccess, type ScreenshotChoice } from "../permissions/gate";
import type { ToolLog } from "./log";
import { isToolName, TOOL_NAMES, TOOLS, type ToolStatus } from "./registry";

export type ToolDecision = "confirmed" | "declined" | "once" | "always" | "never";

export interface ToolRequest {
  request_id: string;
  name: string;
  input: unknown;
  /** Tabs this answer may read: the current tab when shared, attached tabs, tabs it opened. */
  tabs: number[];
  current_tab?: number;
  decision?: ToolDecision;
}

export interface ToolImage {
  mediaType: "image/jpeg" | "image/png";
  data: string;
}

export interface ToolResult {
  status: ToolStatus;
  /** What the model is told. Page-derived parts are fenced as untrusted. */
  text: string;
  image?: ToolImage;
  /** Host(s) the call touched, for the log and the panel. */
  site: string;
  /** open_tab: the new tab, which this answer may then read. */
  opened_tab?: number;
  /** read_page / screenshot_visible: what was shared, for the chips under the message. */
  shared?: { title: string; host: string };
}

export interface ToolHostDeps {
  access(): Promise<PageAccess>;
  admin(): Promise<readonly string[]>;
  saveScreenshotChoice(host: string, choice: ScreenshotChoice): Promise<void>;
  tab(id: number): Promise<TabRef | null>;
  /** Open tabs in every normal window. */
  allTabs(): Promise<TabRef[]>;
  /** Gated, timed read (src/context/gather.ts). */
  readTab(id: number): Promise<TabRead>;
  openTab(url: string): Promise<TabRef>;
  closeTabs(ids: number[]): Promise<void>;
  /** Absent where the browser has no tab-group API (Safari). */
  groupTabs?: (ids: number[], title?: string) => Promise<void>;
  ungroupTabs?: (ids: number[]) => Promise<void>;
  capture(tab: TabRef): Promise<ToolImage>;
  /** Absent where the browser has no history API. */
  searchHistory?: (query: string, max: number) => Promise<Array<{ url: string; title: string }>>;
  /** Absent where the browser has no sessions API. */
  recentlyClosed?: (max: number) => Promise<Array<{ url: string; title: string }>>;
  now(): number;
}

const result = (status: ToolStatus, text: string, site = "", extra: Partial<ToolResult> = {}): ToolResult => ({ status, text, site, ...extra });

function sitesOf(tabs: Array<{ url: string }>): string {
  const hosts = [...new Set(tabs.map((t) => hostOf(t.url)).filter((h): h is string => !!h))];
  return hosts.length > 3 ? hosts.slice(0, 3).join(", ") + " +" + (hosts.length - 3) : hosts.join(", ");
}

function matches(query: string, t: { url: string; title: string }): boolean {
  const hay = (t.title + " " + t.url).toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

async function run(req: ToolRequest, deps: ToolHostDeps): Promise<ToolResult> {
  const name = req.name;
  if (!isToolName(name)) {
    return result("schema-error", "Unknown tool " + JSON.stringify(name.slice(0, 60)) + ". Allowed tools: " + TOOL_NAMES.join(", ") + ".");
  }
  const bad = checkSchema(TOOLS[name].input, req.input, "input");
  if (bad) return result("schema-error", "Invalid input for " + name + ": " + bad + ".");
  const input = req.input as Record<string, unknown>;
  const access = await deps.access();
  const admin = await deps.admin();

  switch (name) {
    case "read_page": {
      const id = typeof input.tab_id === "number" ? input.tab_id : req.current_tab;
      if (id === undefined || !req.tabs.includes(id)) {
        return result("blocked-by-user", "That tab was not shared with this answer. Ask the user to attach it.");
      }
      const read = await deps.readTab(id);
      const site = read.shared.host;
      if (read.shared.status === "blocked") return result("blocked-by-user", "The user does not allow Scout to read this site.", site);
      if (read.shared.status === "timeout") return result("timeout", "The page did not answer in time.", site);
      if (!read.page) return result("error", "Could not read that tab.", site);
      return result("ok", fencePage(read.page), site, { shared: { title: read.shared.title, host: site } });
    }

    case "search_tabs": {
      // Off by default: nothing is searched or listed until the user turns it on.
      if (!access.searchTabs) {
        return result("blocked-by-user", "Searching tabs and history is off. The user can turn it on in Scout's Settings.");
      }
      const query = String(input.query).slice(0, 200);
      const limit = Math.min(20, Math.max(1, typeof input.limit === "number" ? Math.floor(input.limit) : 10));
      const allowed = (t: { url: string }): boolean => !blockedBy(t.url, access, admin);
      const lines: string[] = [];
      const found: Array<{ url: string }> = [];
      for (const t of (await deps.allTabs()).filter((t) => !t.incognito && allowed(t) && matches(query, t))) {
        if (found.length >= limit) break;
        found.push(t);
        lines.push("open tab " + t.id + ": " + t.title + " (" + cleanUrl(t.url) + ")");
      }
      const notes: string[] = [];
      if (deps.searchHistory) {
        for (const h of (await deps.searchHistory(query, limit).catch(() => [])).filter(allowed)) {
          if (found.length >= limit) break;
          found.push(h);
          lines.push("history: " + h.title + " (" + cleanUrl(h.url) + ")");
        }
      } else notes.push("History search is not available in this browser.");
      if (deps.recentlyClosed) {
        for (const c of (await deps.recentlyClosed(limit).catch(() => [])).filter((c) => allowed(c) && matches(query, c))) {
          if (found.length >= limit) break;
          found.push(c);
          lines.push("recently closed: " + c.title + " (" + cleanUrl(c.url) + ")");
        }
      } else notes.push("Recently closed tabs are not available in this browser.");
      const body = lines.length ? lines.join("\n") : "No matches.";
      return result(
        "ok",
        "<untrusted_page_content>\n" + body.replace(/<\/?untrusted_page_content>/gi, "") + "\n</untrusted_page_content>" + (notes.length ? "\n" + notes.join(" ") : ""),
        sitesOf(found),
      );
    }

    case "screenshot_visible": {
      const id = req.current_tab;
      const tab = id === undefined ? null : await deps.tab(id);
      if (!tab || !tab.url || tab.incognito) return result("error", "There is no current tab to capture.");
      const site = hostOf(tab.url) ?? "";
      const decision = screenshotDecision(tab.url, access, admin);
      if (decision === "deny") return result("blocked-by-user", "The user does not allow screenshots of this site.", site);
      if (decision === "ask") {
        const d = req.decision;
        if (d === "always" || d === "never") await deps.saveScreenshotChoice(site, d);
        if (d === "declined" || d === "never") return result("declined", "The user did not allow a screenshot.", site);
        if (d !== "once" && d !== "always") return result("error", "A screenshot of this site needs the user's permission first.", site);
      }
      // captureVisibleTab shoots whatever is visible: if the user switched tabs,
      // that is another page than the one checked above.
      const now = await deps.tab(tab.id);
      if (!now || now.active === false || now.url !== tab.url) {
        return result("error", "That tab is not visible now, so no screenshot was taken.", site);
      }
      const image = await deps.capture(now);
      return result("ok", "Screenshot of the visible part of " + (site || "the page") + " is attached.", site, {
        image,
        shared: { title: "Screenshot", host: site },
      });
    }

    case "open_tab": {
      const url = String(input.url);
      const host = hostOf(url);
      if (!host) return result("schema-error", "Only http and https addresses can be opened.");
      if (blockedBy(url, access, admin)) return result("blocked-by-user", "The user blocked this site.", host);
      const tab = await deps.openTab(url);
      return result("ok", "Opened tab " + tab.id + " in the background: " + cleanUrl(url), host, { opened_tab: tab.id });
    }

    case "close_tabs": {
      const ids = [...new Set(input.tab_ids as number[])];
      if (ids.length === 0 || ids.length > 20) return result("schema-error", "Give between 1 and 20 tab ids.");
      const tabs = (await Promise.all(ids.map((i) => deps.tab(i)))).filter((t): t is TabRef => !!t);
      if (tabs.length !== ids.length) return result("error", "Some of those tabs are not open.");
      const site = sitesOf(tabs);
      if (req.decision === "declined") return result("declined", "The user chose not to close these tabs.", site);
      if (req.decision !== "confirmed") return result("error", "Closing tabs needs the user's confirmation.", site);
      await deps.closeTabs(ids);
      return result("ok", "Closed " + ids.length + (ids.length === 1 ? " tab." : " tabs."), site);
    }

    case "group_tabs":
    case "ungroup_tabs": {
      const fn = name === "group_tabs" ? deps.groupTabs : deps.ungroupTabs;
      if (!fn) return result("unsupported", "This browser does not let extensions group tabs.");
      const ids = [...new Set(input.tab_ids as number[])];
      const tabs = (await Promise.all(ids.map((i) => deps.tab(i)))).filter((t): t is TabRef => !!t);
      if (tabs.length !== ids.length) return result("error", "Some of those tabs are not open.");
      await (name === "group_tabs" ? fn(ids, typeof input.title === "string" ? input.title.slice(0, 80) : undefined) : fn(ids));
      return result("ok", (name === "group_tabs" ? "Grouped " : "Ungrouped ") + ids.length + " tabs.", sitesOf(tabs));
    }

    case "run_task":
      // Stub until the agent runner (Part 3).
      return result("unsupported", "Agent tasks are not available here yet. The user can switch to Control Browser mode.");
  }
}

/** Runs one tool request and logs it. Never throws. */
export async function runTool(req: ToolRequest, deps: ToolHostDeps, log?: Pick<ToolLog, "add">): Promise<ToolResult> {
  const started = deps.now();
  let out: ToolResult;
  try {
    out = await run(req, deps);
  } catch {
    out = result("error", "The tool failed.");
  }
  await log
    ?.add({ at: started, tool: isToolName(req.name) ? req.name : "unknown:" + req.name.slice(0, 30), site: out.site, ms: Math.max(0, deps.now() - started), status: out.status })
    .catch(() => undefined);
  return out;
}
