// Part 3: Take control (pause) and Stop cut waits short at once.
import { describe, expect, it } from "vitest";
import { AgentControl } from "../../src/agent/control";

describe("AgentControl", () => {
  it("pause ends a sleep early and resume lets the gate through", async () => {
    const c = new AgentControl();
    const t0 = Date.now();
    const sleeping = c.sleep(2000);
    setTimeout(() => c.pause(), 10);
    expect(await sleeping).toBe(false);
    expect(Date.now() - t0).toBeLessThan(250);
    expect(c.isPaused).toBe(true);
    let through = false;
    const gate = c.gate().then(() => (through = true));
    await new Promise((r) => setTimeout(r, 5));
    expect(through).toBe(false);
    c.resume();
    await gate;
    expect(through).toBe(true);
  });

  it("stop aborts the signal, releases the gate, and makes later sleeps return at once", async () => {
    const c = new AgentControl();
    c.pause();
    const gate = c.gate();
    c.stop();
    await gate;
    expect(c.isStopped).toBe(true);
    expect(c.signal.aborted).toBe(true);
    expect(await c.sleep(1000)).toBe(false);
  });

  it("a full sleep resolves true", async () => {
    const c = new AgentControl();
    expect(await c.sleep(5)).toBe(true);
  });
});
