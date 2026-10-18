import { afterEach, describe, expect, it, vi } from "vitest";
import { BLUR_PROBE_MAX, probeBlur } from "../../src/panel/blur-probe";

// Debug-only probe for the owner's report (2026-10-18): on a first open closed
// without a tap the page blur lingers. It must say what happened, in order.
describe("blur probe (debug builds)", () => {
  const ID = "__safari-scout-blur";
  let listener: ((m: unknown) => void) | null = null;
  let observer: (() => void) | null = null;
  let layer = false;
  const handlers = new Map<string, () => void>();
  const setup = (): void => {
    listener = null;
    observer = null;
    layer = true;
    handlers.clear();
    const target = (prefix: string) => ({ addEventListener: (t: string, f: () => void) => handlers.set(prefix + t, f) });
    vi.stubGlobal("browser", { runtime: { onMessage: { addListener: (f: (m: unknown) => void) => (listener = f) } } });
    vi.stubGlobal("window", { ...target("w:"), visualViewport: undefined });
    vi.stubGlobal("innerWidth", 390);
    vi.stubGlobal("innerHeight", 664);
    vi.stubGlobal("document", { ...target("d:"), visibilityState: "visible", documentElement: {}, getElementById: () => (layer ? {} : null) });
    vi.stubGlobal(
      "MutationObserver",
      class {
        constructor(f: () => void) {
          observer = f;
        }
        observe() {}
      },
    );
    delete (globalThis as { __scoutBlurProbe?: unknown }).__scoutBlurProbe;
  };
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("logs panel notes, ping gaps, the goodbye and the layer going, then hands the log to the next open", () => {
    vi.useFakeTimers();
    setup();
    expect(probeBlur(ID, BLUR_PROBE_MAX)).toEqual([]);
    listener?.({ blurProbe: ID, note: "open, focus no" });
    listener?.({ blur: ID, alive: true });
    vi.advanceTimersByTime(33);
    listener?.({ blur: ID, alive: true });
    vi.advanceTimersByTime(400);
    listener?.({ blur: ID, alive: true });
    handlers.get("w:blur")?.();
    listener?.({ blur: ID, alive: false });
    layer = false;
    observer?.();
    listener?.({ blur: "other", alive: false });
    const log = probeBlur(ID, BLUR_PROBE_MAX).map((l) => l.replace(/^\d+ms /, ""));
    expect(log).toEqual([
      "probe start",
      "panel open, focus no",
      "first ping",
      "ping after a 400ms gap",
      "page blur",
      "goodbye",
      "layer removed, 0ms after the last ping",
    ]);
  });

  it("keeps the log short", () => {
    setup();
    probeBlur(ID, 3);
    for (let i = 0; i < 10; i++) listener?.({ blurProbe: ID, note: "x" });
    expect(probeBlur(ID, 3)).toHaveLength(3);
  });
});
