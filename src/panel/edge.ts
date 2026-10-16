// Page button (owner request 2026-10-16): a small Scout tab on the edge of the
// page, for iPhone and iPad, where Safari keeps extension buttons in the page
// menu. Off until the user turns it on; runs only on sites Scout can access and
// never in Private Browsing. Tapping it opens the toolbar panel. Pure helpers
// shared by the content script (src/edge.ts), the worker, Settings, and tests.

export const PAGE_BUTTON_KEY = "pageButton";

export type Side = "left" | "right";

export interface PageButton {
  on: boolean;
  side: Side;
  /** Vertical position of the tab's center, as a fraction of the viewport height. */
  y: number;
}

export const DEFAULT_PAGE_BUTTON: PageButton = { on: false, side: "right", y: 0.45 };

/** Keeps the tab clear of the page's own header and of Safari's bottom bar. */
export const Y_MIN = 0.12;
export const Y_MAX = 0.82;

export function clampY(y: number): number {
  if (!Number.isFinite(y)) return DEFAULT_PAGE_BUTTON.y;
  return Math.min(Y_MAX, Math.max(Y_MIN, y));
}

// Stored data is untrusted input: anything malformed falls back to the default.
export function parsePageButton(raw: unknown): PageButton {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    on: r.on === true,
    side: r.side === "left" ? "left" : "right",
    y: typeof r.y === "number" ? clampY(r.y) : DEFAULT_PAGE_BUTTON.y,
  };
}

/** The side a dragged tab settles on: whichever edge the finger is nearer. */
export function snapSide(x: number, width: number): Side {
  return x < width / 2 ? "left" : "right";
}

/** A pointer that moves less than this (CSS px) is a tap, not a drag. */
export const DRAG_SLOP = 8;

export function isDrag(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= DRAG_SLOP;
}

/** The tab shrinks to a sliver after this long without use. */
export const TUCK_AFTER_MS = 2500;

/** Arrow keys move a focused tab by this fraction of the viewport height. */
export const KEY_STEP = 0.05;

// ---------- Where the content script runs ----------
/** Id of the content script the worker registers (scripting.registerContentScripts). */
export const EDGE_SCRIPT_ID = "scout-edge";

const PROVIDER_HOSTS = ["api.anthropic.com", "api.openai.com"];
const MATCH = /^(\*|https?):\/\/(\*|(\*\.)?[^/*]+)\/.*$/;

/**
 * Match patterns for the edge script: the web origins Scout was granted, never
 * the AI provider hosts. Anything that is not an http(s) match pattern is
 * dropped, so a granted origin can only narrow where the script runs.
 */
export function edgeMatches(origins: readonly string[]): string[] {
  const out = new Set<string>();
  for (const o of origins) {
    if (o === "<all_urls>") {
      out.add("http://*/*");
      out.add("https://*/*");
      continue;
    }
    const m = MATCH.exec(o);
    if (!m || PROVIDER_HOSTS.includes(m[2] ?? "")) continue;
    out.add(o);
  }
  return [...out].sort();
}

export function sameMatches(a: readonly string[], b: readonly string[]): boolean {
  const x = [...a].sort();
  const y = [...b].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/** Whether the granted origins reach every website. */
export function coversAllSites(origins: readonly string[]): boolean {
  const m = edgeMatches(origins);
  return m.includes("*://*/*") || (m.includes("http://*/*") && m.includes("https://*/*"));
}

/** Settings line under the page-button switch. */
export function reachText(on: boolean, origins: readonly string[]): string {
  if (!on) return "Off.";
  if (coversAllSites(origins)) return "On for every website.";
  const n = edgeMatches(origins).length;
  if (n === 0) return "On. It appears on a site after you let Scout for Safari access it.";
  return "On for " + n + (n === 1 ? " site" : " sites") + " Scout for Safari can access (listed under Site access).";
}

/** Permission asked for when the user turns the button on. Safari lets them pick a narrower grant. */
export const ALL_SITES = ["http://*/*", "https://*/*"];
