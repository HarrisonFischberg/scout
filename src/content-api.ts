// Shared between the popup, the worker, and the injected content scripts.
// Kept free of side effects so importing it never runs content-script setup
// in the popup or the worker.
import type { Action } from "./actions/executor";
import type { Target, TaskAction } from "./actions/vocabulary";

export type ContentRequest =
  // Coupon runs ask for more of the page (order summaries sit late in it); the content script caps both.
  | { type: "scout:snapshot"; maxElements?: number; maxTextChars?: number }
  | { type: "scout:act"; action: Action }
  // Part 3 Scout mode (src/actions/task-dom.ts): what is at a target, and one allow-listed action.
  | { type: "scout:task-probe"; target: Target | "focused" }
  | { type: "scout:task-act"; action: TaskAction }
  // Store cart API (Shopify, WooCommerce, BigCommerce), T031/T040: same-origin, user's session, never checkout.
  | { type: "scout:cart-info" }
  | { type: "scout:cart-update"; discount: string }
  // Codes the store's home page advertises (same origin); only the codes and the words around them come back.
  | { type: "scout:store-codes" }
  // How the page names the store (meta tags), to identify the merchant behind a checkout host.
  | { type: "scout:page-meta" }
  | { type: "scout:reload" };

/** Global the content script registers its handler under (isolated world). */
export const CONTENT_HANDLER = "__safariScoutHandle";

/** Part 3: the scouting overlay's handler (src/overlay.ts), same isolated world. */
export const OVERLAY_HANDLER = "__safariScoutOverlay";

export type OverlayRequest =
  | { type: "overlay:show"; taskId: string; state: "running" | "paused" | "waiting" }
  | { type: "overlay:state"; state: "running" | "paused" | "waiting" }
  | { type: "overlay:marker"; x: number; y: number }
  | { type: "overlay:hide" }
  | { type: "overlay:status" };
