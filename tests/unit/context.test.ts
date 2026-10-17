// Part 2 page context (spec 6): cleaning, redaction, time limits, blocklist
// checked before anything runs in a tab. Synthetic data only.
import { describe, expect, it } from "vitest";
import { cleanUrl, redactSecrets, REDACTED, toPageContext } from "../../src/context/clean";
import { readTab, readTabs, type GatherDeps, type TabRef } from "../../src/context/gather";
import { parsePageAccess } from "../../src/permissions/gate";

describe("cleanUrl", () => {
  it("removes user info and secret query and fragment values", () => {
    const u = cleanUrl("https://user:pw@shop.test/cb?code=abc123&page=2&access_token=t0k#id_token=xyz&state=s");
    expect(u).not.toContain("abc123");
    expect(u).not.toContain("t0k");
    expect(u).not.toContain("xyz");
    expect(u).not.toContain("user:pw");
    expect(u).toContain("page=2");
  });

  it("leaves ordinary URLs alone", () => {
    expect(cleanUrl("https://news.test/a?id=5#top")).toBe("https://news.test/a?id=5#top");
  });
});

describe("redactSecrets", () => {
  it("removes keys, tokens and private keys from page text", () => {
    const text = [
      "Your key: sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUV",
      "Session eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
      "Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345",
      "AWS AKIAABCDEFGHIJKLMNOP",
      "-----BEGIN PRIVATE KEY-----\nMIIEv\n-----END PRIVATE KEY-----",
      "See https://app.test/reset?token=secret-value&lang=en",
    ].join("\n");
    const out = redactSecrets(text);
    for (const secret of ["ABCDEFGHIJKLMNOPQRSTUV", "dozjgNryP4J3", "abcdefghijklmnopqrstuvwxyz012345", "AKIAABCDEFGHIJKLMNOP", "MIIEv", "secret-value"]) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain("Bearer " + REDACTED);
    expect(out).toContain("lang=en");
  });

  it("keeps normal prose and prices", () => {
    const text = "The widget costs $10. Order code ABC-123 ships Monday.";
    expect(redactSecrets(text)).toBe(text);
  });
});

describe("toPageContext", () => {
  it("adds a metadata header, cleans the URL, and reports truncation", () => {
    const got = toPageContext(
      { url: "https://news.test/a?session=s1", title: "Story", text: "Body text.", meta: { description: "A story", lang: "en" }, truncated: true },
      1000,
    );
    expect(got?.partial).toBe(true);
    expect(got?.page.url).not.toContain("s1");
    expect(got?.page.text).toBe("Description: A story\nLanguage: en\n\nBody text.");
  });

  it("caps the text and rejects anything that is not a page", () => {
    expect(toPageContext({ url: "https://x.test", title: "", text: "x".repeat(50) }, 10)?.page.text).toHaveLength(10);
    expect(toPageContext(null)).toBeNull();
    expect(toPageContext({ title: "no url" })).toBeNull();
  });
});

function fakeTabs(tabs: TabRef[], pages: Record<number, unknown>, opts: { delay?: Record<number, number> } = {}): GatherDeps & { ran: number[] } {
  const ran: number[] = [];
  return {
    ran,
    tab: async (id) => tabs.find((t) => t.id === id) ?? null,
    extract: (id) => {
      ran.push(id);
      const ms = opts.delay?.[id] ?? 0;
      return new Promise((resolve) => setTimeout(() => resolve(pages[id]), ms));
    },
    access: parsePageAccess({ blocked: ["bank.test"] }),
    admin: [],
  };
}

const TABS: TabRef[] = [
  { id: 1, url: "https://shop.test/a", title: "Shop" },
  { id: 2, url: "https://bank.test/account", title: "Bank" },
  { id: 3, url: "https://slow.test/", title: "Slow" },
  { id: 4, url: "", title: "Unknown" },
];
const PAGES = {
  1: { url: "https://shop.test/a", title: "Shop", text: "Widget $10" },
  2: { url: "https://bank.test/account", title: "Bank", text: "Balance 100" },
  3: { url: "https://slow.test/", title: "Slow", text: "late" },
};

describe("readTab", () => {
  it("never runs anything in a blocked tab", async () => {
    const deps = fakeTabs(TABS, PAGES);
    const r = await readTab(2, deps);
    expect(r.shared.status).toBe("blocked");
    expect(r.page).toBeUndefined();
    expect(deps.ran).toEqual([]);
  });

  it("does not read a tab whose address is unknown", async () => {
    const deps = fakeTabs(TABS, PAGES);
    expect((await readTab(4, deps)).shared.status).toBe("failed");
    expect(deps.ran).toEqual([]);
  });

  it("drops a page that navigated to a blocked site while reading", async () => {
    const deps = fakeTabs(TABS, { 1: { url: "https://bank.test/", title: "Bank", text: "Balance" } });
    const r = await readTab(1, deps);
    expect(r.shared.status).toBe("blocked");
    expect(r.page).toBeUndefined();
  });

  it("times out a slow page after the per-page limit", async () => {
    const deps = fakeTabs(TABS, PAGES, { delay: { 3: 200 } });
    expect((await readTab(3, deps, 20)).shared.status).toBe("timeout");
  });
});

describe("readTabs", () => {
  it("returns what came back in time, in order, with a status per tab", async () => {
    const deps = fakeTabs(TABS, PAGES, { delay: { 3: 300 } });
    const out = await readTabs([1, 2, 3], deps, { pageMs: 1000, totalMs: 50 });
    expect(out.map((r) => r.shared.status)).toEqual(["read", "blocked", "timeout"]);
    expect(out[0]?.page?.text).toBe("Widget $10");
  });
});
