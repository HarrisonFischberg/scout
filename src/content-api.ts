// Shared between the popup and the injected content script. Kept free of side
// effects so importing it never runs content-script setup in the popup.
import type { Action } from "./actions/executor";

export type ContentRequest = { type: "assistant:snapshot" } | { type: "assistant:act"; action: Action };

/** Global the content script registers its handler under (isolated world). */
export const CONTENT_HANDLER = "__assistAntHandle";
