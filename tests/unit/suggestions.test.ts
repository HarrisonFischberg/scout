// Empty-chat suggestions: shopping actions on known stores, general chips elsewhere.
import { describe, expect, it } from "vitest";
import { SHOPPING_SUGGESTIONS, shoppingSite, suggestionsFor } from "../../src/panel/suggestions";

describe("shopping site detection", () => {
  it("recognizes known stores on their own domains and subdomains", () => {
    expect(shoppingSite("https://www.amazon.com/dp/B000")?.name).toBe("Amazon");
    expect(shoppingSite("https://smile.amazon.co.uk/x")?.name).toBe("Amazon");
    expect(shoppingSite("https://www.amazon.de/")?.name).toBe("Amazon");
    expect(shoppingSite("https://www.target.com/p/widget")?.name).toBe("Target");
    expect(shoppingSite("https://www.walmart.com/ip/1")?.name).toBe("Walmart");
    expect(shoppingSite("https://www.ebay.com/itm/1")?.name).toBe("eBay");
    expect(shoppingSite("https://www.homedepot.com/")?.name).toBe("The Home Depot");
  });

  it("ignores lookalikes, other TLDs and non-web pages", () => {
    expect(shoppingSite("https://notamazon.com/")).toBeNull();
    expect(shoppingSite("https://amazon.evil.com/")).toBeNull();
    expect(shoppingSite("https://amazon.com.evil.io/")).toBeNull();
    expect(shoppingSite("https://target.example/")).toBeNull();
    expect(shoppingSite("https://shop.test/a")).toBeNull();
    expect(shoppingSite("file:///amazon.com")).toBeNull();
    expect(shoppingSite("not a url")).toBeNull();
    expect(shoppingSite(undefined)).toBeNull();
  });
});

describe("suggestions for a page", () => {
  it("offers the shopping actions on a store, nothing special elsewhere", () => {
    expect(suggestionsFor("https://www.amazon.com/dp/B000")?.items.map((s) => s.label)).toEqual([
      "Compare prices across sites",
      "Find similar products",
      "Summarize product reviews",
      "Find coupons",
    ]);
    expect(suggestionsFor("https://en.wikipedia.org/wiki/Safari")).toBeNull();
  });

  it("keeps Find coupons on the coupon run and every other prompt a real question", () => {
    expect(SHOPPING_SUGGESTIONS.find((s) => s.label === "Find coupons")?.prompt).toBe("coupons");
    for (const s of SHOPPING_SUGGESTIONS.filter((x) => x.prompt !== "coupons")) expect(s.prompt.length).toBeGreaterThan(40);
  });
});
