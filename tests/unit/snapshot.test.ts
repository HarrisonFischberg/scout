import { describe, expect, it } from "vitest";
import { buildSnapshot, isSensitiveField, REDACTED, type SnapNode } from "../../src/snapshot/snapshot";

const t = (text: string): SnapNode => ({ tag: "#text", attrs: {}, text, children: [] });
const n = (tag: string, attrs: Record<string, string> = {}, children: SnapNode[] = [], value?: string): SnapNode => ({
  tag,
  attrs,
  children,
  ...(value !== undefined ? { value } : {}),
});
const opts = { url: "https://shop.test/", title: "Shop" };

describe("snapshot", () => {
  it("lists interactive elements with sequential stable refs and label names", () => {
    const tree = n("body", {}, [
      n("h1", {}, [t("Contact")]),
      n("label", { for: "email" }, [t("Email")]),
      n("input", { id: "email", type: "email" }, [], "a@b.test"),
      n("button", {}, [t("Send")]),
      n("a", { href: "/help" }, [t("Help")]),
    ]);
    const a = buildSnapshot(tree, opts);
    const b = buildSnapshot(tree, opts);
    expect(a.elements.map((e) => e.ref)).toEqual(["e1", "e2", "e3"]);
    expect(a.elements[0]).toMatchObject({ role: "textbox", name: "Email", value: "a@b.test" });
    expect(a.elements[1]).toMatchObject({ role: "button", name: "Send" });
    expect(a.elements[2]).toMatchObject({ role: "link", href: "/help" });
    expect(b.elements).toEqual(a.elements);
    expect(a.text).toContain("Contact");
  });

  it("redacts password, card, CVV and autocomplete-flagged fields", () => {
    const fields = [
      n("input", { type: "password", name: "pw" }, [], "hunter2"),
      n("input", { type: "text", name: "card_number" }, [], "4111111111111111"),
      n("input", { type: "text", id: "cvv" }, [], "7531"),
      n("input", { type: "text", autocomplete: "cc-exp" }, [], "12/30"),
      n("input", { type: "text", autocomplete: "one-time-code" }, [], "998877"),
    ];
    const snap = buildSnapshot(n("form", {}, fields), opts);
    expect(snap.elements).toHaveLength(5);
    for (const el of snap.elements) {
      expect(el.redacted).toBe(true);
      expect(el.value).toBe(REDACTED);
    }
    const dump = JSON.stringify(snap);
    for (const secret of ["hunter2", "4111111111111111", "7531", "12/30", "998877"]) {
      expect(dump).not.toContain(secret);
    }
  });

  it("does not leak a sensitive value held in the value attribute", () => {
    const field = n("input", { type: "password", value: "attrsecret", "aria-label": "Password" });
    const snap = buildSnapshot(n("form", {}, [field]), opts);
    expect(JSON.stringify(snap)).not.toContain("attrsecret");
    expect(isSensitiveField(field)).toBe(true);
    expect(isSensitiveField(n("input", { type: "text", name: "email" }))).toBe(false);
  });

  it("skips hidden nodes, scripts and hidden inputs", () => {
    const tree = n("body", {}, [
      n("script", {}, [t("var token='zzz'")]),
      n("div", { style: "display:none" }, [n("button", {}, [t("Ghost")])]),
      n("div", { "aria-hidden": "true" }, [t("aria secret")]),
      n("input", { type: "hidden", name: "csrf" }, [], "tok"),
      n("button", {}, [t("Real")]),
    ]);
    const snap = buildSnapshot(tree, opts);
    expect(snap.elements.map((e) => e.name)).toEqual(["Real"]);
    expect(snap.text).not.toMatch(/zzz|Ghost|aria secret|tok/);
  });

  it("stays under the size budget on a large page and flags truncation", () => {
    const rows: SnapNode[] = [];
    for (let i = 0; i < 5000; i++) {
      rows.push(n("p", {}, [t("Paragraph " + i + " lorem ipsum dolor sit amet")]));
      rows.push(n("button", {}, [t("Buy " + i)]));
    }
    const snap = buildSnapshot(n("body", {}, rows), { ...opts, maxTextChars: 5000, maxElements: 50 });
    expect(snap.truncated).toBe(true);
    expect(snap.elements).toHaveLength(50);
    expect(snap.text.length).toBeLessThanOrEqual(5000);
  });

  it("reports refs through onRef for the executor", () => {
    const seen: string[] = [];
    const btn = n("button", {}, [t("Go")]);
    buildSnapshot(n("body", {}, [btn]), { ...opts, onRef: (ref, node) => seen.push(ref + ":" + (node === btn)) });
    expect(seen).toEqual(["e1:true"]);
  });
});
