import { describe, expect, it } from "vitest";
import { STANDALONE_PATH, isStandalone, openStandalone } from "../../src/panel/standalone";

describe("standalone Scout page", () => {
  it("is recognised only by its own address", () => {
    expect(isStandalone("?view=page")).toBe(true);
    expect(isStandalone("")).toBe(false);
    expect(isStandalone("?view=panel")).toBe(false);
  });

  it("opens the extension's page in a new active tab", async () => {
    const opened: Array<{ url: string; active?: boolean }> = [];
    const ok = await openStandalone({
      runtime: { getURL: (p) => "safari-web-extension://abc/" + p },
      tabs: { create: async (props) => void opened.push(props) },
    });
    expect(ok).toBe(true);
    expect(opened).toEqual([{ url: "safari-web-extension://abc/" + STANDALONE_PATH, active: true }]);
  });

  it("reports a refusal instead of throwing", async () => {
    expect(await openStandalone({})).toBe(false);
    expect(await openStandalone({ runtime: { getURL: (p) => p }, tabs: { create: async () => Promise.reject(new Error("no")) } })).toBe(false);
  });
});
