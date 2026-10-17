// Part 3 action vocabulary (spec 8.2, 8.3): allow-list, argument checks, coordinate scaling.
import { describe, expect, it } from "vitest";
import { MAX_BATCH, parseAction, parseBatch, parseTarget, scalePoint, SCOUT_ACTIONS, targetsOf } from "../../src/scout/actions";

describe("parseAction", () => {
  it("accepts every allow-listed type with valid arguments", () => {
    const ok = [
      { type: "click", target: "e1" },
      { type: "double_click", target: { ref: "e2" } },
      { type: "right_click", target: { x: 10, y: 20 } },
      { type: "type", target: "e3", text: "hello" },
      { type: "key", key: "Enter" },
      { type: "scroll", direction: "down" },
      { type: "scroll_to_element", target: "e4" },
      { type: "drag", from: "e5", to: { x: 1, y: 2 } },
      { type: "fill_field", target: "e6", value: "UK" },
      { type: "wait", ms: 500 },
      { type: "screenshot" },
    ];
    for (const raw of ok) {
      const r = parseAction(raw);
      expect(r.ok, JSON.stringify(raw)).toBe(true);
      if (r.ok) expect(r.action.type).toBe(raw.type);
    }
    expect(SCOUT_ACTIONS).toHaveLength(11);
  });

  it("rejects anything outside the allow-list", () => {
    for (const type of ["navigate", "eval", "select", "frobnicate", "", "click; drop table"]) {
      const r = parseAction({ type, target: "e1" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe("unknown_action");
    }
    expect(parseAction("click").ok).toBe(false);
    expect(parseAction(null).ok).toBe(false);
  });

  it("refuses missing targets and bad arguments instead of guessing", () => {
    const noTarget = parseAction({ type: "click" });
    expect(noTarget.ok).toBe(false);
    if (!noTarget.ok) expect(noTarget.error).toBe("bad_target");
    expect(parseAction({ type: "type", target: "e1" }).ok).toBe(false);
    expect(parseAction({ type: "key", key: "" }).ok).toBe(false);
    expect(parseAction({ type: "scroll", direction: "sideways" }).ok).toBe(false);
    expect(parseAction({ type: "wait", ms: -1 }).ok).toBe(false);
    expect(parseAction({ type: "drag", from: "e1" }).ok).toBe(false);
    expect(parseAction({ type: "click", target: { ref: "javascript:alert(1)" } }).ok).toBe(false);
  });

  it("caps waits and text length", () => {
    const w = parseAction({ type: "wait", ms: 99_999 });
    expect(w.ok && w.action.type === "wait" && w.action.ms).toBe(10_000);
    const t = parseAction({ type: "type", target: "e1", text: "x".repeat(10_000) });
    expect(t.ok && t.action.type === "type" && t.action.text.length).toBe(4000);
  });

  it("ignores fields it does not know, such as a server's approval flag", () => {
    const r = parseAction({ type: "click", target: "e1", approved: true, pre_approved: "yes" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.action).toEqual({ type: "click", target: { ref: "e1" } });
  });
});

describe("parseTarget", () => {
  it("prefers refs and keeps points as a fallback", () => {
    expect(parseTarget("e12")).toEqual({ ref: "e12" });
    expect(parseTarget({ ref: "e1", x: 5, y: 6 })).toEqual({ ref: "e1", x: 5, y: 6 });
    expect(parseTarget({ x: 5, y: 6 })).toEqual({ x: 5, y: 6 });
    expect(parseTarget({ x: -1, y: 6 })).toBeNull();
    expect(parseTarget({})).toBeNull();
    expect(parseTarget("button")).toBeNull();
  });
});

describe("parseBatch", () => {
  it("keeps order and drops items past the cap", () => {
    const raw = Array.from({ length: MAX_BATCH + 3 }, (_, i) => ({ type: i === 1 ? "bogus" : "wait", ms: i }));
    const { items, dropped } = parseBatch(raw);
    expect(items).toHaveLength(MAX_BATCH);
    expect(dropped).toBe(3);
    expect(items[0]!.ok).toBe(true);
    expect(items[1]!.ok).toBe(false);
    expect(parseBatch("nope")).toEqual({ items: [], dropped: 0 });
  });
});

describe("scalePoint", () => {
  it("maps screenshot pixels to the viewport and clamps to its edges", () => {
    expect(scalePoint({ x: 784, y: 500 }, { width: 1568, height: 1000 }, { width: 784, height: 500 })).toEqual({ x: 392, y: 250 });
    expect(scalePoint({ x: 5000, y: -3 }, { width: 100, height: 100 }, { width: 100, height: 100 })).toEqual({ x: 100, y: 0 });
    expect(scalePoint({ x: 10, y: 10 }, { width: 0, height: 0 }, { width: 50, height: 50 })).toEqual({ x: 10, y: 10 });
  });
});

describe("targetsOf", () => {
  it("lists every target an action names", () => {
    expect(targetsOf({ type: "drag", from: { ref: "e1" }, to: { x: 1, y: 1 } })).toHaveLength(2);
    expect(targetsOf({ type: "wait", ms: 1 })).toEqual([]);
    expect(targetsOf({ type: "key", key: "Tab" })).toEqual([]);
  });
});
