// App Store Connect rejects a Safari web extension whose manifest description
// is missing or longer than 112 characters (seen on the first TestFlight upload).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync(new URL("../../src/manifest.json", import.meta.url), "utf8"));

describe("manifest", () => {
  it("has a description App Store Connect accepts", () => {
    expect(typeof manifest.description).toBe("string");
    expect(manifest.description.length).toBeGreaterThan(0);
    expect(manifest.description.length).toBeLessThanOrEqual(112);
  });
});
