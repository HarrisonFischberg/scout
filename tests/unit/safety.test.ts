import { describe, expect, it } from "vitest";
import { classifyAction, detectCaptcha } from "../../src/safety/classifier";
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
