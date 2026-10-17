// Part 2 permission gate (spec 10a): blocklists, screenshots per site, defaults.
import { describe, expect, it } from "vitest";
import {
  blockedBy,
  DEFAULT_PAGE_ACCESS,
  normalizeSite,
  parsePageAccess,
  parsePolicy,
  screenshotDecision,
} from "../../src/permissions/gate";

describe("page access defaults", () => {
  it("reads the current page, keeps history search off, and blocks nothing", () => {
    expect(parsePageAccess(undefined)).toEqual(DEFAULT_PAGE_ACCESS);
    expect(DEFAULT_PAGE_ACCESS).toEqual({ readCurrent: true, searchTabs: false, screenshots: {}, blocked: [] });
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
