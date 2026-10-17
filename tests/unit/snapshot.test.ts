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

  // Live sweep 2026-10-17, Brumate: the drawer's remove-discount button is an
  // × icon whose only name is the SVG's <title>; an SVG without one names nothing.
  it("names an icon button by its SVG title, and nothing by an SVG without one", () => {
    const tree = n("body", {}, [
      n("button", { type: "button" }, [n("svg", { viewBox: "0 0 24 24" }, [n("title", {}, [t("Remove discount")]), n("use", { href: "/svgs/close.svg#close" })])]),
      n("button", { "aria-label": "Close cart drawer" }, [n("svg", {}, [n("title", {}, [t("Arrow Left")])])]),
      n("button", {}, [n("svg", {}, [n("path", { d: "M0 0" })])]),
      n("p", {}, [n("svg", {}, [n("title", {}, [t("Discount")])]), t("LL10-XEEG0MNF")]),
    ]);
    const snap = buildSnapshot(tree, opts);
    expect(snap.elements.map((e) => e.name)).toEqual(["Remove discount", "Close cart drawer", ""]);
    // Drawing never becomes page text; the code next to the icon still does.
    expect(snap.text).not.toContain("Discount");
    expect(snap.text).toContain("LL10-XEEG0MNF");
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

  // Diagnostics run #20 (2026-10-16): Shopify checkout draws each character of
  // a price in its own span and puts the whole amount in aria-label.
  it("reads a price split into one span per character through its aria-label", () => {
    const chars = "$170.00".split("").map((c) => n("span", {}, [t(c)]));
    const tree = n("div", { role: "row" }, [
      n("div", { role: "rowheader" }, [n("strong", {}, [t("Total")])]),
      n("div", { role: "cell" }, [
        n("div", {}, [
          n("abbr", {}, [n("span", {}, [t("USD")])]),
          n("strong", {}, [n("span", { "aria-hidden": "true" }, [n("span", {}, [t("$170.00")])])]),
          n("strong", {}, [n("span", {}, [n("span", { "aria-label": "$170.00" }, chars)])]),
        ]),
      ]),
    ]);
    expect(buildSnapshot(tree, opts).text).toBe("Total\nUSD $170.00");
  });

  it("keeps an aria-label container's text when the label says something else", () => {
    const tree = n("nav", { "aria-label": "Main menu" }, [n("span", {}, [t("Home")]), n("span", {}, [t("Shop")])]);
    expect(buildSnapshot(tree, opts).text).toBe("Home Shop");
  });

  it("does not redact a discount box that also takes gift cards, but still redacts gift card numbers and PINs", () => {
    expect(isSensitiveField(n("input", { type: "text", name: "reductions", placeholder: "Discount code or gift card" }))).toBe(false);
    expect(isSensitiveField(n("input", { type: "text", "aria-label": "Promo code or gift card" }))).toBe(false);
    expect(isSensitiveField(n("input", { type: "text", name: "gift_card_number" }))).toBe(true);
    expect(isSensitiveField(n("input", { type: "text", placeholder: "Gift card" }))).toBe(true);
    expect(isSensitiveField(n("input", { type: "text", name: "discount_card_number" }))).toBe(true);
    expect(isSensitiveField(n("input", { type: "text", placeholder: "Gift card PIN", name: "coupon_pin" }))).toBe(true);
  });

  it("reports refs through onRef for the executor", () => {
    const seen: string[] = [];
    const btn = n("button", {}, [t("Go")]);
    buildSnapshot(n("body", {}, [btn]), { ...opts, onRef: (ref, node) => seen.push(ref + ":" + (node === btn)) });
    expect(seen).toEqual(["e1:true"]);
  });
});
