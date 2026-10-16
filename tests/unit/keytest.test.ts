import { describe, expect, it } from "vitest";
import { checkKey, looksLikeKey } from "../../src/providers/keytest";

describe("checkKey", () => {
  it("calls the provider's model list with the right auth and maps statuses", async () => {
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    const ok = async (url: string, init: RequestInit) => {
      seen.push({ url, headers: init.headers as Record<string, string> });
      return new Response("{}", { status: 200 });
    };
    expect(await checkKey("anthropic", "sk-ant-test-synthetic-0000000000", ok)).toBe("valid");
    expect(seen[0]!.url).toBe("https://api.anthropic.com/v1/models?limit=1");
    expect(seen[0]!.headers["x-api-key"]).toBe("sk-ant-test-synthetic-0000000000");
    expect(seen[0]!.headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
    expect(await checkKey("openai", "sk-test-synthetic-000000000000", ok)).toBe("valid");
    expect(seen[1]!.headers.authorization).toBe("Bearer sk-test-synthetic-000000000000");
  });

  it("reports invalid on 401/403, network otherwise, and never sends an empty key", async () => {
    let calls = 0;
    const status = (s: number) => async () => {
      calls++;
      return new Response("{}", { status: s });
    };
    expect(await checkKey("anthropic", "k", status(401))).toBe("invalid");
    expect(await checkKey("openai", "k", status(403))).toBe("invalid");
    expect(await checkKey("openai", "k", status(500))).toBe("network");
    expect(await checkKey("openai", "k", async () => Promise.reject(new Error("offline")))).toBe("network");
    const before = calls;
    expect(await checkKey("openai", "   ", status(200))).toBe("invalid");
    expect(calls).toBe(before);
  });
});

describe("looksLikeKey", () => {
  it("accepts plausible keys and rejects obvious paste mistakes", () => {
    expect(looksLikeKey("anthropic", "sk-ant-api03-" + "x".repeat(20))).toBe(true);
    expect(looksLikeKey("anthropic", "sk-proj-" + "x".repeat(20))).toBe(false);
    expect(looksLikeKey("openai", "sk-proj-" + "x".repeat(20))).toBe(true);
    expect(looksLikeKey("openai", "sk-proj- with spaces xxxxxxxxxxxx")).toBe(false);
    expect(looksLikeKey("openai", "short")).toBe(false);
  });
});
