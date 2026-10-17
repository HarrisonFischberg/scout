// Part 3 (spec 8.2, 8.3): the action allow-list, argument checks, the
// pre-approved flag, coordinate scaling, and plain-language descriptions.
import { describe, expect, it } from "vitest";
import { performTaskAction, type ProbeResult, type TaskPage } from "../../src/actions/task";
import { ACTION_TYPES, describeAction, parseBatch, parseTaskAction, scaleToViewport, targetOf } from "../../src/actions/vocabulary";

describe("action vocabulary", () => {
  it("lists exactly the eleven allowed actions", () => {
    expect([...ACTION_TYPES]).toEqual(["click", "double_click", "right_click", "type", "key", "scroll", "scroll_to_element", "drag", "fill_field", "wait", "screenshot"]);
  });

  it("rejects unknown actions and malformed ones", () => {
    expect(parseTaskAction({ type: "navigate", url: "https://x.test" })).toMatchObject({ ok: false, reason: "unknown_action", type: "navigate" });
    expect(parseTaskAction({ type: "run_shell", cmd: "rm" })).toMatchObject({ ok: false, reason: "unknown_action" });
    expect(parseTaskAction("click")).toMatchObject({ ok: false, reason: "unknown_action" });
    expect(parseTaskAction(null)).toMatchObject({ ok: false, reason: "unknown_action" });
    expect(parseTaskAction({ type: "click" })).toMatchObject({ ok: false, reason: "bad_args", type: "click" });
    expect(parseTaskAction({ type: "click", target: { ref: "button-1" } })).toMatchObject({ ok: false, reason: "bad_args" });
    expect(parseTaskAction({ type: "type" })).toMatchObject({ ok: false, reason: "bad_args" });
    expect(parseTaskAction({ type: "key", key: "F13", modifiers: [] })).toMatchObject({ ok: false, reason: "bad_args" });
    expect(parseTaskAction({ type: "key", key: "a", modifiers: ["hyper"] })).toMatchObject({ ok: false, reason: "bad_args" });
    expect(parseTaskAction({ type: "scroll", direction: "sideways" })).toMatchObject({ ok: false, reason: "bad_args" });
    expect(parseTaskAction({ type: "drag", from: { ref: "e1" } })).toMatchObject({ ok: false, reason: "bad_args" });
    expect(parseTaskAction({ type: "fill_field", target: { ref: "e1" } })).toMatchObject({ ok: false, reason: "bad_args" });
    expect(parseTaskAction({ type: "wait", ms: -1 })).toMatchObject({ ok: false, reason: "bad_args" });
  });

  it("accepts every allowed action with refs or coordinates, capping waits and text", () => {
    expect(parseTaskAction({ type: "click", target: { ref: "e12" } })).toEqual({ ok: true, preapproved: false, action: { type: "click", target: { ref: "e12" } } });
    expect(parseTaskAction({ type: "right_click", target: { x: 10.5, y: 20 } })).toMatchObject({ ok: true, action: { type: "right_click", target: { x: 10.5, y: 20 } } });
    expect(parseTaskAction({ type: "type", text: "hi" })).toMatchObject({ ok: true, action: { type: "type", text: "hi" } });
    expect(parseTaskAction({ type: "key", key: "Space", modifiers: ["shift"] })).toMatchObject({ ok: true, action: { type: "key", key: " ", modifiers: ["shift"] } });
    expect(parseTaskAction({ type: "key", key: "Enter" })).toMatchObject({ ok: true, action: { type: "key", key: "Enter", modifiers: [] } });
    expect(parseTaskAction({ type: "scroll", direction: "down", amount: 300 })).toMatchObject({ ok: true, action: { type: "scroll", direction: "down", amount: 300 } });
    expect(parseTaskAction({ type: "scroll_to_element", target: { ref: "e3" } })).toMatchObject({ ok: true });
    expect(parseTaskAction({ type: "drag", from: { ref: "e1" }, to: { x: 5, y: 5 } })).toMatchObject({ ok: true });
    expect(parseTaskAction({ type: "fill_field", target: { ref: "e1" }, value: "" })).toMatchObject({ ok: true, action: { type: "fill_field", value: "" } });
    expect(parseTaskAction({ type: "wait", ms: 99_999 })).toMatchObject({ ok: true, action: { type: "wait", ms: 10_000 } });
    expect(parseTaskAction({ type: "screenshot" })).toMatchObject({ ok: true, action: { type: "screenshot" } });
    const long = parseTaskAction({ type: "type", text: "x".repeat(9000) });
    expect(long.ok && long.action.type === "type" ? long.action.text.length : 0).toBe(5000);
  });

  it("notes a server pre-approval but never lets it into the action", () => {
    const p = parseTaskAction({ type: "click", target: { ref: "e1" }, approved: true });
    expect(p).toMatchObject({ ok: true, preapproved: true });
    expect(Object.keys(p.ok ? p.action : {})).toEqual(["type", "target"]);
    expect(parseTaskAction({ type: "click", target: { ref: "e1" }, pre_approved: true })).toMatchObject({ preapproved: true });
  });

  it("parses a batch up to five actions and stops at the first rejected one", () => {
    const batch = parseBatch([{ type: "click", target: { ref: "e1" } }, { type: "hack" }, { type: "click", target: { ref: "e2" } }]);
    expect(batch).toHaveLength(2);
    expect(batch[1]).toMatchObject({ ok: false, reason: "unknown_action" });
    expect(parseBatch(Array.from({ length: 9 }, () => ({ type: "screenshot" })))).toHaveLength(5);
    expect(parseBatch("nope")).toEqual([]);
  });

  it("scales screenshot coordinates to the viewport and clamps them", () => {
    expect(scaleToViewport({ x: 200, y: 100 }, { width: 800, height: 600 }, { width: 400, height: 300 })).toEqual({ x: 100, y: 50 });
    expect(scaleToViewport({ x: 5000, y: 5 }, { width: 800, height: 600 }, { width: 400, height: 300 })).toEqual({ x: 399, y: 3 });
    expect(scaleToViewport({ x: 7, y: 9 }, null, { width: 400, height: 300 })).toEqual({ x: 7, y: 9 });
  });

  it("describes actions in plain language", () => {
    expect(describeAction({ type: "click", target: { ref: "e1" } }, "Place order")).toBe("click “Place order”");
    expect(describeAction({ type: "type", text: "hello", target: { ref: "e1" } }, "Search")).toBe("type 5 characters into “Search”");
    expect(describeAction({ type: "key", key: "Enter", modifiers: ["shift"] })).toBe("press Shift-Enter");
    expect(describeAction({ type: "scroll", direction: "bottom" })).toBe("scroll to the bottom");
    expect(describeAction({ type: "wait", ms: 1500 })).toBe("wait 1.5 s");
    expect(describeAction({ type: "fill_field", target: { x: 1, y: 1 }, value: "ab" })).toBe("fill a field with 2 characters");
    expect(targetOf({ type: "drag", from: { ref: "e1" }, to: { ref: "e2" } })).toEqual({ ref: "e1" });
    expect(targetOf({ type: "wait", ms: 1 })).toBeUndefined();
  });
});

