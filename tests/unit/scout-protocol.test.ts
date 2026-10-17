// Part 3 task events: every kind survives the port's flat payload and the bridge schema.
import { describe, expect, it } from "vitest";
import { checkSchema, WORKER_EVENTS, REQUESTS } from "../../src/bridge/messages";
import { statusText, taskFromWire, taskToWire, type TaskEvent } from "../../src/scout/protocol";

const EVENTS: TaskEvent[] = [
  { kind: "start", goal: "Fill the form", site: "shop.test" },
  { kind: "state", state: "paused" },
  { kind: "plan", text: "First I will open the form." },
  { kind: "step", index: 3, text: 'Click "Send"', status: "failed", detail: "disabled" },
  { kind: "confirm", request_id: "t1.c4", description: 'click "Place order" to place an order or make a payment', site: "shop.test", sensitive_kind: "purchase" },
  { kind: "confirm_done", request_id: "t1.c4", decision: "always" },
  { kind: "usage", usage: { inputTokens: 10, outputTokens: 5 } },
  { kind: "done", status: "stopped", message: "Stopped." },
];

describe("task events on the wire", () => {
  it("round-trips every kind and passes the schema", () => {
    EVENTS.forEach((event, i) => {
      const wire = taskToWire("t1", { seq: i + 1, event });
      expect(checkSchema(WORKER_EVENTS["task.event"], wire)).toBeNull();
      expect(taskFromWire(wire)).toEqual({ task_id: "t1", seq: i + 1, event });
    });
  });

  it("rejects payloads with missing fields or bad sequence numbers", () => {
    expect(taskFromWire({ task_id: "t1", seq: 1, kind: "step", index: 1 })).toBeNull();
    expect(taskFromWire({ task_id: "t1", seq: 0, kind: "start", goal: "x" })).toBeNull();
    expect(taskFromWire({ task_id: "t1", seq: 1, kind: "done", status: "won", message: "" })).toBeNull();
    expect(taskFromWire({ task_id: "t1", seq: 1, kind: "confirm_done", request_id: "r", decision: "maybe" })).toBeNull();
  });

  it("registers the Part 3 requests with their senders", () => {
    expect(REQUESTS["task.control"].senders).toEqual(["panel", "content"]);
    expect(REQUESTS["task.start"].senders).toEqual(["panel"]);
    expect(checkSchema(REQUESTS["task.decide"].payload, { task_id: "t", request_id: "r", decision: "deny" })).toBeNull();
    expect(checkSchema(REQUESTS["task.decide"].payload, { task_id: "t", request_id: "r", decision: "sure" })).not.toBeNull();
    expect(checkSchema(REQUESTS["task.control"].payload, { command: "stop" })).toBeNull();
  });

  it("words each outcome for the user", () => {
    expect(statusText("done", "All set.")).toBe("All set.");
    expect(statusText("stopped", "")).toContain("Nothing more was done");
    expect(statusText("captcha", "")).toContain("CAPTCHA");
    expect(statusText("blocked", "you blocked shop.test.")).toBe("Stopped: you blocked shop.test.");
  });
});
