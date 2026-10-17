import { describe, expect, it } from "vitest";
import { identifyMerchant, mentionsStore, storeDomain } from "../../src/coupons/merchant";
import { mentionsMerchant, scoreCandidate } from "../../src/coupons/candidates";

describe("identifyMerchant", () => {
  it("uses the tab's domain and the page's own name for the store", () => {
    const m = identifyMerchant("https://www.melin.com/cart", { siteName: "Melin", title: "Cart – Melin" });
    expect(m).toEqual({ host: "www.melin.com", domain: "melin.com", brand: "Melin", names: ["melin", "melin com"] });
    expect(identifyMerchant("https://drinkolipop.com/cart").names).toContain("olipop");
    expect(identifyMerchant("https://www.getkion.com/cart").names).toContain("kion");
    expect(identifyMerchant("https://usehuron.com/cart").names).toContain("huron");
  });

  it("drops checkout-only subdomains and reads the brand from the title when there is no site name", () => {
    const m = identifyMerchant("https://checkout.drinkolipop.com/checkouts/cn/abc", { title: "Checkout - OLIPOP" });
    expect(m.domain).toBe("drinkolipop.com");
    expect(m.brand).toBe("OLIPOP");
    expect(m.names).toContain("olipop");
    expect(m.names).toContain("drinkolipop");
    expect(storeDomain("secure.shop.example.co.uk")).toBe("example.co.uk");
    expect(storeDomain("us.peakdesign.com")).toBe("peakdesign.com");
  });

  it("uses the canonical link to name a store behind a hosted checkout", () => {
    const m = identifyMerchant("https://carnivore-snax.myshopify.com/checkouts/cn/x", { canonical: "https://carnivoresnax.com/cart", siteName: "Carnivore Snax" });
    expect(m.domain).toBe("carnivoresnax.com");
    expect(m.brand).toBe("Carnivore Snax");
    expect(m.names).toContain("carnivore snax");
    expect(m.names).toContain("carnivoresnax");
    const bare = identifyMerchant("https://carnivore-snax.myshopify.com/cart");
    expect(bare.brand).toBe("carnivore snax");
  });

  it("names no store from an IP address or localhost", () => {
    expect(identifyMerchant("http://127.0.0.1:4317/shopify-checkout.html", { title: "Checkout" })).toMatchObject({ domain: "127.0.0.1", brand: "this store", names: [] });
    expect(identifyMerchant("http://localhost:4317/cart", { siteName: "Fixture Shop" }).brand).toBe("Fixture Shop");
  });

  it("strips store suffixes from names and ignores generic titles", () => {
    expect(identifyMerchant("https://www.tackform.com/cart", { siteName: "Tackform - Official Site", title: "Your cart" }).brand).toBe("Tackform");
    expect(identifyMerchant("https://www.tackform.com/cart", { title: "Checkout" }).brand).toBe("tackform");
  });

  it("tells whether page text names the store", () => {
    const m = identifyMerchant("https://www.carnivoresnax.com/cart", { siteName: "Carnivore Snax" });
    expect(mentionsStore("Carnivore Snax promo codes", m)).toBe(true);
    expect(mentionsStore("carnivoresnax.com coupons", m)).toBe(true);
    expect(mentionsStore("Carnivore Club coupons", m)).toBe(false);
  });
});

describe("candidate order", () => {
  const m = { domain: "chomps.com", names: ["chomps"] };
  it("prefers the store's own codes, then verified, then reported; a page naming the store ranks higher", () => {
    const store = scoreCandidate({ code: "A", origin: "store", sourceUrl: "https://chomps.com/" }, m);
    const verified = scoreCandidate({ code: "B", origin: "verified", sourceUrl: "https://wethrift.test/chomps" }, m);
    const reported = scoreCandidate({ code: "C", origin: "reported", sourceUrl: "https://wethrift.test/chomps" }, m);
    const elsewhere = scoreCandidate({ code: "D", origin: "verified", sourceUrl: "https://wethrift.test/other" }, m);
    expect(store).toBeGreaterThan(verified);
    expect(verified).toBeGreaterThan(reported);
    expect(verified).toBeGreaterThan(elsewhere);
    expect(mentionsMerchant({ code: "D", origin: "verified", sourceUrl: "https://wethrift.test/other", context: "20% off at Chomps" }, m)).toBe(true);
  });

  it("ranks a larger advertised saving higher and restricted or stale codes lower", () => {
    const big = scoreCandidate({ code: "A", origin: "verified", sourceUrl: "https://x.test/chomps", context: "30% off sitewide" }, m);
    const small = scoreCandidate({ code: "B", origin: "verified", sourceUrl: "https://x.test/chomps", context: "10% off" }, m);
    const first = scoreCandidate({ code: "C", origin: "verified", sourceUrl: "https://x.test/chomps", context: "30% off", conditions: "first order only" }, m);
    const stale = scoreCandidate({ code: "D", origin: "verified", sourceUrl: "https://x.test/chomps", context: "30% off", conditions: "expired" }, m);
    expect(big).toBeGreaterThan(small);
    expect(big).toBeGreaterThan(first);
    expect(first).toBeGreaterThan(stale);
  });
});

// Live sweep 2026-10-17: Magic Spoon's cart page named itself "Your Shopping Cart"
// and the search asked for "Your Shopping Cart codes".
describe("merchant names from cart-page titles", () => {
  it("never takes a page word for the brand and prefers the title part that matches the domain", () => {
    expect(identifyMerchant("https://magicspoon.com/cart", { siteName: "Your Shopping Cart", title: "Your Shopping Cart – Magic Spoon" }).brand).toBe("Magic Spoon");
    expect(identifyMerchant("https://magicspoon.com/cart", { title: "Magic Spoon – Your Shopping Cart" }).brand).toBe("Magic Spoon");
    expect(identifyMerchant("https://melin.com/cart", { title: "Cart – Melin | Hats" }).brand).toBe("Melin");
    expect(identifyMerchant("https://melin.com/cart", { title: "Shopping Bag" }).brand).toBe("melin");
    expect(identifyMerchant("https://drinkolipop.com/cart", { title: "Cart – OLIPOP – Prebiotic Soda" }).brand).toBe("OLIPOP");
  });
});
