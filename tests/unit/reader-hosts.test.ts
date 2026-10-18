// Sites that refuse the reader, learned on the device. Synthetic sites only.
import { describe, expect, it } from "vitest";
import { browserFirstSites, countFetch, parseReaderHosts, siteOf, type ReaderHosts } from "../../src/coupons/reader-hosts";

describe("reader-refusing sites", () => {
  it("groups pages by site", () => {
    expect(siteOf("https://brand.tenereteam.test/coupons")).toBe("tenereteam.test");
    expect(siteOf("https://www.deals.test/x")).toBe("deals.test");
    expect(siteOf("https://shop.example.co.uk/a")).toBe("example.co.uk");
    expect(siteOf("http://127.0.0.1:4317/x")).toBe("");
    expect(siteOf("not a url")).toBe("");
  });

  it("sends a site to the browser first once it refused twice and more often than it loaded", () => {
    let h: ReaderHosts = {};
    h = countFetch(h, "https://a.deals.test/1", false, 1);
    expect(browserFirstSites(h)).toEqual([]);
    h = countFetch(h, "https://b.deals.test/2", false, 2);
    expect(browserFirstSites(h)).toEqual(["deals.test"]);
    h = countFetch(h, "https://deals.test/3", true, 3);
    h = countFetch(h, "https://deals.test/4", true, 4);
    expect(browserFirstSites(h)).toEqual([]);
  });

  it("keeps at most 200 sites, dropping the oldest, and ignores bad stored data", () => {
    let h: ReaderHosts = {};
    for (let i = 0; i < 205; i++) h = countFetch(h, "https://s" + i + ".test/", false, i);
    expect(Object.keys(h)).toHaveLength(200);
    expect(h["s0.test"]).toBeUndefined();
    expect(parseReaderHosts({ "a.test": { refused: 2, ok: 0, at: 1 }, bad: { refused: "x" }, n: null })).toEqual({ "a.test": { refused: 2, ok: 0, at: 1 } });
    expect(parseReaderHosts("junk")).toEqual({});
  });
});
