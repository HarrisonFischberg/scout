// Permission gate (Part 2, spec 10a; Part 3, spec 10). Every context read,
// every tool call, and every Scout mode action is checked here, on the
// device; nothing relies on a server to enforce it. The user's choices live
// in storage.local under "pageAccess". The organization blocklist is a managed
// setting read from the host app over native messaging (ManagedPolicy.swift),
// never from storage. Sensitive-action confirmation is always on: there is no
// setting for it. "Always allow on this site" can skip it per site and kind,
// except for payments (ASK_EVERY_TIME).
import type { SensitiveKind } from "../safety/classifier";
import type { StorageArea } from "../settings/settings";

export const PAGE_ACCESS_KEY = "pageAccess";

export type ScreenshotChoice = "always" | "never";

/**
 * Scout mode: "on" starts a task as soon as it is sent (default; owner
 * decision 2026-10-17: never a per-task question, instead of the spec's ask
 * per task), "off" disables it. The sensitive-action confirmation is separate
 * and always on.
 */
export type ScoutModeChoice = "on" | "off";

export interface PageAccess {
  /** Include the current page with each question. Default on. */
  readCurrent: boolean;
  /** Let Scout search open tabs and history (search_tabs). Default off. */
  searchTabs: boolean;
  /** Screenshot answers per site (host). Sites not listed are asked each time. */
  screenshots: Record<string, ScreenshotChoice>;
  /** Sites the user blocked: never read, screenshotted, or acted on. */
  blocked: string[];
  /** Part 3: Scout mode on (default) or off. */
  scoutMode: ScoutModeChoice;
  /**
   * Part 3 "Always allow on this site": per host, the kinds of sensitive
   * action the user chose not to be asked about again. Revocable in Settings.
   */
  alwaysAllow: Record<string, SensitiveKind[]>;
}

export const DEFAULT_PAGE_ACCESS: PageAccess = { readCurrent: true, searchTabs: false, screenshots: {}, blocked: [], scoutMode: "on", alwaysAllow: {} };

export const MAX_BLOCKED = 200;
export const SENSITIVE_KINDS: readonly SensitiveKind[] = ["payment", "login", "send", "personal_data", "destructive", "download", "account", "leave_site"];
/** Asked every time: never offered or honored for "Always allow", so a page's hidden text can never spend money unasked. */
export const ASK_EVERY_TIME: readonly SensitiveKind[] = ["payment"];

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

/** Scout mode on this site: allowed, or refused and why. */
export function taskDecision(url: string, access: PageAccess, admin: readonly string[]): "allow" | "blocked-user" | "blocked-admin" | "off" {
  if (access.scoutMode === "off") return "off";
  const by = blockedBy(url, access, admin);
  if (by === "admin") return "blocked-admin";
  if (by === "user") return "blocked-user";
  return "allow";
}

/** The user chose "Always allow on this site" for this kind of sensitive action on this host. */
export function alwaysAllowed(url: string, kind: SensitiveKind, access: PageAccess): boolean {
  const host = hostOf(url);
  if (!host || ASK_EVERY_TIME.includes(kind)) return false;
  return Object.entries(access.alwaysAllow).some(([rule, kinds]) => siteMatches(host, rule) && kinds.includes(kind));
}

/** Records "Always allow on this site" for one kind of sensitive action. */
export function withAlwaysAllow(access: PageAccess, host: string, kind: SensitiveKind): PageAccess {
  const site = normalizeSite(host);
  if (!site || ASK_EVERY_TIME.includes(kind)) return access;
  const kinds = [...new Set([...(access.alwaysAllow[site] ?? []), kind])];
  return { ...access, alwaysAllow: { ...access.alwaysAllow, [site]: kinds } };
}

/** Revokes every "Always allow" choice for a site. */
export function withoutAlwaysAllow(access: PageAccess, host: string): PageAccess {
  const next = { ...access.alwaysAllow };
  delete next[host];
  return { ...access, alwaysAllow: next };
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
  const alwaysAllow: Record<string, SensitiveKind[]> = {};
  if (r.alwaysAllow && typeof r.alwaysAllow === "object" && !Array.isArray(r.alwaysAllow)) {
    for (const [k, v] of Object.entries(r.alwaysAllow as Record<string, unknown>)) {
      const host = normalizeSite(k);
      if (!host || !Array.isArray(v)) continue;
      const kinds = [...new Set(v.filter((x): x is SensitiveKind => SENSITIVE_KINDS.includes(x as SensitiveKind) && !ASK_EVERY_TIME.includes(x as SensitiveKind)))];
      if (kinds.length && Object.keys(alwaysAllow).length < MAX_BLOCKED) alwaysAllow[host] = kinds;
    }
  }
  return {
    readCurrent: typeof r.readCurrent === "boolean" ? r.readCurrent : DEFAULT_PAGE_ACCESS.readCurrent,
    searchTabs: r.searchTabs === true,
    screenshots,
    blocked,
    // A stored "ask" from an earlier build counts as on.
    scoutMode: r.scoutMode === "off" ? "off" : "on",
    alwaysAllow,
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
