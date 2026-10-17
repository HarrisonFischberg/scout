// Shared by the UI (Take control / Resume / Stop) and the runners (Scout mode
// tasks, coupon runs). Pause takes effect before the next action; pending
// waits (settle delays, wait actions, the click-marker lead) end at once, so
// Take control stops actions within a few milliseconds, well under the 250 ms
// the spec allows. Stop also aborts an in-flight model request.
export class AgentControl {
  private paused = false;
  private stopped = false;
  private waiters: Array<() => void> = [];
  private interruptWaiters: Array<() => void> = [];
  private readonly abort = new AbortController();
  /** Aborted by stop(): cancels an in-flight model request or page call. */
  readonly signal: AbortSignal = this.abort.signal;

  pause(): void {
    if (this.paused || this.stopped) return;
    this.paused = true;
    this.flushInterrupts();
  }
  resume(): void {
    this.paused = false;
    this.flush();
  }
  stop(): void {
    this.stopped = true;
    this.abort.abort();
    this.flush();
    this.flushInterrupts();
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
  /** Resolves on the next pause or stop. Used to cut a wait short. */
  interrupted(): Promise<void> {
    if (this.paused || this.stopped) return Promise.resolve();
    return new Promise<void>((r) => this.interruptWaiters.push(r));
  }
  /**
   * Sleeps for `ms`, or until paused or stopped, whichever comes first.
   * Resolves true when the full time passed.
   */
  sleep(ms: number, setTimer: (fn: () => void, ms: number) => unknown = (f, t) => setTimeout(f, t), clearTimer: (h: unknown) => void = (h) => clearTimeout(h as ReturnType<typeof setTimeout>)): Promise<boolean> {
    if (this.paused || this.stopped) return Promise.resolve(false);
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
  private flush(): void {
    const w = this.waiters;
    this.waiters = [];
    for (const r of w) r();
  }
  private flushInterrupts(): void {
    const w = this.interruptWaiters;
    this.interruptWaiters = [];
    for (const r of w) r();
  }
}
