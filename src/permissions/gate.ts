// Permission gate (Part 2, spec 10a). Every context read and every tool call
// is checked here, on the device; nothing relies on a server to enforce it.
// The user's choices live in storage.local under "pageAccess". The
// organization blocklist is a managed setting read from the host app over
// native messaging (ManagedPolicy.swift), never from storage.
import type { StorageArea } from "../settings/settings";

export const PAGE_ACCESS_KEY = "pageAccess";

export type ScreenshotChoice = "always" | "never";

export interface PageAccess {
  /** Include the current page with each question. Default on. */
  readCurrent: boolean;
  /** Let Scout search open tabs and history (search_tabs). Default off. */
  searchTabs: boolean;
  /** Screenshot answers per site (host). Sites not listed are asked each time. */
  screenshots: Record<string, ScreenshotChoice>;
  /** Sites the user blocked: never read or screenshotted. */
  blocked: string[];
}

export const DEFAULT_PAGE_ACCESS: PageAccess = { readCurrent: true, searchTabs: false, screenshots: {}, blocked: [] };

export const MAX_BLOCKED = 200;

/** Host of an http(s) URL, lowercased; null for anything else. */
export function hostOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Turns what a user typed ("https://www.Example.com/a", "*.example.com",
 * "example.com") into a site rule ("www.example.com", "example.com"). A rule
 * covers the host and its subdomains. Null when it is not a usable host.
 */
export function normalizeSite(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^\*\./, "");
  const host = hostOf(/^[a-z][a-z0-9+.-]*:\/\//.test(s) ? s : "https://" + s);
  if (!host || !/^[a-z0-9.-]+$/.test(host) || host.startsWith(".") || host.endsWith(".")) return null;
  if (!host.includes(".") && host !== "localhost") return null;
  return host;
}

export function siteMatches(host: string, rule: string): boolean {
  return host === rule || host.endsWith("." + rule);
}

/** Who blocks this URL, if anyone. Non-web URLs are never readable. */
export function blockedBy(url: string, access: PageAccess, admin: readonly string[]): "user" | "admin" | null {
  const host = hostOf(url);
  if (!host) return "user";
  if (admin.some((r) => siteMatches(host, r))) return "admin";
  if (access.blocked.some((r) => siteMatches(host, r))) return "user";
  return null;
}

/** Screenshot of a page at `url`: allowed, asked, or refused. Blocked sites are always refused. */
export function screenshotDecision(url: string, access: PageAccess, admin: readonly string[]): "allow" | "ask" | "deny" {
  if (blockedBy(url, access, admin)) return "deny";
  const host = hostOf(url);
  const choice = host ? access.screenshots[host] : undefined;
  return choice === "always" ? "allow" : choice === "never" ? "deny" : "ask";
}

// Stored data is untrusted input: anything malformed falls back to the default.
export function parsePageAccess(raw: unknown): PageAccess {
  const r = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const screenshots: Record<string, ScreenshotChoice> = {};
  if (r.screenshots && typeof r.screenshots === "object" && !Array.isArray(r.screenshots)) {
    for (const [k, v] of Object.entries(r.screenshots as Record<string, unknown>)) {
      const host = normalizeSite(k);
      if (host && (v === "always" || v === "never")) screenshots[host] = v;
    }
  }
  const blocked = Array.isArray(r.blocked)
    ? [...new Set(r.blocked.flatMap((b) => (typeof b === "string" ? (normalizeSite(b) ?? []) : [])))].slice(0, MAX_BLOCKED)
    : [];
  return {
    readCurrent: typeof r.readCurrent === "boolean" ? r.readCurrent : DEFAULT_PAGE_ACCESS.readCurrent,
    searchTabs: r.searchTabs === true,
    screenshots,
    blocked,
  };
}

export async function loadPageAccess(storage: Pick<StorageArea, "get"> | undefined): Promise<PageAccess> {
  if (!storage) return { ...DEFAULT_PAGE_ACCESS };
  const got = await storage.get(PAGE_ACCESS_KEY).catch(() => ({}) as Record<string, unknown>);
  return parsePageAccess(got[PAGE_ACCESS_KEY]);
}

export async function savePageAccess(storage: Pick<StorageArea, "set">, access: PageAccess): Promise<void> {
  await storage.set({ [PAGE_ACCESS_KEY]: parsePageAccess(access) });
}

/** Organization blocklist from the host app's managed setting. Empty when none is set or the app does not answer. */
export function parsePolicy(reply: unknown): string[] {
  const r = (reply && typeof reply === "object" ? reply : {}) as { ok?: unknown; blocked?: unknown };
  if (r.ok !== true || !Array.isArray(r.blocked)) return [];
  return [...new Set(r.blocked.flatMap((b) => (typeof b === "string" ? (normalizeSite(b) ?? []) : [])))].slice(0, MAX_BLOCKED);
}
