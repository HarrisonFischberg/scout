// Quick ask (owner request 2026-10-18, option A of the Comet comparison):
// on iPhone a tap on Scout's page tab no longer opens Safari's sheet straight
// away. A small question box grows out of the tab, docks above the keyboard,
// and the page behind it dims and blurs, like Comet's assistant prompt. What
// is asked there is handed to the worker, which opens Scout's own panel and
// gives it the question to run (src/background.ts, src/popup.ts).
//
// Safari 26 paints the strip under its bottom bar from page layers that reach
// the bottom edge of the screen (the white bar, #27-#39), so the dim layer and
// the box always stop QUICK_ASK_BOTTOM_GAP_PX above it. This file holds the
// rules; src/quick-ask.ts draws the box.
import { topLayerTab } from "./edge";

/** Screen pixels at the bottom that nothing of the quick ask covers (same strip as #28). */
export const QUICK_ASK_BOTTOM_GAP_PX = 96;
/** Space between the box and the keyboard or screen edge, in screen pixels. */
export const QUICK_ASK_MARGIN_PX = 8;
/** A question waits this long for Scout's panel to open and take it. */
export const PENDING_ASK_MS = 30_000;
/** Longest question the page box accepts. */
export const QUICK_ASK_MAX_CHARS = 4000;

export type QuickAskKind = "ask" | "summarize";

export interface QuickAsk {
  kind: QuickAskKind;
  /** Empty for summarize. */
  question: string;
}

interface Pending extends QuickAsk {
  at: number;
}

/**
 * Whether a tap on the page tab opens the quick ask (phones) or Scout's panel
 * directly (iPad, and anywhere else the tab runs). Same test as the tab's top
 * layer: a phone-sized touch screen.
 */
export function quickAskOffered(coarsePointer: boolean, screenWidth: number): boolean {
  return !topLayerTab(coarsePointer, screenWidth);
}

/** A quick ask from a content script, checked: a known kind and a non-empty question for "ask". */
export function parseQuickAsk(raw: unknown): QuickAsk | null {
  if (!raw || typeof raw !== "object") return null;
  const { kind, question } = raw as { kind?: unknown; question?: unknown };
  if (kind === "summarize") return { kind, question: "" };
  if (kind !== "ask" || typeof question !== "string") return null;
  const q = question.trim().slice(0, QUICK_ASK_MAX_CHARS);
  return q ? { kind, question: q } : null;
}

/**
 * Questions asked on a page, waiting for that tab's panel to open. One per
 * tab; a newer one replaces it, and each is taken at most once.
 */
export function createAskQueue(): { put(tabId: number, ask: QuickAsk, now: number): void; take(tabId: number, now: number): QuickAsk | null; drop(tabId: number): void } {
  const waiting = new Map<number, Pending>();
  return {
    put(tabId, ask, now) {
      waiting.set(tabId, { ...ask, at: now });
    },
    take(tabId, now) {
      const p = waiting.get(tabId);
      waiting.delete(tabId);
      if (!p || now - p.at > PENDING_ASK_MS || now < p.at) return null;
      return { kind: p.kind, question: p.question };
    },
    drop(tabId) {
      waiting.delete(tabId);
    },
  };
}

export interface PlaceInput {
  /** innerHeight: the layout viewport fixed boxes are placed in. */
  layoutHeight: number;
  /** visualViewport.offsetTop and height: the part of the page on screen above the keyboard. */
  viewTop: number;
  viewHeight: number;
  /** The box's own height, CSS pixels. */
  boxHeight: number;
  /** CSS pixels per screen pixel on this page (tabScale; above 1 on pages Safari zooms out). */
  scale: number;
}

export interface Placement {
  /** Top of the box, CSS pixels from the top of the layout viewport. */
  boxTop: number;
  /** Height of the dim layer from the top; it ends at the keyboard and never reaches the bottom strip. */
  dimHeight: number;
}

/** Where the box and the dim go: right above the keyboard, never in the bottom strip Safari samples. */
export function placeQuickAsk(v: PlaceInput): Placement {
  const k = Number.isFinite(v.scale) && v.scale > 0 ? v.scale : 1;
  const floor = v.layoutHeight - QUICK_ASK_BOTTOM_GAP_PX * k;
  const bottom = Math.max(0, Math.min(v.viewTop + v.viewHeight, floor));
  const boxTop = Math.max(v.viewTop + QUICK_ASK_MARGIN_PX * k, bottom - QUICK_ASK_MARGIN_PX * k - v.boxHeight);
  return { boxTop: Math.round(boxTop), dimHeight: Math.round(bottom) };
}
