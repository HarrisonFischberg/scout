// Discovery never guesses (owner rule 2026-10-17): every candidate is a code
// the model saw on a page, checked here against what the search retrieved.
// Synthetic stores, codes and pages only.
import { describe, expect, it } from "vitest";
import { addRetrieved, newRetrieved, parseFindings, suggestCodes, textHasCode, urlKey } from "../../src/coupons/codes";
import { codesInText, codesWithContext } from "../../src/coupons/store";
import { ProviderError, type ChatRequest, type ProviderClient, type StreamEvent } from "../../src/providers";

function provider(events: StreamEvent[], fail?: unknown, seen: { req?: ChatRequest } = {}): ProviderClient {
  return {
    id: "anthropic",
    async *stream(req) {
      seen.req = req;
      yield* events;
      if (fail) throw fail;
    },
  };
}

describe("parseFindings", () => {
  const retrieved = newRetrieved();
  addRetrieved(retrieved, "https://deals.test/a", "Top codes: SAVE10 (10% off), TAKE15 for 15% off, CYBER20, VETS15, MD20, LABOR15 ... fine print", "Deals for Shop");
  addRetrieved(retrieved, "https://deals.test/b");

  it("reads code lines written in Markdown, tables, lists, and other separators", () => {
    const text = [
      "**SAVE10** | https://deals.test/a",
      "`TAKE15` | [deals.test](https://deals.test/a)",
      "| CYBER20 | https://deals.test/a |",
      "1. VETS15 | <https://deals.test/a>",
      "- MD20 - https://deals.test/a",
      "LABOR15: https://deals.test/a",
      "Here are the codes I found:",
      "NONE",
    ].join("\n");
    const { found } = parseFindings(text, retrieved);
    expect(found.map((c) => c.code)).toEqual(["SAVE10", "TAKE15", "CYBER20", "VETS15", "MD20", "LABOR15"]);
    expect(found.every((c) => c.origin === "verified" && c.sourceUrl === "https://deals.test/a" && c.sourceTitle === "Deals for Shop")).toBe(true);
  });

  it("keeps the quote and conditions as evidence", () => {
    const { found } = parseFindings('SAVE10 | https://deals.test/a | "Use SAVE10 for 10% off sitewide" | first order only, expires 10/31', retrieved);
    expect(found[0]).toMatchObject({ code: "SAVE10", context: "Use SAVE10 for 10% off sitewide", conditions: "first order only, expires 10/31" });
    expect(parseFindings("SAVE10 | https://deals.test/a | - | -", retrieved).found[0]).toEqual({ code: "SAVE10", origin: "verified", sourceUrl: "https://deals.test/a", sourceTitle: "Deals for Shop" });
  });

  it("marks a code reported when its page was returned but its text not retrieved, and drops one whose page was never seen", () => {
    const f = parseFindings("NEWCODE | https://deals.test/b | \"20% off\"\nMEMORY10 | https://never-returned.test/x | \"10% off\"", retrieved);
    expect(f.found).toEqual([{ code: "NEWCODE", origin: "reported", sourceUrl: "https://deals.test/b", context: "20% off" }]);
    expect(f.dropped).toEqual(["MEMORY10"]);
  });

  it("a code listed for a retrieved page but absent from its text is only reported, never verified", () => {
    const f = parseFindings("GHOST50 | https://deals.test/a", retrieved);
    expect(f.found[0]?.origin).toBe("reported");
  });

  it("never completes a masked code and counts masked and code-free offers separately", () => {
    const f = parseFindings(
      ["SAVE1*** | https://deals.test/a", "MASKED | https://deals.test/a | shows a 15% code behind a button", "OFFER | https://deals.test/a | free shipping over $50, no code needed", "HINT | 15 | https://deals.test/a"].join("\n"),
      retrieved,
    );
    expect(f.found).toEqual([]);
    expect(f.masked).toBe(3);
    expect(f.offers).toEqual(["free shipping over $50, no code needed"]);
  });

  it("matches a page address without its scheme, www or trailing slash", () => {
    expect(urlKey("HTTPS://www.Deals.test/a/")).toBe("deals.test/a");
    expect(parseFindings("SAVE10 | http://www.deals.test/a/", retrieved).found[0]?.origin).toBe("verified");
  });

  it("checks a code as a whole word", () => {
    expect(textHasCode("use code SAVE10 today", "SAVE10")).toBe(true);
    expect(textHasCode("use code SAVE100 today", "SAVE10")).toBe(false);
    expect(textHasCode("save10", "SAVE10")).toBe(true);
  });
});

