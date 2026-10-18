// The pace at which a streamed answer is revealed in the chat. Providers send
// text in bursts; showing it at a steady typing pace reads calmer than the
// bursts themselves (owner, 2026-10-18: "slow and steady and nice").

/** Characters per second while the reveal is close behind the stream. */
export const TYPING_CPS = 50;
/** The reveal speeds up so it is never more than about this far behind. */
export const MAX_LAG_MS = 3000;
/** A longer gap between frames (a hidden or throttled panel) catches up at once. */
const MAX_FRAME_MS = 1000;

/**
 * How many characters to show next, given how many are shown, how many have
 * arrived, and the time since the last frame. Returns a fractional count;
 * callers keep the fraction and show the whole part.
 */
export function nextShown(shown: number, target: number, dtMs: number): number {
  if (shown >= target) return target;
  if (dtMs >= MAX_FRAME_MS) return target;
  const backlog = target - shown;
  const cps = Math.max(TYPING_CPS, (backlog * 1000) / MAX_LAG_MS);
  return Math.min(target, shown + (cps * Math.max(0, dtMs)) / 1000);
}

/** The whole-character cut for `n`, never splitting a surrogate pair. */
export function cutAt(text: string, n: number): number {
  let i = Math.min(text.length, Math.floor(n));
  if (i > 0 && i < text.length) {
    const c = text.charCodeAt(i - 1);
    if (c >= 0xd800 && c <= 0xdbff) i++;
  }
  return i;
}
