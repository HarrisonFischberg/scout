// Shared between the popup and the injected content script. Kept free of side
// effects so importing it never runs content-script setup in the popup.
import type { Action } from "./actions/executor";

export type ContentRequest =
  | { type: "scout:snapshot" }
  | { type: "scout:act"; action: Action }
  // Store cart API (Shopify), T031: same-origin, user's session, never checkout.
  | { type: "scout:cart-info" }
  | { type: "scout:cart-update"; discount: string }
  | { type: "scout:reload" };

/** Global the content script registers its handler under (isolated world). */
export const CONTENT_HANDLER = "__safariScoutHandle";
