// Page blur behind the panel on iPhone (owner design 2026-10-17): while
// Scout's sheet is open the page above it is frosted, so the panel reads as
// the focus. The panel adds the layer when it opens (it holds the activeTab
// grant then); the worker removes it when the panel's port closes, since a
// closing popup cannot finish an async call. Both functions are injected with
// scripting.executeScript, so each must be self-contained. The layer reads
// nothing from the page and lets every touch through.

export const BLUR_LAYER_ID = "__safari-scout-blur";
// Owner, 2026-10-18: cleared by about 40% (was 18% dim, 14px blur) so the page
// stays readable behind the coupon search glow.
export const PAGE_DIM = "11%";
export const PAGE_BLUR_PX = 9;

/** The panel blurs the page only on a phone-sized touch screen, not on Mac or iPad. */
export function wantsPageBlur(coarsePointer: boolean, screenWidth: number): boolean {
  return coarsePointer && screenWidth < 600;
}

export function addPageBlur(id: string): boolean {
  if (document.getElementById(id)) return true;
  const layer = document.createElement("div");
  layer.id = id;
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText =
    "all: initial; position: fixed; inset: 0; z-index: 2147483646; pointer-events: none;" +
    "background: rgb(0 0 0 / 11%); -webkit-backdrop-filter: blur(9px) saturate(120%); backdrop-filter: blur(9px) saturate(120%);";
  (document.body ?? document.documentElement).appendChild(layer);
  return true;
}

export function removePageBlur(id: string): boolean {
  document.getElementById(id)?.remove();
  return true;
}
