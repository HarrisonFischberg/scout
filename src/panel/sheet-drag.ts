// iPhone sheet drag (owner bug 2026-10-18): Safari resizes the panel about
// every 18 ms while its sheet is dragged but draws the page a frame or two
// behind the sheet (device log, #46), so the starters just above the
// composer visibly wobble. Owner choice: fade them while the sheet moves and
// bring them back once it settles. A single resize (the panel opening, a
// detent snap) is not a drag, and neither is the keyboard sliding up.

/** Two resizes closer than this are a drag. */
export const DRAG_STEP_MS = 100;
/** The sheet has settled once no resize has come for this long. */
export const DRAG_SETTLE_MS = 180;

interface DragWindow {
  readonly performance: { now(): number };
  addEventListener(type: "resize", listener: () => void): void;
  setTimeout(cb: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

/** Calls `onChange(true)` when a drag starts and `onChange(false)` when it settles. */
export function watchSheetDrag(win: DragWindow, typing: () => boolean, onChange: (dragging: boolean) => void): void {
  let last = -Infinity;
  let dragging = false;
  let settle = 0;
  win.addEventListener("resize", () => {
    const now = win.performance.now();
    const quick = now - last < DRAG_STEP_MS;
    last = now;
    if (!dragging && quick && !typing()) {
      dragging = true;
      onChange(true);
    }
    if (!dragging) return;
    win.clearTimeout(settle);
    settle = win.setTimeout(() => {
      dragging = false;
      onChange(false);
    }, DRAG_SETTLE_MS);
  });
}
