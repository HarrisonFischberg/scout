// Part 3 Scout mode permissions (spec 10): defaults, "Always allow" sites, where a task may start.
import { describe, expect, it } from "vitest";
import { parsePageAccess, blockedBy } from "../../src/permissions/gate";
import {
  alwaysAllowed,
  DEFAULT_SCOUT_ACCESS,
  loadScoutAccess,
  parseScoutAccess,
  refusalText,
  saveScoutAccess,
  SCOUT_ACCESS_KEY,
  taskRefusal,
  withAlwaysAllow,
  withoutAlwaysAllow,
} from "../../src/scout/permissions";

describe("scout access", () => {
  it("defaults to asking per task with no always-allowed sites", () => {
    expect(parseScoutAccess(undefined)).toEqual(DEFAULT_SCOUT_ACCESS);
    expect(DEFAULT_SCOUT_ACCESS).toEqual({ mode: "ask", alwaysAllow: {} });
  });

  it("drops malformed stored values", () => {
    const a = parseScoutAccess({ mode: "always", alwaysAllow: { "Shop.Test": ["purchase", "fly"], "not a host": ["send"], x: "send" } });
    expect(a.mode).toBe("ask");
    expect(a.alwaysAllow).toEqual({ "shop.test": ["purchase"] });
    expect(parseScoutAccess({ mode: "off" }).mode).toBe("off");
  });

  it("round-trips through storage", async () => {
    const store: Record<string, unknown> = {};
    const storage = { get: async (k: string | string[]) => Object.fromEntries([k].flat().map((x) => [x, store[x]])), set: async (i: Record<string, unknown>) => void Object.assign(store, i) };
    await saveScoutAccess(storage, withAlwaysAllow(parseScoutAccess(undefined), "https://shop.test/a", "submit"));
    expect(store[SCOUT_ACCESS_KEY]).toEqual({ mode: "ask", alwaysAllow: { "shop.test": ["submit"] } });
    expect(await loadScoutAccess(storage)).toEqual({ mode: "ask", alwaysAllow: { "shop.test": ["submit"] } });
    expect(await loadScoutAccess(undefined)).toEqual(DEFAULT_SCOUT_ACCESS);
  });
});

describe("always allow", () => {
  const a = withAlwaysAllow(withAlwaysAllow(parseScoutAccess(undefined), "https://shop.test/x", "purchase"), "https://shop.test/y", "send");

  it("covers the site and its subdomains for the allowed kinds only", () => {
    expect(a.alwaysAllow).toEqual({ "shop.test": ["purchase", "send"] });
    expect(alwaysAllowed("https://shop.test/checkout", "purchase", a)).toBe(true);
    expect(alwaysAllowed("https://www.shop.test/", "send", a)).toBe(true);
    expect(alwaysAllowed("https://shop.test/", "delete", a)).toBe(false);
    expect(alwaysAllowed("https://notshop.test/", "purchase", a)).toBe(false);
    expect(alwaysAllowed("file:///x", "purchase", a)).toBe(false);
  });

  it("can be revoked per site", () => {
    expect(withoutAlwaysAllow(a, "shop.test").alwaysAllow).toEqual({});
    expect(withoutAlwaysAllow(a, "other.test")).toEqual(a);
  });
});

describe("taskRefusal", () => {
  const page = parsePageAccess({ blocked: ["bank.test"] });
  const blocked = (url: string) => blockedBy(url, page, ["corp.test"]);
  const access = parseScoutAccess(undefined);

  it("refuses Private Browsing, blocked sites, non-web pages and Scout mode off", () => {
    expect(taskRefusal({ url: "https://shop.test/", incognito: true }, access, blocked)).toBe("private");
    expect(taskRefusal({ url: "https://bank.test/" }, access, blocked)).toBe("blocked");
    expect(taskRefusal({ url: "https://hr.corp.test/" }, access, blocked)).toBe("admin");
    expect(taskRefusal({ url: "about:blank" }, access, blocked)).toBe("not_web");
    expect(taskRefusal({ url: "https://shop.test/" }, { ...access, mode: "off" }, blocked)).toBe("off");
    expect(taskRefusal({ url: "https://shop.test/" }, access, blocked)).toBeNull();
  });

  it("explains each refusal", () => {
    for (const r of ["private", "blocked", "admin", "not_web", "off"] as const) expect(refusalText(r)).toMatch(/Scout|block|web/);
    expect(refusalText("private")).toBe("Scout mode is off in Private Browsing.");
  });
});
