// Owner report 2026-10-16: on a Shopify checkout (tackform.com) Find coupons
// failed although coupon sites list codes saving 10% or more. Causes: a failed
// or paused web search ended the run before any code was tried, the code list
// came in Markdown the parser dropped, and codes the store advertises itself
// were never read. Synthetic stores, codes and pages only.
import { describe, expect, it } from "vitest";
import { parseFindings, suggestCodes } from "../../src/coupons/codes";
import { codesInText } from "../../src/coupons/store";
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
  const seen = new Set(["https://deals.test/a"]);

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
    expect(parseFindings(text, seen).found).toEqual(
      ["SAVE10", "TAKE15", "CYBER20", "VETS15", "MD20", "LABOR15"].map((code) => ({ code, origin: "sourced", sourceUrl: "https://deals.test/a" })),
    );
  });

  it("still reads hints in Markdown", () => {
    expect(parseFindings("**HINT** | 15% | [site](https://deals.test/h)", seen).hints).toEqual([{ percent: 15, url: "https://deals.test/h" }]);
  });
});

describe("codesInText", () => {
  it("finds codes a store advertises", () => {
    expect(codesInText("Fall sale! Use code TACO10 for 10% off. Promo code: SAVE-15 · enter WELCOME5 at checkout")).toEqual(["TACO10", "SAVE-15", "WELCOME5"]);
    expect(codesInText("USE CODE CYBERTACK FOR 20% OFF")).toEqual(["CYBERTACK"]);
  });

  it("ignores ordinary words, form labels, and numbers", () => {
    expect(codesInText("Discount code or gift card. Apply. Use code at checkout. ZIP code 80202. Enter code APPLY. Promo code: USD")).toEqual([]);
  });
});

describe("suggestCodes when the search does not finish", () => {
  it("keeps the codes found before an error and says why", async () => {
    const r = await suggestCodes(
      provider([{ type: "source", url: "https://deals.test/a" }, { type: "text", delta: "SAVE10 | https://deals.test/a\n" }], new ProviderError("anthropic", "rate_limited", 429)),
      "m",
      "www.shop.test",
    );
    expect(r.error).toEqual({ code: "rate_limited", message: "The web search failed. The provider is rate limiting requests. Wait a moment and try again." });
    expect(r.codes[0]).toEqual({ code: "SAVE10", origin: "sourced", sourceUrl: "https://deals.test/a" });
    expect(r.codes.some((c) => c.origin === "pattern")).toBe(true);
  });

  it("never throws on a rejected key; guesses are still returned", async () => {
    const r = await suggestCodes(provider([], new ProviderError("anthropic", "auth_invalid", 401)), "m", "www.shop.test");
    expect(r.error?.code).toBe("auth_invalid");
    expect(r.found).toBe(0);
    expect(r.codes[0]).toEqual({ code: "SHOP10", origin: "pattern" });
  });

  it("stops a search that takes too long and keeps what came before", async () => {
    const slow: ProviderClient = {
      id: "anthropic",
      async *stream(req) {
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
});

describe("suggestCodes request and citations", () => {
  it("names the store and asks for each code as soon as it is seen", async () => {
    const seen: { req?: ChatRequest } = {};
    await suggestCodes(provider([], undefined, seen), "m", "www.tackform.test");
    expect(String(seen.req?.messages[0]?.content)).toContain("Store: tackform\nStore website: www.tackform.test");
    expect(seen.req?.system).toContain("as soon as you see it");
  });

  it("adds codes quoted in citations as sourced, from page text rather than the model", async () => {
    const r = await suggestCodes(provider([{ type: "source", url: "https://deals.test/c", text: "Use code CYBER20 for 20% off sitewide" }, { type: "text", delta: "NONE" }]), "m", "www.shop.test");
    expect(r.codes[0]).toEqual({ code: "CYBER20", origin: "sourced", sourceUrl: "https://deals.test/c" });
  });
});
