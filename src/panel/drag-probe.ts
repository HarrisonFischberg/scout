// Debug builds only: how Safari resizes the iPhone panel while its sheet is
// dragged (owner bug 2026-10-18, still jittery after #45, "particularly
// around the summarize and explain text"). One line per drag goes into
// Diagnostics: how many resize events arrived and how far apart, how long
// the panel's frames took, and how far the starters moved against the bottom
// of the panel. Evenly spaced resizes with quick frames would mean the jitter
// is Safari drawing the panel behind its sheet; slow frames would mean Scout's
// own layout. Sizes and times only.

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
  /** Distance from the starters' bottom edge to the panel's bottom edge, or -1 when hidden. */
  gap: number;
}

/** One Diagnostics line for a finished drag. */
export function summarizeDrag(samples: readonly DragSample[], frames: readonly number[]): string {
  const n = samples.length;
  const first = samples[0];
  const last = samples[n - 1];
  if (!first || !last) return "drag: no resizes";
  const gaps: number[] = [];
  for (let i = 1; i < n; i++) gaps.push(samples[i]!.at - samples[i - 1]!.at);
  const avg = (xs: readonly number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const max = (xs: readonly number[]): number => (xs.length ? Math.max(...xs) : 0);
  const viewLag = max(samples.map((s) => Math.abs(s.height - s.view)));
  const shown = samples.filter((s) => s.gap >= 0).map((s) => s.gap);
  const starters = shown.length ? `starters ${Math.min(...shown)}-${Math.max(...shown)}px from bottom` : "starters hidden";
  return [
    `drag: ${n} resizes over ${Math.round(last.at - first.at)} ms`,
    `height ${first.height}->${last.height}`,
    `resize gap avg ${Math.round(avg(gaps))} max ${Math.round(max(gaps))} ms`,
    `frames ${frames.length} slow ${frames.filter((f) => f > SLOW_FRAME_MS).length} max ${Math.round(max(frames))} ms`,
    `viewport off by up to ${Math.round(viewLag)}px`,
    starters,
  ].join(", ");
}

/** Starts logging drags. `note` receives one line per drag. */
export function probeDrag(win: Window, starters: () => Element | null, note: (line: string) => void): void {
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
  win.addEventListener("resize", () => {
    const at = win.performance.now();
    lastResize = at;
    const el = starters();
    const r = el && (el as HTMLElement).offsetParent ? el.getBoundingClientRect() : null;
    samples.push({
      at,
      height: win.innerHeight,
      view: Math.round(win.visualViewport?.height ?? win.innerHeight),
      gap: r ? Math.round(win.innerHeight - r.bottom) : -1,
    });
    if (!looping) {
      looping = true;
      win.requestAnimationFrame(frame);
    }
  });
}
