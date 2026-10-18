// Debug builds only: how Safari resizes the iPhone panel while its sheet is
// dragged (owner bug 2026-10-18, still jittery after #45, "particularly
// around the summarize and explain text"). One line per drag goes into
// Diagnostics.
//
// First device log (2026-10-18, #46): Safari resizes the panel about every
// 18 ms and Scout's frames keep up (1-2 slow frames per drag), but the
// starters sat anywhere from 0 to 173 px above the window's bottom edge
// (136 px at rest), so the page was laid out at a different height from the
// window on many frames. This log now also records the page's own height
// (documentElement.clientHeight) and the composer's bottom edge. A debug
// switch (#47) tried three height sources (the stylesheet's 100%,
// innerHeight, visualViewport.height) and the owner felt no difference, so
// the lag is Safari drawing the panel behind its sheet; src/panel/sheet-drag.ts
// hides the starters while it moves instead. Sizes and times only.

/** Quiet time after the last resize that ends a drag. */
export const DRAG_QUIET_MS = 400;
/** A frame slower than this missed at least one 60 Hz refresh. */
export const SLOW_FRAME_MS = 25;

export interface DragSample {
  /** performance.now() of the resize event. */
  at: number;
  height: number;
  /** visualViewport.height, rounded. */
  view: number;
  /** documentElement.clientHeight: the height the page is laid out at. */
  page: number;
  /** Distance from the starters' bottom edge to the window's bottom edge (negative: below it), or NaN when hidden. */
  gap: number;
  /** The same for the composer box. */
  composer: number;
}

const range = (xs: readonly number[]): string => {
  if (!xs.length) return "n/a";
  const lo = Math.round(Math.min(...xs));
  const hi = Math.round(Math.max(...xs));
  return lo === hi ? `${lo}` : `${lo}..${hi}`;
};

/** One Diagnostics line for a finished drag (kept under the 300-character stage limit). */
export function summarizeDrag(samples: readonly DragSample[], frames: readonly number[]): string {
  const n = samples.length;
  const first = samples[0];
  const last = samples[n - 1];
  if (!first || !last) return "drag: no resizes";
  const gaps: number[] = [];
  for (let i = 1; i < n; i++) gaps.push(samples[i]!.at - samples[i - 1]!.at);
  const avg = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
  const maxOf = (xs: readonly number[]): number => (xs.length ? Math.max(...xs) : 0);
  return [
    `drag: ${n} resizes/${Math.round(last.at - first.at)} ms`,
    `h ${first.height}->${last.height}`,
    `gap ${Math.round(avg)}/${Math.round(maxOf(gaps))} ms`,
    `frames ${frames.length} slow ${frames.filter((f) => f > SLOW_FRAME_MS).length} max ${Math.round(maxOf(frames))}`,
    `view-win ${range(samples.map((s) => s.view - s.height))}`,
    `page-win ${range(samples.map((s) => s.page - s.height))}`,
    `composer ${range(samples.map((s) => s.composer).filter(Number.isFinite))}`,
    `starters ${range(samples.map((s) => s.gap).filter(Number.isFinite))}`,
  ].join(", ");
}

export interface DragProbeTargets {
  starters(): Element | null;
  composer(): Element | null;
}

/** Starts logging drags. `note` receives one line per drag. */
export function probeDrag(win: Window, targets: DragProbeTargets, note: (line: string) => void): void {
  let samples: DragSample[] = [];
  let frames: number[] = [];
  let lastFrame = 0;
  let lastResize = 0;
  let looping = false;
  const frame = (t: number): void => {
    if (lastFrame) frames.push(t - lastFrame);
    lastFrame = t;
    if (t - lastResize < DRAG_QUIET_MS) {
      win.requestAnimationFrame(frame);
      return;
    }
    looping = false;
    lastFrame = 0;
    // One resize per drag is a finding too: Safari then resized only when the sheet settled.
    if (samples.length) note(summarizeDrag(samples, frames));
    samples = [];
    frames = [];
  };
  const bottomGap = (el: Element | null): number => {
    if (!el || !(el as HTMLElement).offsetParent) return NaN;
    return Math.round(win.innerHeight - el.getBoundingClientRect().bottom);
  };
  win.addEventListener("resize", () => {
    const at = win.performance.now();
    lastResize = at;
    samples.push({
      at,
      height: win.innerHeight,
      view: Math.round(win.visualViewport?.height ?? win.innerHeight),
      page: win.document.documentElement.clientHeight,
      gap: bottomGap(targets.starters()),
      composer: bottomGap(targets.composer()),
    });
    if (!looping) {
      looping = true;
      win.requestAnimationFrame(frame);
    }
  });
}
