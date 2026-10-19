// The page's overlay holds a port to the worker while a run glows, so Safari
// does not unload the worker (and lose the run) with the panel closed; the
// glow goes when the worker no longer has the run (owner report 2026-10-19,
// macOS: clicking away from the panel left the glow and the run could not be
// reopened). Fake ports, no browser.
import { describe, expect, it } from "vitest";
import { HEARTBEAT_MS, RUN_PORT, holdRun, serveRunPort } from "../../src/bridge/run-port";
import type { PortLike } from "../../src/bridge/port";

type Fn = (m?: unknown) => void;

/** A connected pair of ports; `worker` answers with `alive`. */
function fakeWorker(alive: (taskId: string, tabId: number) => boolean) {
  const opened: string[] = [];
  const pages: Array<{ disconnected: boolean; drop(): void }> = [];
  const connect = ({ name }: { name: string }): PortLike => {
    opened.push(name);
    const pageMsg: Fn[] = [];
    const pageDisc: Fn[] = [];
    const workerMsg: Fn[] = [];
    const state = { disconnected: false, drop: () => pageDisc.forEach((f) => f()) };
    pages.push(state);
    const workerEnd = {
      postMessage: (m: unknown) => pageMsg.forEach((f) => f(m)),
      onMessage: { addListener: (f: Fn) => workerMsg.push(f) },
    };
    serveRunPort(workerEnd, 7, alive);
    return {
      postMessage: (m: unknown) => {
        if (state.disconnected) throw new Error("disconnected");
        workerMsg.forEach((f) => f(m));
      },
      disconnect: () => void (state.disconnected = true),
      onMessage: { addListener: (f: Fn) => pageMsg.push(f) },
      onDisconnect: { addListener: (f: Fn) => pageDisc.push(f) },
    };
  };
  return { connect, opened, pages };
}

function fakeTimer() {
  let fn: (() => void) | null = null;
  let ms = 0;
  return {
    opts: { setTimer: (f: () => void, t: number) => ((fn = f), (ms = t), 1), clearTimer: () => void (fn = null) },
    tick: () => fn?.(),
    get ms() {
      return ms;
    },
    get running() {
      return fn !== null;
    },
  };
}

describe("run port", () => {
  it("holds a port while the run goes on and beats on it", () => {
    const seen: string[] = [];
    const w = fakeWorker((id, tab) => (seen.push(id + "@" + tab), true));
    const t = fakeTimer();
    let gone = 0;
    const release = holdRun(w.connect, "coupons:7", () => gone++, t.opts);
    expect(w.opened).toEqual([RUN_PORT]);
    expect(t.ms).toBe(HEARTBEAT_MS);
    t.tick();
    t.tick();
    expect(seen).toEqual(["coupons:7@7", "coupons:7@7", "coupons:7@7"]);
    expect(gone).toBe(0);
    release();
    expect(w.pages[0]!.disconnected).toBe(true);
    expect(t.running).toBe(false);
  });

  it("lets the glow go when the worker no longer has the run", () => {
    let alive = true;
    const w = fakeWorker(() => alive);
    const t = fakeTimer();
    let gone = 0;
    holdRun(w.connect, "coupons:7", () => gone++, t.opts);
    alive = false;
    t.tick();
    expect(gone).toBe(1);
    expect(t.running).toBe(false);
    expect(w.pages[0]!.disconnected).toBe(true);
  });

  it("connects again after Safari unloads the worker, and the new worker says the run is gone", () => {
    let alive = true;
    const w = fakeWorker(() => alive);
    const t = fakeTimer();
    let gone = 0;
    holdRun(w.connect, "task-1", () => gone++, t.opts);
    // The worker page unloads: its port drops and the run goes with it.
    w.pages[0]!.drop();
    alive = false;
    t.tick();
    expect(w.opened).toHaveLength(2);
    expect(gone).toBe(1);
  });

  it("does nothing without runtime.connect", () => {
    expect(() => holdRun(undefined, "coupons:7", () => undefined)()).not.toThrow();
  });
});
