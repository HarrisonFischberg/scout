// Keeps the background worker awake while a run glows on the page.
// Safari unloads the non-persistent background page once nothing talks to it
// for a while. With the panel closed (on a Mac, clicking the page or another
// tab closes it), a Find coupons run waiting on a long web search has nobody
// talking to the worker, so Safari could unload it: the run was lost with it,
// the page kept glowing, and a reopened panel had nothing to show (owner
// report 2026-10-19). The page's overlay now holds a port to the worker for as
// long as it shows, with a heartbeat on it, and goes away by itself if the
// worker no longer has the run.
import type { Connect, PortLike } from "./port";

export const RUN_PORT = "scout-run";
export const HEARTBEAT_MS = 10_000;

export interface HoldRunOptions {
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/**
 * Content side: while a run's overlay shows. `onGone` runs when the worker
 * says it has no such run (it ended, or Safari unloaded the worker and lost it).
 * Returns a function that lets go.
 */
export function holdRun(connect: Connect | undefined, taskId: string, onGone: () => void, opts: HoldRunOptions = {}): () => void {
  if (!connect) return () => undefined;
  const setTimer = opts.setTimer ?? ((fn, ms) => setInterval(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));
  let port: PortLike | null = null;
  let done = false;
  let timer: unknown = null;
  const release = (): void => {
    if (done) return;
    done = true;
    clearTimer(timer);
    try {
      port?.disconnect();
    } catch {
      // already gone
    }
    port = null;
  };
  const open = (): PortLike | null => {
    try {
      const p = connect({ name: RUN_PORT });
      p.onMessage.addListener((m) => {
        const r = m as { task_id?: unknown; running?: unknown } | null;
        if (!done && r && r.task_id === taskId && r.running === false) {
          release();
          onGone();
        }
      });
      // The worker went away: the next beat connects again, which wakes a
      // worker that can say whether it still has the run.
      p.onDisconnect.addListener(() => {
        if (port === p) port = null;
      });
      return p;
    } catch {
      return null;
    }
  };
  const beat = (): void => {
    if (done) return;
    port ??= open();
    try {
      port?.postMessage({ task_id: taskId });
    } catch {
      port = null;
    }
  };
  timer = setTimer(beat, HEARTBEAT_MS);
  beat();
  return release;
}

/** Worker side: answers each heartbeat with whether the run is still going on the sender's tab. */
export function serveRunPort(port: Pick<PortLike, "postMessage" | "onMessage">, tabId: number, alive: (taskId: string, tabId: number) => boolean): void {
  port.onMessage.addListener((m) => {
    const taskId = (m as { task_id?: unknown } | null)?.task_id;
    if (typeof taskId !== "string") return;
    try {
      port.postMessage({ task_id: taskId, running: alive(taskId, tabId) });
    } catch {
      // the page went away
    }
  });
}
