// Part 2 permission gate (spec 10a): blocklists, screenshots per site, defaults.
import { describe, expect, it } from "vitest";
import {
  alwaysAllowed,
  blockedBy,
  DEFAULT_PAGE_ACCESS,
  normalizeSite,
  parsePageAccess,
  parsePolicy,
  screenshotDecision,
  taskDecision,
  withAlwaysAllow,
  withoutAlwaysAllow,
} from "../../src/permissions/gate";

describe("page access defaults", () => {
  it("reads the current page, keeps history search off, and blocks nothing", () => {
    expect(parsePageAccess(undefined)).toEqual(DEFAULT_PAGE_ACCESS);
    expect(DEFAULT_PAGE_ACCESS).toEqual({ readCurrent: true, searchTabs: false, screenshots: {}, blocked: [], scoutMode: "ask", alwaysAllow: {} });
  });

  it("treats malformed stored values as defaults and drops bad rules", () => {
    const a = parsePageAccess({ readCurrent: "yes", searchTabs: 1, screenshots: { "bank.test": "always", "x": "maybe" }, blocked: ["Bank.Test", 5, "not a host"] });
    expect(a.readCurrent).toBe(true);
    expect(a.searchTabs).toBe(false);
    expect(a.screenshots).toEqual({ "bank.test": "always" });
    expect(a.blocked).toEqual(["bank.test"]);
  });
});

describe("normalizeSite", () => {
  it("accepts hosts, URLs and wildcards and lowercases them", () => {
    expect(normalizeSite("https://www.Example.com/path?q=1")).toBe("www.example.com");
    expect(normalizeSite("*.example.com")).toBe("example.com");
    expect(normalizeSite(" example.com ")).toBe("example.com");
    expect(normalizeSite("localhost")).toBe("localhost");
  });

  it("rejects things that are not hosts", () => {
    expect(normalizeSite("")).toBeNull();
    expect(normalizeSite("not a host")).toBeNull();
    expect(normalizeSite("intranet")).toBeNull();
    expect(normalizeSite("ftp://files.example.com")).toBeNull();
  });
});

describe("blockedBy", () => {
  const access = parsePageAccess({ blocked: ["bank.test"] });

  it("blocks the site and its subdomains, not look-alikes", () => {
    expect(blockedBy("https://bank.test/login", access, [])).toBe("user");
    expect(blockedBy("https://online.bank.test/", access, [])).toBe("user");
    expect(blockedBy("https://notbank.test/", access, [])).toBeNull();
  });

  it("reports the organization list first", () => {
    expect(blockedBy("https://hr.corp.test/", access, ["corp.test"])).toBe("admin");
  });

  it("never allows non-web pages", () => {
    expect(blockedBy("file:///etc/passwd", access, [])).toBe("user");
    expect(blockedBy("safari-web-extension://x/popup.html", access, [])).toBe("user");
  });
});

describe("screenshotDecision", () => {
  it("asks by default, follows a saved answer, and refuses blocked sites", () => {
    const a = parsePageAccess({ screenshots: { "charts.test": "always", "mail.test": "never" }, blocked: ["bank.test"] });
    expect(screenshotDecision("https://news.test/", a, [])).toBe("ask");
    expect(screenshotDecision("https://charts.test/x", a, [])).toBe("allow");
    expect(screenshotDecision("https://mail.test/", a, [])).toBe("deny");
    expect(screenshotDecision("https://bank.test/", parsePageAccess({ ...a, screenshots: { "bank.test": "always" } }), [])).toBe("deny");
    expect(screenshotDecision("https://charts.test/", a, ["charts.test"])).toBe("deny");
  });
});

describe("parsePolicy", () => {
  it("reads the host app's managed blocklist and ignores anything else", () => {
    expect(parsePolicy({ ok: true, blocked: ["Corp.test", "bad host", 3] })).toEqual(["corp.test"]);
    expect(parsePolicy({ ok: false, error: "unknown_type" })).toEqual([]);
    expect(parsePolicy(null)).toEqual([]);
  });
});

// Part 3 (spec 10): Scout mode per task, "Always allow" sites, revocation.
describe("Scout mode gate", () => {
  it("asks per task by default, is off when turned off, and never acts on a blocked site", () => {
    const a = parsePageAccess({ blocked: ["bank.test"] });
    expect(a.scoutMode).toBe("ask");
    expect(taskDecision("https://shop.test/cart", a, [])).toBe("ask");
    expect(taskDecision("https://bank.test/", a, [])).toBe("blocked-user");
    expect(taskDecision("https://hr.corp.test/", a, ["corp.test"])).toBe("blocked-admin");
    expect(taskDecision("https://shop.test/", parsePageAccess({ scoutMode: "off" }), [])).toBe("off");
    expect(taskDecision("file:///x", a, [])).toBe("blocked-user");
  });

  it("parses only known kinds and hosts for always-allow, and has no switch for the confirmation itself", () => {
    const a = parsePageAccess({ alwaysAllow: { "Shop.Test": ["payment", "bogus"], "not a host": ["send"], "x.test": [] }, sensitiveConfirm: false });
    expect(a.alwaysAllow).toEqual({ "shop.test": ["payment"] });
    expect(Object.keys(a)).not.toContain("sensitiveConfirm");
  });

  it("always-allow is per site and per kind, covers subdomains, and can be revoked", () => {
    let a = withAlwaysAllow(DEFAULT_PAGE_ACCESS, "www.shop.test", "payment");
    expect(alwaysAllowed("https://www.shop.test/checkout", "payment", a)).toBe(true);
    expect(alwaysAllowed("https://m.www.shop.test/checkout", "payment", a)).toBe(true);
    expect(alwaysAllowed("https://www.shop.test/checkout", "send", a)).toBe(false);
    expect(alwaysAllowed("https://other.test/", "payment", a)).toBe(false);
    a = withAlwaysAllow(a, "www.shop.test", "send");
    expect(a.alwaysAllow["www.shop.test"]).toEqual(["payment", "send"]);
    a = withoutAlwaysAllow(a, "www.shop.test");
    expect(alwaysAllowed("https://www.shop.test/", "payment", a)).toBe(false);
    expect(withAlwaysAllow(a, "???", "payment")).toEqual(a);
  });
});
