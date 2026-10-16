import { describe, expect, it } from "vitest";
import { executeAction, MAX_WAIT_MS, type ActionEl, type ActionPage } from "../../src/actions/executor";

type TestEl = ActionEl & { log: string[]; value: string };

function el(over: Partial<TestEl> = {}): TestEl {
  const log: string[] = [];
  const self: TestEl = {
    tag: "input",
    type: "text",
    disabled: false,
    connected: true,
    value: "",
    log,
    click: () => void log.push("click"),
    setValue(v: string) {
      self.value = v;
      log.push("set:" + v);
    },
    getValue: () => self.value,
    select: (v: string) => v === "Support",
    scrollIntoView: () => void log.push("scroll"),
    ...over,
  };
  return self;
}

function page(els: Record<string, ActionEl>) {
  const calls: string[] = [];
  const p: ActionPage & { calls: string[] } = {
    calls,
    baseUrl: "https://shop.test/a/b",
    resolve: (ref) => els[ref],
    scroll: (d) => void calls.push("scroll:" + d),
    navigate: (u) => void calls.push("nav:" + u),
    sleep: async (ms) => void calls.push("sleep:" + ms),
  };
  return p;
}

describe("executeAction", () => {
  it("clicks an element and reports success", async () => {
    const e = el({ tag: "button" });
    const res = await executeAction(page({ e1: e }), { type: "click", ref: "e1" });
    expect(res).toMatchObject({ ok: true, action: "click", ref: "e1" });
    expect(e.log).toEqual(["scroll", "click"]);
  });

  it("types, replacing by default and appending when clear is false", async () => {
    const e = el({ value: "ab" });
    const p = page({ e1: e });
    await executeAction(p, { type: "type", ref: "e1", text: "xy" });
    expect(e.value).toBe("xy");
    await executeAction(p, { type: "type", ref: "e1", text: "z", clear: false });
    expect(e.value).toBe("xyz");
  });

  it("does not echo typed text in the result message", async () => {
    const res = await executeAction(page({ e1: el() }), { type: "type", ref: "e1", text: "s3cret-value" });
    expect(res.message).not.toContain("s3cret-value");
  });

  it("refuses to type into a checkbox and into a disabled field", async () => {
    const p = page({ e1: el({ type: "checkbox" }), e2: el({ disabled: true }) });
    expect(await executeAction(p, { type: "type", ref: "e1", text: "x" })).toMatchObject({ error: "not_typeable" });
    expect(await executeAction(p, { type: "type", ref: "e2", text: "x" })).toMatchObject({ error: "disabled" });
  });

  it("selects an option and reports an unknown one", async () => {
    const p = page({ e1: el({ tag: "select" }), e2: el({ tag: "input" }) });
    expect(await executeAction(p, { type: "select", ref: "e1", value: "Support" })).toMatchObject({ ok: true });
    expect(await executeAction(p, { type: "select", ref: "e1", value: "Nope" })).toMatchObject({ error: "no_option" });
    expect(await executeAction(p, { type: "select", ref: "e2", value: "x" })).toMatchObject({ error: "not_selectable" });
  });

  it("fails cleanly for a missing or stale ref and never touches the page", async () => {
    const stale = el({ connected: false });
    const p = page({ e1: stale });
    expect(await executeAction(p, { type: "click", ref: "e9" })).toMatchObject({ ok: false, error: "no_ref", ref: "e9" });
    expect(await executeAction(p, { type: "click", ref: "e1" })).toMatchObject({ ok: false, error: "stale_ref" });
    expect(stale.log).toEqual([]);
  });

  it("fails cleanly on bad arguments", async () => {
    const p = page({});
    expect(await executeAction(p, { type: "click" } as never)).toMatchObject({ error: "bad_args" });
    expect(await executeAction(p, { type: "wait", ms: -1 })).toMatchObject({ error: "bad_args" });
    expect(await executeAction(p, { type: "scroll", direction: "left" } as never)).toMatchObject({ error: "bad_args" });
    expect(await executeAction(p, { type: "fly" } as never)).toMatchObject({ error: "unknown_action" });
  });

  it("scrolls the page or an element", async () => {
    const p = page({ e1: el() });
    await executeAction(p, { type: "scroll", direction: "down" });
    expect(p.calls).toEqual(["scroll:down"]);
    expect(await executeAction(p, { type: "scroll", direction: "down", ref: "e1" })).toMatchObject({ ok: true, ref: "e1" });
  });

  it("navigates only to http(s), resolving relative URLs", async () => {
    const p = page({});
    expect(await executeAction(p, { type: "navigate", url: "/cart" })).toMatchObject({ ok: true });
    expect(p.calls).toEqual(["nav:https://shop.test/cart"]);
    for (const url of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,x"]) {
      expect(await executeAction(p, { type: "navigate", url })).toMatchObject({ ok: false, error: "blocked_url" });
    }
    expect(p.calls).toHaveLength(1);
  });

  it("caps wait at the maximum", async () => {
    const p = page({});
    await executeAction(p, { type: "wait", ms: 999_999 });
    expect(p.calls).toEqual(["sleep:" + MAX_WAIT_MS]);
  });

  it("turns a thrown error into a failed result", async () => {
    const boom = el({
      click: () => {
        throw new Error("detached");
      },
    });
    expect(await executeAction(page({ e1: boom }), { type: "click", ref: "e1" })).toMatchObject({
      ok: false,
      error: "failed",
      message: "detached",
    });
  });
});
