// Shared by the UI (Stop) and the runners (Scout mode tasks, coupon runs).
// Stop ends pending waits (settle delays, wait actions, the click-marker
// lead) at once and aborts an in-flight model request.
export class AgentControl {
  private stopped = false;
  private interruptWaiters: Array<() => void> = [];
  private readonly abort = new AbortController();
  /** Aborted by stop(): cancels an in-flight model request or page call. */
  readonly signal: AbortSignal = this.abort.signal;

  stop(): void {
    this.stopped = true;
    this.abort.abort();
    const w = this.interruptWaiters;
    this.interruptWaiters = [];
    for (const r of w) r();
  }
  get isStopped(): boolean {
    return this.stopped;
  }
  /**
   * Sleeps for `ms`, or until stopped, whichever comes first.
   * Resolves true when the full time passed.
   */
  sleep(ms: number, setTimer: (fn: () => void, ms: number) => unknown = (f, t) => setTimeout(f, t), clearTimer: (h: unknown) => void = (h) => clearTimeout(h as ReturnType<typeof setTimeout>)): Promise<boolean> {
    if (this.stopped) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      let handle: unknown;
      const onInterrupt = (): void => {
        clearTimer(handle);
        resolve(false);
      };
      this.interruptWaiters.push(onInterrupt);
      handle = setTimer(() => {
        this.interruptWaiters = this.interruptWaiters.filter((w) => w !== onInterrupt);
        resolve(true);
      }, ms);
    });
  }
}
