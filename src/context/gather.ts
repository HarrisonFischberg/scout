// Reads tabs for a question (Part 2, spec 6): the gate is checked before any
// script runs, each page has 8 s, the whole request 12 s, and whatever came
// back in time is used. Every tab gets a status the panel shows under the
// message.
import type { PageContext } from "../chat/prompt";
import { blockedBy, hostOf, type PageAccess } from "../permissions/gate";
import { toPageContext } from "./clean";

export const PAGE_TIMEOUT_MS = 8_000;
export const CONTEXT_TIMEOUT_MS = 12_000;

export type ReadStatus = "read" | "partial" | "timeout" | "blocked" | "failed";

/** What the panel shows under a message: never page text. */
export interface SharedTab {
  tab_id: number;
  title: string;
  host: string;
  status: ReadStatus;
}

export interface TabRead {
  shared: SharedTab;
  page?: PageContext;
}

export interface TabRef {
  id: number;
  url: string;
  title: string;
  windowId?: number;
  active?: boolean;
  incognito?: boolean;
}

export interface GatherDeps {
  /** The tab's current URL and title, before anything runs in it. */
  tab(id: number): Promise<TabRef | null>;
  /** Runs the extractor in the tab; resolves with its raw result. */
  extract(id: number): Promise<unknown>;
  access: PageAccess;
  admin: readonly string[];
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

function timeout<T>(p: Promise<T>, ms: number, deps: GatherDeps): Promise<T | "timeout"> {
  const set = deps.setTimer ?? ((fn, t) => setTimeout(fn, t));
  const clear = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  return new Promise((resolve, reject) => {
    const h = set(() => resolve("timeout"), ms);
    p.then(
      (v) => {
        clear(h);
        resolve(v);
      },
      (e) => {
        clear(h);
        reject(e);
      },
    );
  });
}

/** Reads one tab, gate first. Never throws. */
export async function readTab(id: number, deps: GatherDeps, pageMs = PAGE_TIMEOUT_MS): Promise<TabRead> {
  const info = await deps.tab(id).catch(() => null);
  const shared = (status: ReadStatus, title = info?.title ?? "", url = info?.url ?? ""): SharedTab => ({
    tab_id: id,
    title: title || hostOf(url) || "Tab",
    host: hostOf(url) ?? "",
    status,
  });
  // No URL means the site cannot be checked against the blocklists: not read.
  if (!info || !info.url) return { shared: shared("failed") };
  if (blockedBy(info.url, deps.access, deps.admin)) return { shared: shared("blocked") };
  let raw: unknown;
  try {
    raw = await timeout(deps.extract(id), pageMs, deps);
  } catch {
    return { shared: shared("failed") };
  }
  if (raw === "timeout") return { shared: shared("timeout") };
  const cleaned = toPageContext(raw);
  if (!cleaned) return { shared: shared("failed") };
  // The tab may have navigated meanwhile: the page that answered is checked too.
  if (blockedBy(cleaned.page.url, deps.access, deps.admin)) return { shared: shared("blocked", "", cleaned.page.url) };
  return { shared: shared(cleaned.partial ? "partial" : "read", cleaned.page.title, cleaned.page.url), page: cleaned.page };
}

/** Reads tabs in parallel within the overall limit; late tabs are reported as timed out. */
export async function readTabs(ids: number[], deps: GatherDeps, limits = { pageMs: PAGE_TIMEOUT_MS, totalMs: CONTEXT_TIMEOUT_MS }): Promise<TabRead[]> {
  const unique = [...new Set(ids)];
  const done = new Map<number, TabRead>();
  const all = Promise.all(
    unique.map((id) =>
      readTab(id, deps, limits.pageMs).then((r) => {
        done.set(id, r);
      }),
    ),
  );
  await timeout(all, limits.totalMs, deps);
  return unique.map(
    (id) => done.get(id) ?? { shared: { tab_id: id, title: "Tab", host: "", status: "timeout" as const } },
  );
}
