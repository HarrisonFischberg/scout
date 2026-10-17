// Scout mode permissions (Part 3, spec 10). Stored on the device under
// "scoutAccess"; every check runs here, never on a server. Sensitive-action
// confirmation is always on and has no stored switch. "Always allow on this
// site" is kept per site and per kind of action, and the user can revoke it.
import { hostOf, normalizeSite, siteMatches } from "../permissions/gate";
import type { StorageArea } from "../settings/settings";
import { SENSITIVE_KINDS, type SensitiveKind } from "./sensitive";

export const SCOUT_ACCESS_KEY = "scoutAccess";

/** "ask": confirm before each task (default). "off": Scout mode is unavailable. */
export type ScoutMode = "ask" | "off";

export interface ScoutAccess {
  mode: ScoutMode;
  /** Sites where the user chose "Always allow on this site", with the kinds of sensitive action allowed there. */
  alwaysAllow: Record<string, SensitiveKind[]>;
}

export const DEFAULT_SCOUT_ACCESS: ScoutAccess = { mode: "ask", alwaysAllow: {} };
export const MAX_ALWAYS_SITES = 200;

// Stored data is untrusted input: anything malformed falls back to the default.
export function parseScoutAccess(raw: unknown): ScoutAccess {
  const r = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const alwaysAllow: Record<string, SensitiveKind[]> = {};
  if (r.alwaysAllow && typeof r.alwaysAllow === "object" && !Array.isArray(r.alwaysAllow)) {
    for (const [k, v] of Object.entries(r.alwaysAllow as Record<string, unknown>)) {
      const host = normalizeSite(k);
      if (!host || !Array.isArray(v)) continue;
      const kinds = [...new Set(v.filter((x): x is SensitiveKind => (SENSITIVE_KINDS as readonly unknown[]).includes(x)))];
      if (kinds.length && Object.keys(alwaysAllow).length < MAX_ALWAYS_SITES) alwaysAllow[host] = kinds;
    }
  }
  return { mode: r.mode === "off" ? "off" : "ask", alwaysAllow };
}

export async function loadScoutAccess(storage: Pick<StorageArea, "get"> | undefined): Promise<ScoutAccess> {
  if (!storage) return { ...DEFAULT_SCOUT_ACCESS, alwaysAllow: {} };
  const got = await storage.get(SCOUT_ACCESS_KEY).catch(() => ({}) as Record<string, unknown>);
  return parseScoutAccess(got[SCOUT_ACCESS_KEY]);
}

export async function saveScoutAccess(storage: Pick<StorageArea, "set">, access: ScoutAccess): Promise<void> {
  await storage.set({ [SCOUT_ACCESS_KEY]: parseScoutAccess(access) });
}

/** True when the user chose "Always allow on this site" for this kind of action. */
export function alwaysAllowed(url: string, kind: SensitiveKind, access: ScoutAccess): boolean {
  const host = hostOf(url);
  if (!host) return false;
  return Object.entries(access.alwaysAllow).some(([rule, kinds]) => siteMatches(host, rule) && kinds.includes(kind));
}

export function withAlwaysAllow(access: ScoutAccess, url: string, kind: SensitiveKind): ScoutAccess {
  const host = hostOf(url);
  if (!host) return access;
  const kinds = [...new Set([...(access.alwaysAllow[host] ?? []), kind])];
  return { ...access, alwaysAllow: { ...access.alwaysAllow, [host]: kinds } };
}

/** Revokes every "Always allow" choice for a site. */
export function withoutAlwaysAllow(access: ScoutAccess, host: string): ScoutAccess {
  const next = { ...access.alwaysAllow };
  delete next[host];
  return { ...access, alwaysAllow: next };
}

export type TaskRefusal = "private" | "blocked" | "admin" | "off" | "not_web";

/**
 * Whether a task may start on this tab at all (spec 10: Scout mode off in
 * Private Browsing, never on a blocked site). Null means it may, after the
 * per-task question the panel asks.
 */
export function taskRefusal(
  tab: { url: string; incognito?: boolean },
  access: ScoutAccess,
  blocked: (url: string) => "user" | "admin" | null,
): TaskRefusal | null {
  if (tab.incognito) return "private";
  if (access.mode === "off") return "off";
  if (!hostOf(tab.url)) return "not_web";
  const by = blocked(tab.url);
  if (by === "admin") return "admin";
  if (by === "user") return "blocked";
  return null;
}

export function refusalText(r: TaskRefusal): string {
  switch (r) {
    case "private":
      return "Scout mode is off in Private Browsing.";
    case "off":
      return "Scout mode is turned off in Settings > Permissions.";
    case "not_web":
      return "Scout mode works on web pages only.";
    case "admin":
      return "Your organization blocks Scout on this site.";
    case "blocked":
      return "You blocked this site. Unblock it in Settings > Permissions to use Scout mode here.";
  }
}
