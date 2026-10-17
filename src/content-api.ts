// Shared between the popup, the background worker, and the injected content
// script. Kept free of side effects so importing it never runs content-script
// setup elsewhere.
import type { Action } from "./actions/executor";
import type { ScoutAction } from "./scout/actions";
import type { OverlayState } from "./scout/overlay";

export type ContentRequest =
  // Coupon runs ask for more of the page (order summaries sit late in it); the content script caps both.
  | { type: "scout:snapshot"; maxElements?: number; maxTextChars?: number }
  | { type: "scout:act"; action: Action }
  // Store cart API (Shopify, WooCommerce, BigCommerce), T031/T040: same-origin, user's session, never checkout.
  | { type: "scout:cart-info" }
  | { type: "scout:cart-update"; discount: string }
  // Codes the store's home page advertises (same origin); only the codes come back.
  | { type: "scout:store-codes" }
  | { type: "scout:reload" }
  // ---------- Part 3: Scout mode ----------
  /** One allow-listed Scout action; coordinates already in CSS viewport px. */
  | { type: "scout:scout-act"; action: ScoutAction }
  /** Viewport size for coordinate scaling (spec 8.3). */
  | { type: "scout:viewport" }
  /** Shows, updates or hides the Scouting overlay (spec 9). */
  | { type: "scout:overlay"; command: "show" | "hide"; state?: OverlayState }
  | { type: "scout:overlay"; command: "state"; state: OverlayState }
  /** Take control / Stop: aborts the action in progress on the page at once. */
  | { type: "scout:halt" };

/** Global the content script registers its handler under (isolated world). */
export const CONTENT_HANDLER = "__safariScoutHandle";

/** Viewport reply for scout:viewport. */
export interface ViewportInfo {
  width: number;
  height: number;
  devicePixelRatio: number;
}