describe("codesInText", () => {
  it("finds codes a store advertises, with the words around them", () => {
    expect(codesInText("Fall sale! Use code TACO10 for 10% off. Promo code: SAVE-15 · enter WELCOME5 at checkout")).toEqual(["TACO10", "SAVE-15", "WELCOME5"]);
    expect(codesInText("USE CODE CYBERTACK FOR 20% OFF")).toEqual(["CYBERTACK"]);
    expect(codesWithContext("Fall sale! Use code TACO10 for 10% off.")[0]).toEqual({ code: "TACO10", context: "Fall sale! Use code TACO10 for 10% off." });
  });

  it("ignores ordinary words, form labels, and numbers", () => {
    expect(codesInText("Discount code or gift card. Apply. Use code at checkout. ZIP code 80202. Enter code APPLY. Promo code: USD. Code will be sent")).toEqual([]);
  });
});

describe("suggestCodes when the search does not finish", () => {
  it("keeps the codes found before an error and says why; no guesses are added", async () => {
    const r = await suggestCodes(
      provider([{ type: "source", url: "https://deals.test/a" }, { type: "text", delta: "SAVE10 | https://deals.test/a\n" }], new ProviderError("anthropic", "rate_limited", 429)),
      "m",
      "www.shop.test",
    );
    expect(r.error).toEqual({ code: "rate_limited", message: "The web search failed. The provider is rate limiting requests. Wait a moment and try again." });
    expect(r.codes).toEqual([{ code: "SAVE10", origin: "reported", sourceUrl: "https://deals.test/a", sources: 1 }]);
    expect(r.found).toBe(1);
  });

  it("never throws on a rejected key and returns no codes at all", async () => {
    const r = await suggestCodes(provider([], new ProviderError("anthropic", "auth_invalid", 401)), "m", "www.shop.test");
    expect(r.error?.code).toBe("auth_invalid");
    expect(r.found).toBe(0);
    expect(r.codes).toEqual([]);
  });

  it("stops a search that takes too long and keeps what came before", async () => {
    const slow: ProviderClient = {
      id: "anthropic",
      async *stream(req) {
        yield { type: "source", url: "https://deals.test/a" };
        yield { type: "text", delta: "SAVE10 | https://deals.test/a\n" };
        await new Promise((_res, rej) => req.signal?.addEventListener("abort", () => rej(new ProviderError("anthropic", "network"))));
      },
    };
    const r = await suggestCodes(slow, "m", "www.shop.test", undefined, { timeoutMs: 20 });
    expect(r.error?.code).toBe("timeout");
    expect(r.codes[0]?.code).toBe("SAVE10");
  });

  it("names the stop as a stop, not a failure", async () => {
    const ac = new AbortController();
    const stopped: ProviderClient = {
      id: "anthropic",
      async *stream(req) {
        ac.abort();
        if (req.signal?.aborted) throw new ProviderError("anthropic", "network");
        yield { type: "done" };
      },
    };
    expect((await suggestCodes(stopped, "m", "www.shop.test", ac.signal)).error?.code).toBe("stopped");
  });

  it("with search disabled makes no model call and returns nothing", async () => {
    const seen: { req?: ChatRequest } = {};
    const r = await suggestCodes(provider([], undefined, seen), "m", "getbeefy.co", undefined, { webSearch: false });
    expect(seen.req).toBeUndefined();
    expect(r.searched).toBe(false);
    expect(r.codes).toEqual([]);
  });
});

