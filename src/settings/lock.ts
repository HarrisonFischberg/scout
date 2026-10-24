// One writer at a time for a storage key that several Scout pages read, change
// and write back (the worker and each open panel), so two saves at once never
// erase each other (audit 2026-10-24). Web Locks are shared by every page of
// the extension; where they are missing (tests), writes from this page still
// go one at a time. A holder that never finishes (Safari storage has stalled
// before, owner bug 2026-10-19) lets go after LOCK_MAX_MS so later saves still run.
type Locks = { request<T>(name: string, fn: () => Promise<T>): Promise<T> };

export const LOCK_MAX_MS = 10_000;

const chains = new Map<string, Promise<unknown>>();

export function withLock<T>(name: string, fn: () => Promise<T>, maxMs = LOCK_MAX_MS): Promise<T> {
  const bounded = (): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("storage lock timed out: " + name)), maxMs);
    });
    return Promise.race([fn(), late]).finally(() => clearTimeout(timer));
  };
  const locks = (globalThis as { navigator?: { locks?: Locks } }).navigator?.locks;
  if (locks?.request) return locks.request("scout:" + name, bounded);
  const run = (chains.get(name) ?? Promise.resolve()).then(bounded, bounded);
  chains.set(name, run.catch(() => undefined));
  return run;
}
