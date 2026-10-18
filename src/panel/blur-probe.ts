// Debug builds only: records how the page blur goes away on iPhone (owner bug
// 2026-10-18: on a first open closed without a tap, the blur lingers; after
// any tap it clears at once; #33 and #34 did not fix it). Injected into the
// page next to the blur layer, it notes the panel's own events (sent as
// BlurProbeNote), the page's focus and viewport changes, the pings, and when
// the layer goes. The next open reads the previous log back into Diagnostics.
// Times and event names only; nothing from the page. Release builds never
// reference this file (popup.ts calls it under __SCOUT_DEBUG__).

/** Panel → probe: something happened in the panel (e.g. "blur", "pagehide"). */
export interface BlurProbeNote {
  blurProbe: string;
  note: string;
}

export const BLUR_PROBE_MAX = 80;

/** Starts a new log and returns the previous one. Self-contained: injected with scripting.executeScript. */
export function probeBlur(id: string, max: number): string[] {
  const g = globalThis as unknown as {
    __scoutBlurProbe?: { log: string[]; t0: number; lastPing: number; pings: number; listening?: boolean };
  };
  const previous = g.__scoutBlurProbe?.log ?? [];
  const had = g.__scoutBlurProbe?.listening === true;
  const p = (g.__scoutBlurProbe = { log: [], t0: performance.now(), lastPing: 0, pings: 0, listening: had });
  const add = (what: string): void => {
    const cur = g.__scoutBlurProbe ?? p;
    if (cur.log.length < max) cur.log.push(`${Math.round(performance.now() - cur.t0)}ms ${what}`);
  };
  if (!had) {
    p.listening = true;
    browser.runtime.onMessage.addListener((m: unknown) => {
      const cur = g.__scoutBlurProbe;
      if (!cur || !m || typeof m !== "object") return;
      const msg = m as { blur?: unknown; alive?: unknown; ttl?: unknown; blurProbe?: unknown; note?: unknown };
      if (msg.blurProbe === id && typeof msg.note === "string") add("panel " + msg.note.slice(0, 60));
      else if (msg.blur === id) {
        const now = performance.now();
        if (msg.alive !== true) add("goodbye");
        else {
          if (cur.pings === 0) add("first ping");
          else if (now - cur.lastPing > 150) add(`ping after a ${Math.round(now - cur.lastPing)}ms gap`);
          cur.pings++;
          cur.lastPing = now;
        }
      }
    });
    const watch = (target: EventTarget, type: string, detail?: () => string): void =>
      target.addEventListener(type, () => add("page " + type + (detail ? " " + detail() : "")), { passive: true });
    watch(window, "focus");
    watch(window, "blur");
    watch(window, "resize", () => `${innerWidth}x${innerHeight}`);
    watch(document, "visibilitychange", () => document.visibilityState);
    if (window.visualViewport) {
      const vv = window.visualViewport;
      watch(vv, "resize", () => `${Math.round(vv.width)}x${Math.round(vv.height)} scale ${vv.scale.toFixed(2)}`);
    }
    let present = document.getElementById(id) !== null;
    new MutationObserver(() => {
      const now = document.getElementById(id) !== null;
      if (now === present) return;
      present = now;
      const cur = g.__scoutBlurProbe;
      add(now ? "layer added" : `layer removed, ${cur && cur.pings ? Math.round(performance.now() - cur.lastPing) + "ms after the last ping" : "no pings"}`);
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
  add("probe start");
  return previous;
}
