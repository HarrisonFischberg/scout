// Part 3: Stop cuts waits short at once.
import { describe, expect, it } from "vitest";
import { AgentControl } from "../../src/agent/control";

describe("AgentControl", () => {
  it("stop ends a sleep early, aborts the signal, and makes later sleeps return at once", async () => {
    const c = new AgentControl();
    const t0 = Date.now();
    const sleeping = c.sleep(2000);
    setTimeout(() => c.stop(), 10);
    expect(await sleeping).toBe(false);
    expect(Date.now() - t0).toBeLessThan(250);
    expect(c.isStopped).toBe(true);
    expect(c.signal.aborted).toBe(true);
    expect(await c.sleep(1000)).toBe(false);
  });

  it("a full sleep resolves true", async () => {
    const c = new AgentControl();
    expect(await c.sleep(5)).toBe(true);
  });
});
