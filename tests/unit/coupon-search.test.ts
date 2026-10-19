// The web search itself never guesses (guesses.ts adds them later): every candidate is a code
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

describe("parseFindings bookkeeping", () => {
  it("counts reply lines that are neither a code line nor MASKED, OFFER or NONE", () => {
    const r = newRetrieved();
    addRetrieved(r, "https://deals.test/a", "SAVE5 5% off");
    const f = parseFindings("Here is what I found:\nSAVE5 | https://deals.test/a\nMASKED | https://deals.test/b | hidden\nNo other codes exist.\nNONE", r);
    expect(f.found.map((c) => c.code)).toEqual(["SAVE5"]);
    expect(f.masked).toBe(1);
    expect(f.ignored).toBe(2);
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
    const r = await suggestCodes(slow, "m", "www.shop.test", undefined, { timeoutMs: 20, readPages: false });
    expect(r.error?.code).toBe("timeout");
    expect(r.codes[0]?.code).toBe("SAVE10");
  });

  // Live sweeps 2026-10-17: MASA and Ancestral Supplements spent four minutes fetching slow
  // pages and wrote nothing, twice each. A search-only pass then runs, briefly.
  it("retries once without page reads when the fetching search times out with nothing written", async () => {
    const reqs: ChatRequest[] = [];
    const twoPass: ProviderClient = {
      id: "anthropic",
      async *stream(req) {
        reqs.push(req);
        if (req.webFetch) {
          await new Promise((_res, rej) => req.signal?.addEventListener("abort", () => rej(new ProviderError("anthropic", "network"))));
          return;
        }
        yield { type: "source", url: "https://deals.test/quick" };
        yield { type: "text", delta: "QUICK10 | https://deals.test/quick\n" };
      },
    };
    const r = await suggestCodes(twoPass, "m", "www.masa.test", undefined, { angles: 1, timeoutMs: 20, retryTimeoutMs: 500, readPages: false });
    expect(reqs).toHaveLength(2);
    expect(reqs[0]).toMatchObject({ webFetch: true, webSearchMaxUses: 10 });
    expect(reqs[1]).toMatchObject({ webFetch: false, webSearchMaxUses: 6 });
    expect(String(reqs[1]?.messages[0]?.content)).toContain("quick search without page reads");
    expect(r.retried).toBe(true);
    expect(r.error).toBeUndefined();
    expect(r.codes.map((c) => [c.code, c.origin])).toEqual([["QUICK10", "reported"]]);
  });

  it("does not retry when the timed-out search had already written codes, or when retry is off", async () => {
    let calls = 0;
    const slow: ProviderClient = {
      id: "anthropic",
      async *stream(req) {
        calls++;
        yield { type: "source", url: "https://deals.test/a" };
        yield { type: "text", delta: "SAVE10 | https://deals.test/a\n" };
        await new Promise((_res, rej) => req.signal?.addEventListener("abort", () => rej(new ProviderError("anthropic", "network"))));
      },
    };
    const r = await suggestCodes(slow, "m", "www.shop.test", undefined, { angles: 1, timeoutMs: 20, retryTimeoutMs: 20, readPages: false });
    expect(calls).toBe(1);
    expect(r.retried).toBeUndefined();
    expect(r.error?.code).toBe("timeout");
    const empty: ProviderClient = {
      id: "anthropic",
      async *stream(req) {
        calls++;
        await new Promise((_res, rej) => req.signal?.addEventListener("abort", () => rej(new ProviderError("anthropic", "network"))));
      },
    };
    calls = 0;
    await suggestCodes(empty, "m", "www.shop.test", undefined, { angles: 1, timeoutMs: 20, retry: false, readPages: false });
    expect(calls).toBe(1);
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
  it("reads the listed pages first without searching, then names the store and asks for searches and page reads", async () => {
    const reqs: ChatRequest[] = [];
    const recorder: ProviderClient = {
      id: "anthropic",
      async *stream(req) {
        reqs.push(req);
      },
    };
    await suggestCodes(recorder, "m", "www.tackform.test", undefined, { angles: 1 });
    expect(reqs).toHaveLength(2);
    // Live sweep 2026-10-17: Melin's search stopped at 6 masked codes, and a model told to open the
    // listed pages before searching read them all and wrote nothing in four minutes (Brumate). The
    // pages that print codes are named, the ones that printed working codes most often first, and
    // read in a pass of their own, with no search tool, before the search starts.
    const listed =
      "https://www.wethrift.com/tackform https://www.wethrift.com/codes/tackform.test https://us.hotdeals.com/store/tackform-coupon " +
      "https://www.dontpayfull.com/at/tackform.test https://www.couponbind.com/coupons/tackform.test https://tackform.tenereteam.com/coupons " +
      "https://usa.coupert.com/coupons/tackform-test-discount-code https://dealhack.com/coupons/tackform";
    expect(reqs[0]).toMatchObject({ webSearch: false, webFetch: true, webFetchMaxUses: 8 });
    expect(reqs[0]?.webSearchMaxUses).toBeUndefined();
    expect(String(reqs[0]?.messages[0]?.content)).toContain("Store: tackform\nStore website: tackform.test");
    expect(String(reqs[0]?.messages[0]?.content)).toContain("First job, no searching: open each of these pages with web_fetch");
    expect(String(reqs[0]?.messages[0]?.content)).toContain("Pages: " + listed);
    const seen = { req: reqs[1] };
    expect(seen.req).toMatchObject({ webSearch: true, webSearchMaxUses: 10, webFetch: true, webFetchMaxUses: 10 });
    expect(String(seen.req?.messages[0]?.content)).toContain("Store: tackform\nStore website: tackform.test");
    expect(String(seen.req?.messages[0]?.content)).not.toContain("Also written as");
    // Nothing was opened by this fake, so the search is told to open them.
    expect(String(seen.req?.messages[0]?.content)).toContain("Open these pages too; they were not read yet: " + listed);
    expect(String(seen.req?.messages[0]?.content)).not.toContain("First job");
    const olipop: { req?: ChatRequest } = {};
    await suggestCodes(provider([], undefined, olipop), "m", "www.drinkolipop.com");
    expect(String(olipop.req?.messages[0]?.content)).toContain("Store: drinkolipop\nStore website: drinkolipop.com\nAlso written as: olipop");
    expect(seen.req?.system).toContain("as soon as you see it");
    expect(seen.req?.system).toContain("open each with web_fetch and list what they print before anything else");
    // Tackform run i: full codes next to "Get Code" labels were all reported as masked.
    expect(seen.req?.system).toContain("A code printed in full next to a 'Get Code', 'Show Code', 'Copy' or 'Verified' label is shown: list it.");
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
      undefined,
      // This fake replays the same stream on every call; the read-first pass is tested on its own.
      { readPages: false, angles: 1 },
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
    expect(pages[0]).toBe("https://www.wethrift.com/heartandsoil");
    expect(pages[1]).toBe("https://www.wethrift.com/heart-and-soil");
    expect(pages).toContain("https://heartandsoil.tenereteam.com/coupons");
    expect(pages).toContain("https://www.dontpayfull.com/at/heartandsoil.co");
    expect(pages).toContain("https://www.couponbind.com/coupons/heartandsoil.co");
    expect(new Set(pages).size).toBe(pages.length);
    // Few enough that one request opens them all (FETCH_USES is 10).
    expect(pages.length).toBeLessThanOrEqual(8);
    expect(likelyCodePages(identifyMerchant("http://127.0.0.1:4317/cart"))).toEqual([]);
  });
});

// Live sweep 2026-10-17: Tackform's working code (STREETDEALX) was printed on a
// listed page the model never opened in three runs; told to open every listed
// page before searching, the model then read them all and wrote nothing in
// four minutes (Brumate). The listed pages are read first, on their own.
describe("listed pages are read first", () => {
  const listedFor = async (store: string): Promise<string[]> => {
    const { likelyCodePages } = await import("../../src/coupons/codes");
    const { identifyMerchant } = await import("../../src/coupons/merchant");
    return likelyCodePages(identifyMerchant("https://" + store + "/"));
  };
  const isRead = (req: ChatRequest): boolean => String(req.messages[0]?.content).includes("First job, no searching");

  it("reads them without the search tool, then tells the search which were read and which were not", async () => {
    const reqs: ChatRequest[] = [];
    const p: ProviderClient = {
      id: "anthropic",
      async *stream(req) {
        reqs.push(req);
        if (isRead(req)) {
          yield { type: "fetch", url: "https://wethrift.com/tackform/", ok: true, chars: 1200 };
          yield { type: "source", url: "https://www.wethrift.com/tackform", title: "Tackform", page: "No Tackform codes right now." };
          yield { type: "fetch", url: "https://www.couponbind.com/coupons/tackform.test", ok: true, chars: 900 };
          yield { type: "source", url: "https://www.couponbind.com/coupons/tackform.test", title: "Tackform codes", page: "STREETDEALX: 10% off at Tackform" };
          yield { type: "fetch", url: "https://us.hotdeals.com/store/tackform-coupon", ok: false, error: "url_not_accessible" };
          yield { type: "text", delta: 'STREETDEALX | https://www.couponbind.com/coupons/tackform.test | "STREETDEALX: 10% off" | -\n' };
          return;
        }
        yield { type: "source", url: "https://creator.test/tack", page: "my code TACKFAN10" };
        yield { type: "text", delta: "TACKFAN10 | https://creator.test/tack\n" };
      },
    };
    const r = await suggestCodes(p, "m", "www.tackform.test", undefined, { angles: 1 });
    const listed = await listedFor("www.tackform.test");
    expect(reqs).toHaveLength(2);
    expect(reqs[0]).toMatchObject({ webSearch: false, webFetch: true, webFetchMaxUses: listed.length });
    expect(reqs[1]).toMatchObject({ webSearch: true, webSearchMaxUses: 10, webFetch: true, webFetchMaxUses: 10 });
    const second = String(reqs[1]?.messages[0]?.content);
    // Read with or without "www." and a slash; a page that failed to load counts as opened (asking again would fail again).
    expect(second).toContain(
      "These pages were already read in a previous step; do not open them again: https://www.wethrift.com/tackform https://us.hotdeals.com/store/tackform-coupon https://www.couponbind.com/coupons/tackform.test",
    );
    expect(second).toContain("Open these pages too; they were not read yet: https://www.wethrift.com/codes/tackform.test https://www.dontpayfull.com/at/tackform.test");
    expect(r.pagesRead).toBe(true);
    expect(r.pagesListed).toBe(listed.length);
    expect(r.pagesOpened).toBe(3);
    expect(r.pages).toEqual([
      { url: "https://wethrift.com/tackform/", ok: true, chars: 1200 },
      { url: "https://www.couponbind.com/coupons/tackform.test", ok: true, chars: 900 },
      { url: "https://us.hotdeals.com/store/tackform-coupon", ok: false, error: "url_not_accessible" },
    ]);
    expect(r.error).toBeUndefined();
    expect(r.codes.map((c) => [c.code, c.origin])).toEqual([
      ["STREETDEALX", "verified"],
      ["TACKFAN10", "verified"],
    ]);
  });

  it("keeps a reply that ends without a newline apart from the next pass's first line", async () => {
    // The read pass replies "...BOGUS99 | url | quote | -" with no newline;
    // the search pass starts "WELCOME5 | ...". Joined, BOGUS99 would carry
    // "-WELCOME5" as its conditions and WELCOME5's own line would be lost.
    const page = "Use code BOGUS99 at checkout. Use code WELCOME5 at checkout.";
    const p: ProviderClient = {
      id: "anthropic",
      async *stream(req) {
        yield { type: "source", url: "https://deals.test/x", page };
        yield { type: "text", delta: isRead(req) ? 'BOGUS99 | https://deals.test/x | "Use code BOGUS99" | -' : 'WELCOME5 | https://deals.test/x | "Use code WELCOME5" | first order\nBOGUS99 | https://deals.test/x | "Use code BOGUS99" | -' };
      },
    };
    const r = await suggestCodes(p, "m", "www.tackform.test");
    expect(r.codes.map((c) => [c.code, c.conditions])).toEqual([
      ["BOGUS99", undefined],
      ["WELCOME5", "first order"],
    ]);
    expect(r.ignored).toBe(0);
  });

  it("skips the read on a provider without a page fetch tool, and on a second search", async () => {
    const reqs: ChatRequest[] = [];
    const openai: ProviderClient = {
      id: "openai",
      async *stream(req) {
        reqs.push(req);
        yield { type: "source", url: "https://deals.test/o" };
        yield { type: "text", delta: "OPEN10 | https://deals.test/o\n" };
      },
    };
    const r = await suggestCodes(openai, "m", "www.tackform.test", undefined, { angles: 1 });
    expect(reqs).toHaveLength(1);
    expect(reqs[0]).toMatchObject({ webSearch: true });
    expect(r.pagesRead).toBeUndefined();
    expect(r.codes.map((c) => c.code)).toEqual(["OPEN10"]);
    const again: ChatRequest[] = [];
    const anthropic: ProviderClient = {
      id: "anthropic",
      async *stream(req) {
        again.push(req);
      },
    };
    await suggestCodes(anthropic, "m", "www.tackform.test", undefined, { angles: 1, more: true, exclude: ["OPEN10"] });
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ webSearch: true });
  });

  it("a read that runs out of time still leads to the search; a refused read ends it", async () => {
    const reqs: ChatRequest[] = [];
    const slowRead: ProviderClient = {
      id: "anthropic",
      async *stream(req) {
        reqs.push(req);
        if (isRead(req)) {
          await new Promise((_res, rej) => req.signal?.addEventListener("abort", () => rej(new ProviderError("anthropic", "network"))));
          return;
        }
        yield { type: "source", url: "https://deals.test/s" };
        yield { type: "text", delta: "LATE10 | https://deals.test/s\n" };
      },
    };
    const r = await suggestCodes(slowRead, "m", "www.tackform.test", undefined, { angles: 1, readTimeoutMs: 20 });
    expect(reqs).toHaveLength(2);
    expect(r.error).toBeUndefined();
    expect(r.codes.map((c) => c.code)).toEqual(["LATE10"]);
    let calls = 0;
    const broke: ProviderClient = {
      id: "anthropic",
      async *stream() {
        calls++;
        throw new ProviderError("anthropic", "no_credit");
      },
    };
    const r2 = await suggestCodes(broke, "m", "www.tackform.test", undefined, { angles: 1 });
    expect(calls).toBe(1);
    expect(r2.error?.code).toBe("no_credit");
  });

  // Tackform run i: CouponBind, HotDeals and Tenere answered with the codes printed in full next
  // to "Get Code" labels, and the model reported every one as masked. The page text itself is
  // evidence: codes printed on a page about the store are read from it, model or no model.
  it("reads codes printed on a page about the store from its text, even when the model calls them masked", async () => {
    const couponbind = "https://www.couponbind.com/coupons/tackform.test";
    const p: ProviderClient = {
      id: "anthropic",
      async *stream(req) {
        if (!isRead(req)) return;
        yield { type: "fetch", url: couponbind, ok: true, chars: 400 };
        yield {
          type: "source",
          url: couponbind,
          title: "Tackform Coupon Codes",
          page:
            "Tackform Coupon Codes & Discount Code FAQ. 10% off sitewide. expires 01/09/2027 185 Verified Get Code STREETDEALX. " +
            "12% off: Get Code TFLD26. Free shipping on orders over $50: no code needed. Promo code TACKFORM is not a code. Show Code GIFT15.",
        };
        yield { type: "fetch", url: "https://news.test/best-coupons-this-week", ok: true, chars: 100 };
        yield { type: "source", url: "https://news.test/best-coupons-this-week", page: "Ridge wallets: use code RIDGE20 for 20% off." };
        yield { type: "text", delta: "MASKED | " + couponbind + " | codes behind Get Code buttons\n" };
      },
    };
    const r = await suggestCodes(p, "m", "www.tackform.test");
    expect(r.masked).toBe(1);
    expect(r.readFromPages).toBe(3);
    expect(r.codes.map((c) => [c.code, c.origin, c.sourceUrl])).toEqual([
      ["STREETDEALX", "verified", couponbind],
      ["TFLD26", "verified", couponbind],
      ["GIFT15", "verified", couponbind],
    ]);
    expect(r.codes[0]?.context).toContain("Get Code STREETDEALX");
    // "FAQ" and the store's own name are words, not codes; a page that is not about this store is not read.
    expect(r.codes.map((c) => c.code)).not.toContain("FAQ");
    expect(r.codes.map((c) => c.code)).not.toContain("TACKFORM");
    expect(r.codes.map((c) => c.code)).not.toContain("RIDGE20");
    expect(r.verified).toBe(3);
  });

  // Brumate run h: the search wrote one line of prose and no code before its time ran out, and
  // the search-only retry did not run because "something" had been written.
  it("retries without page reads when the search times out having written prose but no code line", async () => {
    const reqs: ChatRequest[] = [];
    const p: ProviderClient = {
      id: "anthropic",
      async *stream(req) {
        reqs.push(req);
        if (isRead(req)) return;
        if (req.webFetch) {
          yield { type: "text", delta: "Let me look through these pages for codes.\n" };
          await new Promise((_res, rej) => req.signal?.addEventListener("abort", () => rej(new ProviderError("anthropic", "network"))));
          return;
        }
        yield { type: "source", url: "https://deals.test/quick" };
        yield { type: "text", delta: "QUICK10 | https://deals.test/quick\n" };
      },
    };
    const r = await suggestCodes(p, "m", "www.tackform.test", undefined, { angles: 1, timeoutMs: 20, retryTimeoutMs: 500 });
    expect(reqs.map((q) => [q.webSearch, q.webFetch])).toEqual([
      [false, true],
      [true, true],
      [true, false],
    ]);
    expect(r.retried).toBe(true);
    expect(r.error).toBeUndefined();
    expect(r.ignored).toBe(1);
    expect(r.codes.map((c) => c.code)).toEqual(["QUICK10"]);
  });
});

// Owner, 2026-10-17: codes are handed over while the search runs, so they can be tested at once.
describe("suggestCodes reports codes as it finds them", () => {
  it("passes each finished, checked code line once, never a half-written one", async () => {
    const batches: string[][] = [];
    const r = await suggestCodes(
      provider([
        { type: "source", url: "https://deals.test/a", page: "Deals for shop: use SAVE10 for 10% off" },
        { type: "text", delta: "SAVE10 | https://deals.test/a | \"use SAVE10\" | -\nSAVE1" },
        { type: "text", delta: "5 | https://deals.test/a\nGHOST | https://never-returned.test/x\n" },
      ]),
      "m",
      "www.shop.test",
      undefined,
      { readPages: false, onFound: (fresh) => batches.push(fresh.map((c) => c.code)) },
    );
    expect(batches).toEqual([["SAVE10"], ["SAVE15"]]);
    expect(r.codes.map((c) => c.code).sort()).toEqual(["SAVE10", "SAVE15"]);
  });
});
