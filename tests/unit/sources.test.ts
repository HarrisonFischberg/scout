// Answer sources (owner items 10 and 12): chip names, copied text, saved URLs.
import { describe, expect, it } from "vitest";
import { parseInline } from "../../src/chat/markdown";
import { answerText, displayHost, savedUrl, siteName } from "../../src/chat/sources";

describe("answer sources", () => {
  it("names a site by its registrable name", () => {
    expect(siteName("https://www.amazon.com/s?k=moleskin")).toBe("amazon");
    expect(siteName("https://www.lepage.ca/en/diy")).toBe("lepage");
    expect(siteName("https://shop.bbc.co.uk/x")).toBe("bbc");
    expect(siteName("https://shop.test/a")).toBe("shop");
    expect(siteName("http://127.0.0.1:4317/forms.html")).toBe("127.0.0.1");
    expect(siteName("http://localhost/")).toBe("localhost");
    expect(displayHost("https://www.lepage.ca/en")).toBe("lepage.ca");
  });

  it("parses [n, m] as two citations", () => {
    expect(parseInline("Soft [1, 3].")).toEqual([
      { type: "text", text: "Soft " },
      { type: "cite", n: 1 },
      { type: "cite", n: 3 },
      { type: "text", text: "." },
    ]);
  });

  it("copies the answer with its numbered sources", () => {
    expect(answerText("Rated 4.5 [1].\n", [{ url: "https://r.test/w", title: "Reviews" }, { url: "https://x.test/" }])).toBe(
      "Rated 4.5 [1].\n\nSources:\n[1] Reviews (https://r.test/w)\n[2] https://x.test/",
    );
    expect(answerText("Hi", [])).toBe("Hi");
  });

  it("saves addresses without query or fragment", () => {
    expect(savedUrl("https://shop.test/cart?session=abc#top")).toBe("https://shop.test/cart");
    expect(savedUrl("not a url")).toBe("");
  });
});
