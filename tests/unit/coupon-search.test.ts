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
    const r = await suggestCodes(slow, "m", "www.shop.test", undefined, { timeoutMs: 20 });
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
    const r = await suggestCodes(twoPass, "m", "www.masa.test", undefined, { timeoutMs: 20, retryTimeoutMs: 500 });
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
    const r = await suggestCodes(slow, "m", "www.shop.test", undefined, { timeoutMs: 20, retryTimeoutMs: 20 });
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
    await suggestCodes(empty, "m", "www.shop.test", undefined, { timeoutMs: 20, retry: false });
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
  it("names the store, asks for searches and page reads, and for each code as soon as it is seen", async () => {
    const seen: { req?: ChatRequest } = {};
    await suggestCodes(provider([], undefined, seen), "m", "www.tackform.test", undefined, { followUp: false });
    expect(String(seen.req?.messages[0]?.content)).toContain("Store: tackform\nStore website: tackform.test");
    expect(String(seen.req?.messages[0]?.content)).not.toContain("Also written as");
    const olipop: { req?: ChatRequest } = {};
    await suggestCodes(provider([], undefined, olipop), "m", "www.drinkolipop.com", undefined, { followUp: false });
    expect(String(olipop.req?.messages[0]?.content)).toContain("Store: drinkolipop\nStore website: drinkolipop.com\nAlso written as: olipop");
    expect(seen.req).toMatchObject({ webSearch: true, webSearchMaxUses: 10, webFetch: true, webFetchMaxUses: 10 });
    expect(seen.req?.system).toContain("as soon as you see it");
    // Live sweep 2026-10-17: Melin's search stopped at 6 masked codes; pages that print codes are named,
    // the ones that printed working codes most often first, and the model is told to open them all.
    expect(String(seen.req?.messages[0]?.content)).toContain(
      "Open every one of them with web_fetch before your first search; one that does not exist just fails to load: " +
        "https://www.wethrift.com/tackform https://www.wethrift.com/codes/tackform.test https://us.hotdeals.com/store/tackform-coupon " +
        "https://www.dontpayfull.com/at/tackform.test https://www.couponbind.com/coupons/tackform.test https://tackform.tenereteam.com/coupons " +
        "https://usa.coupert.com/coupons/tackform-test-discount-code https://dealhack.com/coupons/tackform",
    );
    expect(seen.req?.system).toContain("open every one of them with web_fetch before your first search");
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
      // This fake replays the same stream on every call; the follow-up is tested on its own.
      { followUp: false },
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
// listed page the model never opened in three runs.
describe("listed pages the search skipped", () => {
  const listedFor = async (store: string): Promise<string[]> => {
    const { likelyCodePages } = await import("../../src/coupons/codes");
    const { identifyMerchant } = await import("../../src/coupons/merchant");
    return likelyCodePages(identifyMerchant("https://" + store + "/"));
  };

  it("opens them in one follow-up, without searching, and verifies the codes read there", async () => {
    const reqs: ChatRequest[] = [];
    const p: ProviderClient = {
      id: "anthropic",
      async *stream(req) {
        reqs.push(req);
        if (!String(req.messages[0]?.content).includes("You did not open these pages")) {
          yield { type: "fetch", url: "https://wethrift.com/tackform/", ok: true, chars: 1200 };
          yield { type: "source", url: "https://www.wethrift.com/tackform", title: "Tackform", page: "No Tackform codes right now." };
          yield { type: "fetch", url: "https://www.dealdrop.com/tackform", ok: true, chars: 1200 };
          yield { type: "text", delta: "NONE\n" };
          return;
        }
        yield { type: "fetch", url: "https://www.couponbind.com/coupons/tackform.test", ok: true, chars: 1200 };
        yield { type: "source", url: "https://www.couponbind.com/coupons/tackform.test", title: "Tackform codes", page: "STREETDEALX: 10% off at Tackform" };
        yield { type: "text", delta: 'STREETDEALX | https://www.couponbind.com/coupons/tackform.test | "STREETDEALX: 10% off" | -\n' };
      },
    };
    const r = await suggestCodes(p, "m", "www.tackform.test");
    const listed = await listedFor("www.tackform.test");
    expect(reqs).toHaveLength(2);
    // Every fetch the model asked for, with what the page answered, for the run trace.
    expect(r.pages).toEqual([
      { url: "https://wethrift.com/tackform/", ok: true, chars: 1200 },
      { url: "https://www.dealdrop.com/tackform", ok: true, chars: 1200 },
      { url: "https://www.couponbind.com/coupons/tackform.test", ok: true, chars: 1200 },
    ]);
    expect(r.ignored).toBe(0);
    expect(reqs[0]).toMatchObject({ webFetch: true, webSearchMaxUses: 10, webFetchMaxUses: 10 });
    // Only the listed pages not opened (wethrift.com/tackform was, with or without "www." and a slash).
    expect(reqs[1]).toMatchObject({ webFetch: true, webSearchMaxUses: 1, webFetchMaxUses: listed.length - 1 });
    const asked = String(reqs[1]?.messages[0]?.content).split("You did not open these pages")[1] ?? "";
    expect(asked).toContain("Do not search");
    expect(asked).toContain("https://www.couponbind.com/coupons/tackform.test");
    expect(asked).not.toContain("https://www.wethrift.com/tackform ");
    expect(r.followedUp).toBe(true);
    expect(r.pagesListed).toBe(listed.length);
    expect(r.pagesOpened).toBe(2);
    expect(r.error).toBeUndefined();
    expect(r.codes.map((c) => [c.code, c.origin])).toEqual([["STREETDEALX", "verified"]]);
  });

  it("runs no follow-up on a provider without a page fetch tool", async () => {
    let calls = 0;
    const openai: ProviderClient = {
      id: "openai",
      async *stream() {
        calls++;
        yield { type: "source", url: "https://deals.test/o" };
        yield { type: "text", delta: "OPEN10 | https://deals.test/o\n" };
      },
    };
    const r = await suggestCodes(openai, "m", "www.tackform.test");
    expect(calls).toBe(1);
    expect(r.followedUp).toBeUndefined();
    expect(r.codes.map((c) => c.code)).toEqual(["OPEN10"]);
  });

  it("runs no follow-up when every listed page was opened, nor after a failed search", async () => {
    const listed = await listedFor("www.tackform.test");
    let calls = 0;
    const all: ProviderClient = {
      id: "anthropic",
      async *stream() {
        calls++;
        for (const u of listed) yield { type: "fetch", url: u, ok: true, chars: 900 };
        yield { type: "text", delta: "NONE\n" };
      },
    };
    const r = await suggestCodes(all, "m", "www.tackform.test");
    expect(calls).toBe(1);
    expect(r.followedUp).toBeUndefined();
    expect(r.pagesOpened).toBe(listed.length);
    let failed = 0;
    const broke: ProviderClient = {
      id: "anthropic",
      async *stream() {
        failed++;
        throw new ProviderError("anthropic", "no_credit");
      },
    };
    const r2 = await suggestCodes(broke, "m", "www.tackform.test");
    expect(failed).toBe(1);
    expect(r2.error?.code).toBe("no_credit");
  });

  it("a follow-up that runs out of time keeps what the search found and is not an error", async () => {
    const p: ProviderClient = {
      id: "anthropic",
      async *stream(req) {
        if (String(req.messages[0]?.content).includes("You did not open these pages")) {
          await new Promise((_res, rej) => req.signal?.addEventListener("abort", () => rej(new ProviderError("anthropic", "network"))));
          return;
        }
        yield { type: "source", url: "https://deals.test/a", page: "FIRST10 10% off" };
        yield { type: "text", delta: "FIRST10 | https://deals.test/a\n" };
      },
    };
    const r = await suggestCodes(p, "m", "www.tackform.test", undefined, { followUpTimeoutMs: 20 });
    expect(r.followedUp).toBe(true);
    expect(r.error).toBeUndefined();
    expect(r.codes.map((c) => c.code)).toEqual(["FIRST10"]);
  });
});
