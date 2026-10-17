// Run control shared by the coupon finder (src/coupons/finder.ts) and the
// popup: Pause, Resume and Stop, with an abort signal for in-flight work.
// The popup-side agent loop that lived here (T010) was replaced in Part 3 by
// Scout mode, which runs in the background worker (src/scout/runner.ts).
import type { Action, ActionResult } from "../actions/executor";
import type { Snapshot } from "../snapshot/snapshot";

export interface AgentPage {
  /** `limits` asks for more of a long page than the default caps (coupon runs). */
  snapshot(limits?: { maxElements?: number; maxTextChars?: number }): Promise<Snapshot>;
  act(action: Action): Promise<ActionResult>;
}

/** Shared by the UI (Pause/Resume/Stop buttons) and a run. */
export class AgentControl {
  private paused = false;
  private stopped = false;
  private waiters: Array<() => void> = [];
  private readonly abort = new AbortController();
  /** Aborted by stop(): cancels an in-flight model request or page call. */
  readonly signal: AbortSignal = this.abort.signal;

  pause(): void {
    this.paused = true;
  }
  resume(): void {
    this.paused = false;
    this.flush();
  }
  stop(): void {
    this.stopped = true;
    this.abort.abort();
    this.flush();
  }
  get isStopped(): boolean {
    return this.stopped;
  }
  get isPaused(): boolean {
    return this.paused;
  }
  /** Resolves when not paused or when stopped. */
  async gate(): Promise<void> {
    while (this.paused && !this.stopped) {
      await new Promise<void>((r) => this.waiters.push(r));
    }
  }
  private flush(): void {
    const w = this.waiters;
    this.waiters = [];
    for (const r of w) r();
  }
}