// The executor over a fake page: results, disabled and missing targets.
describe("task executor", () => {
  function fakePage(els: Record<string, Partial<ProbeResult>>): TaskPage & { calls: string[] } {
    const calls: string[] = [];
    const probe = (t: Parameters<TaskPage["probe"]>[0]): ProbeResult | null => {
      const key = t === "focused" ? "focused" : "ref" in t ? t.ref : t.x + "," + t.y;
      const e = els[key];
      return e ? { x: 1, y: 1, name: "", role: "button", tag: "button", ...e } : null;
    };
    return {
      calls,
      probe,
      click: (t, kind) => (calls.push(kind + ":" + ("ref" in t ? t.ref : "xy")), true),
      type: (t, text) => (calls.push("type:" + text), !!probe(t ?? "focused")?.name.match(/field/)),
      fill: (t, v) => (calls.push("fill:" + v), !!probe(t)?.name.match(/field/)),
      key: (_t, k) => (calls.push("key:" + k), true),
      scroll: (d) => (calls.push("scroll:" + d), true),
      scrollTo: () => (calls.push("scrollTo"), true),
      drag: () => (calls.push("drag"), true),
    };
  }

  it("performs each action and reports missing, disabled, or non-text targets", () => {
    const page = fakePage({ e1: { name: "Apply" }, e2: { name: "Name field", tag: "input" }, e3: { name: "Off", disabled: true }, "5,6": { name: "Logo" }, focused: { name: "Search field" } });
    expect(performTaskAction(page, { type: "click", target: { ref: "e1" } })).toMatchObject({ ok: true, action: "click" });
    expect(performTaskAction(page, { type: "double_click", target: { x: 5, y: 6 } })).toMatchObject({ ok: true });
    expect(performTaskAction(page, { type: "click", target: { ref: "e9" } })).toMatchObject({ ok: false, error: "no_target" });
    expect(performTaskAction(page, { type: "click", target: { ref: "e3" } })).toMatchObject({ ok: false, error: "disabled" });
    expect(performTaskAction(page, { type: "type", text: "Ada", target: { ref: "e2" } })).toMatchObject({ ok: true });
    expect(performTaskAction(page, { type: "type", text: "Ada" })).toMatchObject({ ok: true });
    expect(performTaskAction(page, { type: "type", text: "Ada", target: { ref: "e1" } })).toMatchObject({ ok: false, error: "not_typeable" });
    expect(performTaskAction(page, { type: "fill_field", target: { ref: "e2" }, value: "x" })).toMatchObject({ ok: true });
    expect(performTaskAction(page, { type: "key", key: "Enter", modifiers: [] })).toMatchObject({ ok: true });
    expect(performTaskAction(page, { type: "scroll", direction: "down" })).toMatchObject({ ok: true });
    expect(performTaskAction(page, { type: "scroll_to_element", target: { ref: "e1" } })).toMatchObject({ ok: true });
    expect(performTaskAction(page, { type: "drag", from: { ref: "e1" }, to: { ref: "e2" } })).toMatchObject({ ok: true });
    expect(performTaskAction(page, { type: "screenshot" })).toMatchObject({ ok: true });
    expect(page.calls).toEqual(["click:e1", "double_click:xy", "type:Ada", "type:Ada", "type:Ada", "fill:x", "key:Enter", "scroll:down", "scrollTo", "drag"]);
  });

  it("turns a page exception into a failed result, never a throw", () => {
    const page = fakePage({ e1: { name: "Boom" } });
    page.click = () => {
      throw new Error("page exploded");
    };
    expect(performTaskAction(page, { type: "click", target: { ref: "e1" } })).toMatchObject({ ok: false, error: "failed", message: "page exploded" });
  });
});