describe("suggestCodes request and evidence", () => {
  it("names the store, asks for searches and page reads, and for each code as soon as it is seen", async () => {
    const seen: { req?: ChatRequest } = {};
    await suggestCodes(provider([], undefined, seen), "m", "www.tackform.test");
    expect(String(seen.req?.messages[0]?.content)).toContain("Store: tackform\nStore website: tackform.test");
    expect(String(seen.req?.messages[0]?.content)).not.toContain("Also written as");
    const olipop: { req?: ChatRequest } = {};
    await suggestCodes(provider([], undefined, olipop), "m", "www.drinkolipop.com");
    expect(String(olipop.req?.messages[0]?.content)).toContain("Store: drinkolipop\nStore website: drinkolipop.com\nAlso written as: olipop");
    expect(seen.req).toMatchObject({ webSearch: true, webSearchMaxUses: 10, webFetch: true, webFetchMaxUses: 8 });
    expect(seen.req?.system).toContain("as soon as you see it");
    // Live sweep 2026-10-17: Melin's search stopped at 6 masked codes; pages that print codes are named.
    expect(String(seen.req?.messages[0]?.content)).toContain("https://www.wethrift.com/tackform https://dealhack.com/coupons/tackform https://www.dealdrop.com/tackform https://www.wethrift.com/codes/tackform.test");
    expect(seen.req?.system).toContain("hide codes behind a 'Get code' button");
    expect(seen.req?.system).toContain("Never invent, complete, or vary a code");
    expect(seen.req?.system).not.toMatch(/guess/i);
  });

  it("a second search names the tried codes, points at other kinds of sources, and skips the tried ones", async () => {
    const seen: { req?: ChatRequest } = {};
    const r = await suggestCodes(
      provider([{ type: "source", url: "https://deals.test/new" }, { type: "text", delta: "RACH | https://deals.test/new\nNEWONE | https://deals.test/new\n" }], undefined, seen),
      "m",
      "getbeefy.co",
      undefined,
      { exclude: ["RACH", "BEEFY10"], more: true },
    );
    const msg = String(seen.req?.messages[0]?.content);
    expect(msg).toContain("Already tried, do not list these again");
    expect(msg).toContain("RACH, BEEFY10");
    expect(msg).toContain("second search");
    expect(r.codes.map((c) => c.code)).toEqual(["NEWONE"]);
  });

  it("verifies a code against the text of a page the model fetched", async () => {
    const r = await suggestCodes(
      provider([
        { type: "source", url: "https://wethrift.test/shop", title: "Shop codes", page: "Shop discount codes\nSAVE20 20% off sitewide · used 5 times\nTAKE10 10% off" },
        { type: "text", delta: 'SAVE20 | https://wethrift.test/shop | "SAVE20 20% off sitewide" | -\nTAKE10 | https://wethrift.test/shop\nNOTTHERE | https://wethrift.test/shop\n' },
        { type: "usage", usage: { inputTokens: 12, outputTokens: 4, webSearches: 3 } },
      ]),
      "m",
      "www.shop.test",
    );
    expect(r.codes.map((c) => [c.code, c.origin])).toEqual([
      ["SAVE20", "verified"],
      ["TAKE10", "verified"],
      ["NOTTHERE", "reported"],
    ]);
    expect(r.codes[0]).toMatchObject({ sourceTitle: "Shop codes", context: "SAVE20 20% off sitewide" });
    expect(r).toMatchObject({ found: 3, verified: 2, reported: 1, dropped: 0, inputTokens: 12, webSearches: 3 });
  });

  it("adds codes quoted in citations as verified, from page text rather than the model", async () => {
    const r = await suggestCodes(provider([{ type: "source", url: "https://deals.test/c", text: "Use code CYBER20 for 20% off sitewide" }, { type: "text", delta: "NONE" }]), "m", "www.shop.test");
    expect(r.codes[0]).toMatchObject({ code: "CYBER20", origin: "verified", sourceUrl: "https://deals.test/c", context: "Use code CYBER20 for 20% off sitewide" });
  });

  it("tests the store's own codes and verified codes before reported ones, and codes whose page names the store before others", async () => {
    const r = await suggestCodes(
      provider([
        { type: "source", url: "https://deals.test/other-store" },
        { type: "source", url: "https://deals.test/beefy", page: "Beefy codes: BEEFYVIP 15% off" },
        { type: "text", delta: "OTHER10 | https://deals.test/other-store\nBEEFYVIP | https://deals.test/beefy\nSOME5 | https://deals.test/beefy\n" },
      ]),
      "m",
      "www.getbeefy.co",
    );
    expect(r.codes.map((c) => c.code)).toEqual(["BEEFYVIP", "SOME5", "OTHER10"]);
  });
});

describe("likelyCodePages", () => {
  it("builds candidate pages from the domain label and the brand, without duplicates", async () => {
    const { likelyCodePages } = await import("../../src/coupons/codes");
    const { identifyMerchant } = await import("../../src/coupons/merchant");
    const pages = likelyCodePages(identifyMerchant("https://www.heartandsoil.co/cart", { siteName: "Heart & Soil" }));
    expect(pages).toContain("https://www.wethrift.com/heartandsoil");
    expect(pages).toContain("https://www.wethrift.com/heart-and-soil");
    expect(pages).toContain("https://www.dealdrop.com/heart-and-soil");
    expect(new Set(pages).size).toBe(pages.length);
    expect(pages.length).toBeLessThanOrEqual(8);
    expect(likelyCodePages(identifyMerchant("http://127.0.0.1:4317/cart"))).toEqual([]);
  });
});
