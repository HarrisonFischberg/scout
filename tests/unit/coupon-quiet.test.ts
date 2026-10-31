// Quiet page reading (owner's choice "Quiet only", 2026-10-19): coupon pages
// the reader could not load are downloaded and read without opening a tab.
// Synthetic pages and codes only; fetch is a fake.
import { describe, expect, it } from "vitest";
import { browserRead } from "../../src/coupons/browser-read";
import { htmlSnapshot, isPublicWebUrl, jsonCodes, parseHtml, quietPages } from "../../src/coupons/quiet-read";

const FILLER = "<p>Synthetic Shop coupons and promo codes, updated today.</p>".repeat(6);

const page = (body: string, title = "Synthetic Shop coupons"): string =>
  `<!doctype html><html><head><title>${title}</title><style>.x{color:red}</style><script>var CODE="NOTME99";</script></head><body>${FILLER}${body}</body></html>`;

function fakeFetch(pages: Record<string, { status?: number; html: string; type?: string }>): { fetch: (u: string, init: RequestInit) => Promise<Response>; calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      const p = pages[url];
      if (!p) return new Response("not found", { status: 404 });
      return new Response(p.html, { status: p.status ?? 200, headers: { "content-type": p.type ?? "text/html; charset=utf-8" } });
    },
  };
}

describe("HTML to snapshot", () => {
  it("reads visible text, skips scripts, styles and hidden parts, decodes entities", () => {
    const s = htmlSnapshot(page(`<div>15% off &amp; free shipping: <b>SYNTH15</b></div><div style="display:none">HIDDEN20</div><div hidden>GONE30</div>`), "https://coupons.test/synth");
    expect(s.title).toBe("Synthetic Shop coupons");
    expect(s.text).toContain("15% off & free shipping: SYNTH15");
    expect(s.text).not.toMatch(/NOTME99|HIDDEN20|GONE30|color:red/);
  });

  it("turns codes kept in data attributes into Code lines next to their offer", () => {
    const s = htmlSnapshot(page(`<li><span>20% off first order</span><button data-clipboard-text="LATE20">Show code</button></li>`), "https://coupons.test/synth");
    expect(s.text).toMatch(/20% off first order[\s\S]*Code: LATE20/);
    expect(s.elements.some((e) => e.name.includes("Show code"))).toBe(true);
  });

  it("reads codes in embedded JSON with the nearest offer title", () => {
    const json = JSON.stringify({ props: { coupons: [{ title: "Free shipping over $50", code: "SYNTHSHIP9" }, { title: "10% off", couponCode: "TEN10OFF" }] } });
    expect(jsonCodes(json)).toEqual(["Free shipping over $50 Code: SYNTHSHIP9", "10% off Code: TEN10OFF"]);
    const s = htmlSnapshot(page(`<script id="__NEXT_DATA__" type="application/json">${json}</script>`), "https://coupons.test/synth");
    expect(s.text).toContain("Free shipping over $50 Code: SYNTHSHIP9");
  });

  it("survives broken markup", () => {
    const { root } = parseHtml("<div><p>open <b>bold</div></span><br/><img src=x>tail");
    expect(JSON.stringify(root)).toContain("tail");
  });
});

describe("quiet page browser", () => {
  const target = { url: "https://coupons.test/synth", reason: "blocked" as const };

  it("downloads the page without cookies, presses nothing and reads its codes", async () => {
    const f = fakeFetch({ [target.url]: { html: page(`<div>Use code SYNTH15 for 15% off sitewide</div><li>Free shipping<button data-code="SYNTHSHIP9">Show code</button></li>`) } });
    const b = quietPages({ fetch: f.fetch, hasAccess: async () => true });
    const r = await browserRead([target], b, { now: () => 0 });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.init.credentials).toBe("omit");
    expect(r.pages[0]).toMatchObject({ outcome: "read", clicks: [] });
    expect(r.codes.map((c) => c.code).sort()).toEqual(["SYNTH15", "SYNTHSHIP9"]);
  });

  it("skips a site Scout has no access to without downloading it", async () => {
    const f = fakeFetch({ [target.url]: { html: page("SYNTH15") } });
    const r = await browserRead([target], quietPages({ fetch: f.fetch, hasAccess: async () => false }), { now: () => 0 });
    expect(f.calls).toHaveLength(0);
    expect(r.pages[0]!.outcome).toBe("no_access");
  });

  it("reports a refused download at once instead of waiting", async () => {
    const f = fakeFetch({ [target.url]: { status: 403, html: "Forbidden" } });
    let waited = 0;
    const b = { ...quietPages({ fetch: f.fetch, hasAccess: async () => true }), wait: async () => void waited++ };
    const r = await browserRead([target], b, { now: () => 0 });
    expect(r.pages[0]!.outcome).toBe("error");
    expect(waited).toBe(0);
  });

  it("reads a short page once instead of polling it", async () => {
    const f = fakeFetch({ [target.url]: { html: "<p>Just a moment</p>" } });
    let waited = 0;
    const b = { ...quietPages({ fetch: f.fetch, hasAccess: async () => true }), wait: async () => void waited++ };
    let t = 0;
    const r = await browserRead([target], b, { now: () => (t += 10) });
    expect(waited).toBe(0);
    expect(r.pages[0]!.outcome).toBe("timeout");
  });
});

describe("quiet reads stay on the public web", () => {
  it("accepts public http(s) pages and refuses local, private and metadata addresses", () => {
    for (const ok of ["https://coupons.test/synth", "http://www.retailmenot.com/view/x", "https://8.8.8.8/", "https://[2606:4700::1111]/"]) {
      expect(isPublicWebUrl(ok)).toBe(true);
    }
    for (const bad of [
      "http://localhost:3000/",
      "http://app.localhost/",
      "http://127.0.0.1/",
      "http://2130706433/",
      "http://0x7f.1/",
      "http://10.0.0.1/admin",
      "http://172.20.1.1/",
      "http://192.168.1.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://100.100.1.1/",
      "http://0.0.0.0/",
      "http://[::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://[fd00::1]/",
      "http://[fe80::1]/",
      "http://router/",
      "http://printer.local/",
      "http://nas.home.arpa/",
      "https://user:pw@coupons.test/",
      "file:///etc/hosts",
      "ftp://coupons.test/",
      "javascript:alert(1)",
      "not a url",
    ]) {
      expect(isPublicWebUrl(bad), bad).toBe(false);
    }
  });

  it("never downloads a private address, even with access to every site", async () => {
    const url = "http://192.168.1.1/coupons";
    const f = fakeFetch({ [url]: { html: page("Use code SYNTH15") } });
    const r = await browserRead([{ url, reason: "blocked" as const }], quietPages({ fetch: f.fetch, hasAccess: async () => true }), { now: () => 0 });
    expect(f.calls).toHaveLength(0);
    expect(r.pages[0]!.outcome).toBe("no_access");
  });

  it("drops a public page that redirected to a private address", async () => {
    const fetchFn = async (): Promise<Response> => {
      const res = new Response(page("Use code SYNTH15 for 15% off"), { headers: { "content-type": "text/html" } });
      Object.defineProperty(res, "url", { value: "http://127.0.0.1:8080/internal" });
      return res;
    };
    const r = await browserRead([{ url: "https://coupons.test/synth", reason: "blocked" as const }], quietPages({ fetch: fetchFn, hasAccess: async () => true }), { now: () => 0 });
    expect(r.pages[0]!.outcome).toBe("error");
    expect(r.codes).toHaveLength(0);
  });
});
