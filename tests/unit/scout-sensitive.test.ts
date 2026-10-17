// Part 3 sensitive actions (spec 8.4): decided on the device from the action type and its target.
import { describe, expect, it } from "vitest";
import type { Snapshot } from "../../src/snapshot/snapshot";
import { classify, describeAction } from "../../src/scout/sensitive";

const snap: Snapshot = {
  url: "https://shop.test/checkout",
  title: "Checkout",
  text: "",
  truncated: false,
  elements: [
    { ref: "e1", tag: "button", role: "button", name: "Place your order" },
    { ref: "e2", tag: "a", role: "link", name: "Sign in", href: "/login" },
    { ref: "e3", tag: "button", role: "button", name: "Delete address" },
    { ref: "e4", tag: "input", role: "button", name: "Go", type: "submit", inForm: true },
    { ref: "e5", tag: "a", role: "link", name: "Invoice", href: "/files/invoice.pdf" },
    { ref: "e6", tag: "input", role: "textbox", name: "Card number", type: "text", redacted: true, inForm: true },
    { ref: "e7", tag: "input", role: "textbox", name: "Password", type: "password", redacted: true, inForm: true },
    { ref: "e8", tag: "input", role: "textbox", name: "Search", type: "text", inForm: true },
    { ref: "e9", tag: "button", role: "button", name: "Show more" },
    { ref: "e10", tag: "button", role: "button", name: "Send message" },
    { ref: "e11", tag: "button", role: "button", name: "Update account settings" },
    { ref: "e12", tag: "textarea", role: "textbox", name: "Notes", inForm: true },
    { ref: "e13", tag: "input", role: "textbox", name: "Name", type: "text" },
  ],
};

const kindOf = (action: Parameters<typeof classify>[0]) => {
  const c = classify(action, snap);
  return c.sensitive ? c.kind : null;
};

describe("classify", () => {
  it("flags purchase, sign in, delete, submit, download, send and account controls", () => {
    expect(kindOf({ type: "click", target: { ref: "e1" } })).toBe("purchase");
    expect(kindOf({ type: "click", target: { ref: "e2" } })).toBe("sign_in");
    expect(kindOf({ type: "click", target: { ref: "e3" } })).toBe("delete");
    expect(kindOf({ type: "click", target: { ref: "e4" } })).toBe("submit");
    expect(kindOf({ type: "click", target: { ref: "e5" } })).toBe("download");
    expect(kindOf({ type: "click", target: { ref: "e10" } })).toBe("send");
    expect(kindOf({ type: "click", target: { ref: "e11" } })).toBe("account");
    expect(kindOf({ type: "double_click", target: { ref: "e1" } })).toBe("purchase");
  });

  it("leaves harmless actions alone", () => {
    expect(kindOf({ type: "click", target: { ref: "e9" } })).toBeNull();
    expect(kindOf({ type: "scroll", direction: "down" })).toBeNull();
    expect(kindOf({ type: "scroll_to_element", target: { ref: "e1" } })).toBeNull();
    expect(kindOf({ type: "wait", ms: 10 })).toBeNull();
    expect(kindOf({ type: "screenshot" })).toBeNull();
    expect(kindOf({ type: "type", target: { ref: "e13" }, text: "Ada" })).toBeNull();
    expect(kindOf({ type: "right_click", target: { ref: "e1" } })).toBeNull();
    expect(kindOf({ type: "key", key: "Escape" })).toBeNull();
    expect(kindOf({ type: "key", key: "Enter", target: { ref: "e13" } })).toBeNull();
  });

  it("flags typing into password and payment fields", () => {
    expect(kindOf({ type: "type", target: { ref: "e6" }, text: "4242" })).toBe("purchase");
    expect(kindOf({ type: "fill_field", target: { ref: "e7" }, value: "hunter2" })).toBe("sign_in");
  });

  it("treats Enter in a form field, and a newline typed into one, as submitting", () => {
    expect(kindOf({ type: "key", key: "Enter", target: { ref: "e8" } })).toBe("submit");
    expect(kindOf({ type: "key", key: "Enter" })).toBe("submit");
    expect(kindOf({ type: "type", target: { ref: "e8" }, text: "shoes\n" })).toBe("submit");
    // A newline in a textarea is just a new line.
    expect(kindOf({ type: "type", target: { ref: "e12" }, text: "line\nline" })).toBeNull();
  });

  it("asks before a coordinate click the page structure cannot name", () => {
    const c = classify({ type: "click", target: { x: 10, y: 10 } }, snap);
    expect(c.sensitive).toBe(true);
    expect(c.description).toContain("does not identify");
  });

  it("describes the action in plain language with the target's name", () => {
    const c = classify({ type: "click", target: { ref: "e1" } }, snap);
    expect(c.description).toBe('click "Place your order" to place an order or make a payment');
  });
});

describe("describeAction", () => {
  it("writes one plain line per action", () => {
    expect(describeAction({ type: "click", target: { ref: "e9" } }, snap)).toBe('Click "Show more"');
    expect(describeAction({ type: "type", target: { ref: "e13" }, text: "Ada" }, snap)).toBe('Type 3 characters into "Name"');
    expect(describeAction({ type: "scroll", direction: "down" }, snap)).toBe("Scroll down");
    expect(describeAction({ type: "wait", ms: 1500 }, snap)).toBe("Wait 1.5 s");
    expect(describeAction({ type: "click", target: { x: 3, y: 4 } }, null)).toBe("Click the point (3, 4)");
    expect(describeAction({ type: "drag", from: { ref: "e9" }, to: { ref: "e1" } }, snap)).toBe('Drag "Show more" to "Place your order"');
  });
});
