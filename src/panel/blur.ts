// Page blur behind the panel on iPhone (owner design 2026-10-17): while
// Scout's sheet is open the page above it is frosted, so the panel reads as
// the focus. The panel adds the layer when it opens (it holds the activeTab
// grant then); the worker removes it when the panel's port closes, since a
// closing popup cannot finish an async call. Both functions are injected with
// scripting.executeScript, so each must be self-contained. The layer reads
// nothing from the page and lets every touch through.

export const BLUR_LAYER_ID = "__safari-scout-blur";
// Owner, 2026-10-18: cleared to about a third of the first design (was 18% dim,
// 14px blur), so the page stays readable behind the coupon search glow.
export const PAGE_DIM = "5.5%";
export const PAGE_BLUR_PX = 4.5;
// Owner bug report 2026-10-18: closing Scout flashed a solid strip under
// Safari's bottom bar. A see-through fixed box over the whole screen is what
// iPhone Safari 26 takes as a dimming layer, and it then paints the page
// background under its bar; the layer outlives the sheet by a moment because
// the worker removes it once the panel has closed. Stopping it this far above
// the bottom keeps it out of the strip Safari samples. The sheet covers the
// bottom of the page while it is open, so nothing visible changes.
export const PAGE_BLUR_BOTTOM_GAP_PX = 96;

/** The panel blurs the page only on a phone-sized touch screen, not on Mac or iPad. */
export function wantsPageBlur(coarsePointer: boolean, screenWidth: number): boolean {
  return coarsePointer && screenWidth < 600;
}

// Owner bug report 2026-10-18: after closing Scout the page stayed frosted for
// a while. Removal waited on the worker, which only hears that the panel
// closed once its port drops, and a suspended worker can take long to wake
// for that. So the layer also clears itself: the open panel pings it every
// BLUR_PING_MS, says goodbye as it closes (pagehide), and a layer that hears
// nothing for BLUR_TIMEOUT_MS takes itself off. The worker's removal stays as
// a last resort.
export const BLUR_PING_MS = 250;
export const BLUR_TIMEOUT_MS = 900;

/** Message from the panel to the layer: `alive: false` clears it now. */
export interface BlurPing {
  blur: string;
  alive: boolean;
}

export function addPageBlur(id: string, timeoutMs: number): boolean {
  const g = globalThis as unknown as { __scoutBlur?: { timer?: ReturnType<typeof setTimeout>; listening?: boolean } };
  const state = (g.__scoutBlur ??= {});
  const drop = (): void => {
    clearTimeout(state.timer);
    document.getElementById(id)?.remove();
  };
  const arm = (): void => {
    clearTimeout(state.timer);
    state.timer = setTimeout(drop, timeoutMs);
  };
  if (!state.listening) {
    state.listening = true;
    browser.runtime.onMessage.addListener((m: unknown) => {
      const ping = m as Partial<BlurPing> | null;
      if (!ping || ping.blur !== id) return;
      if (ping.alive === true) arm();
      else drop();
    });
  }
  if (!document.getElementById(id)) {
    const layer = document.createElement("div");
    layer.id = id;
    layer.setAttribute("aria-hidden", "true");
    layer.style.cssText =
      "all: initial; position: fixed; top: 0; left: 0; right: 0; bottom: 96px; z-index: 2147483646; pointer-events: none;" +
      "background: rgb(0 0 0 / 5.5%); -webkit-backdrop-filter: blur(4.5px) saturate(120%); backdrop-filter: blur(4.5px) saturate(120%);";
    (document.body ?? document.documentElement).appendChild(layer);
  }
  arm();
  return true;
}

export function removePageBlur(id: string): boolean {
  document.getElementById(id)?.remove();
  return true;
}
