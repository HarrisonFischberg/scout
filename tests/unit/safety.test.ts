import { describe, expect, it } from "vitest";
import { classifyAction, classifyTaskAction, detectCaptcha } from "../../src/safety/classifier";
import type { SnapElement, Snapshot } from "../../src/snapshot/snapshot";

function snapOf(elements: SnapElement[], text = "A shop page.", title = "Shop"): Snapshot {
  return { url: "https://shop.test/", title, text, elements, truncated: false };
}

const el = (ref: string, role: string, name: string, extra: Partial<SnapElement> = {}): SnapElement => ({
  ref,
  tag: role === "link" ? "a" : "button",
  role,
  name,
  ...extra,
});

describe("classifier", () => {
  const snap = snapOf([
    el("e1", "button", "Place order"),
    el("e2", "button", "Sign in"),
    el("e3", "button", "Send message"),
    el("e4", "button", "Delete account"),
    el("e5", "button", "Apply coupon"),
    el("e6", "textbox", "Password", { tag: "input", type: "password", redacted: true, value: "[REDACTED]" }),
    el("e7", "textbox", "Name", { tag: "input", type: "text" }),
    el("e8", "button", "Save", { tag: "input", type: "submit" }),
    el("e9", "link", "Annual report", { href: "https://x.test/report.pdf" }),
  ]);

  it.each([
    ["e1", "payment"],
    ["e2", "login"],
    ["e3", "send"],
    ["e4", "destructive"],
    ["e8", "personal_data"],
    ["e9", "download"],
  ])("click %s needs approval (%s)", (ref, kind) => {
    const c = classifyAction({ type: "click", ref }, snap);
    expect(c.sensitive).toBe(true);
    expect(c.kind).toBe(kind);
    expect(c.reason).toBeTruthy();
  });

  it("typing into a redacted field needs approval", () => {
    expect(classifyAction({ type: "type", ref: "e6", text: "x" }, snap).sensitive).toBe(true);
  });

  it("ordinary actions do not need approval", () => {
    expect(classifyAction({ type: "click", ref: "e5" }, snap).sensitive).toBe(false);
    expect(classifyAction({ type: "type", ref: "e7", text: "Ada" }, snap).sensitive).toBe(false);
    expect(classifyAction({ type: "scroll", direction: "down" }, snap).sensitive).toBe(false);
    expect(classifyAction({ type: "click", ref: "e99" }, snap).sensitive).toBe(false);
  });

  it("detects CAPTCHAs from text, title, and element names", () => {
    expect(detectCaptcha(snapOf([], "Please verify you are human"))).toBe(true);
    expect(detectCaptcha(snapOf([], "x", "reCAPTCHA check"))).toBe(true);
    expect(detectCaptcha(snapOf([el("e1", "checkbox", "I'm not a robot")]))).toBe(true);
    expect(detectCaptcha(snapOf([el("e1", "button", "Apply coupon")]))).toBe(false);
  });
});

// Part 3 (spec 8.4): Scout mode actions are classified from the action type
// and what the page reports about the target, on the device.
describe("task action classifier", () => {
  const order = { name: "Place order", role: "button", tag: "button" };
  const field = { name: "Search", role: "textbox", tag: "input", type: "search", inForm: true };

  it("confirms clicks on order, sign-in, send, delete, account, and download controls", () => {
    expect(classifyTaskAction({ type: "click", target: { ref: "e1" } }, order)).toMatchObject({ sensitive: true, kind: "payment" });
    expect(classifyTaskAction({ type: "double_click", target: { x: 1, y: 2 } }, { name: "Sign in", role: "button" })).toMatchObject({ sensitive: true, kind: "login" });
    expect(classifyTaskAction({ type: "click", target: { ref: "e1" } }, { name: "Send", role: "button" })).toMatchObject({ sensitive: true, kind: "send" });
    expect(classifyTaskAction({ type: "click", target: { ref: "e1" } }, { name: "Delete", role: "button" })).toMatchObject({ sensitive: true, kind: "destructive" });
    expect(classifyTaskAction({ type: "click", target: { ref: "e1" } }, { name: "Save settings", role: "button" })).toMatchObject({ sensitive: true, kind: "account" });
    expect(classifyTaskAction({ type: "click", target: { ref: "e1" } }, { name: "Get the app", role: "link", href: "https://x.test/app.dmg" })).toMatchObject({ sensitive: true, kind: "download" });
    expect(classifyTaskAction({ type: "click", target: { ref: "e1" } }, { name: "Go", role: "button", type: "submit" })).toMatchObject({ sensitive: true, kind: "personal_data" });
  });

  it("confirms typing into secret fields and Enter inside a form, nothing else", () => {
    expect(classifyTaskAction({ type: "fill_field", target: { ref: "e2" }, value: "x" }, { name: "Card number", redacted: true })).toMatchObject({ sensitive: true, kind: "login" });
    expect(classifyTaskAction({ type: "type", text: "x" }, { name: "Password", redacted: true })).toMatchObject({ sensitive: true });
    expect(classifyTaskAction({ type: "type", text: "x" }, field).sensitive).toBe(false);
    expect(classifyTaskAction({ type: "key", key: "Enter", modifiers: [] }, field)).toMatchObject({ sensitive: true, kind: "personal_data" });
    expect(classifyTaskAction({ type: "key", key: "Enter", modifiers: [] }, { name: "Notes", tag: "textarea", inForm: true }).sensitive).toBe(false);
    expect(classifyTaskAction({ type: "key", key: "Tab", modifiers: [] }, field).sensitive).toBe(false);
  });

  it("never confirms scrolling, waiting, screenshots, dragging, right-clicks, or a missing target", () => {
    expect(classifyTaskAction({ type: "scroll", direction: "down" }, null).sensitive).toBe(false);
    expect(classifyTaskAction({ type: "wait", ms: 10 }, null).sensitive).toBe(false);
    expect(classifyTaskAction({ type: "screenshot" }, null).sensitive).toBe(false);
    expect(classifyTaskAction({ type: "drag", from: { ref: "e1" }, to: { ref: "e2" } }, order).sensitive).toBe(false);
    expect(classifyTaskAction({ type: "right_click", target: { ref: "e1" } }, order).sensitive).toBe(false);
    expect(classifyTaskAction({ type: "click", target: { ref: "e1" } }, null).sensitive).toBe(false);
  });
});
