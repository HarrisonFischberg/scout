// Shared between the popup and the injected content script. Kept free of side
// effects so importing it never runs content-script setup in the popup.
import type { Action } from "./actions/executor";

export type ContentRequest =
  // Coupon runs ask for more of the page (order summaries sit late in it); the content script caps both.
  | { type: "scout:snapshot"; maxElements?: number; maxTextChars?: number }
  | { type: "scout:act"; action: Action }
  // Store cart API (Shopify, WooCommerce, BigCommerce), T031/T040: same-origin, user's session, never checkout.
  | { type: "scout:cart-info" }
  | { type: "scout:cart-update"; discount: string }
  // Codes the store's home page advertises (same origin); only the codes come back.
  | { type: "scout:store-codes" }
  | { type: "scout:reload" };

/** Global the content script registers its handler under (isolated world). */
export const CONTENT_HANDLER = "__safariScoutHandle";
