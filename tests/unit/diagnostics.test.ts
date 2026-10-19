import { describe, expect, it } from "vitest";
import { buildReport, describeBrowser, Diagnostics, DIAG_KEY, MAX_RUNS, scrub } from "../../src/diagnostics";
import type { StorageArea } from "../../src/settings/settings";

function memStore(): StorageArea & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: async (k: string | string[]) => {
      const keys = Array.isArray(k) ? k : [k];
      return Object.fromEntries(keys.filter((x) => x in data).map((x) => [x, structuredClone(data[x])]));
    },
    set: async (items: Record<string, unknown>) => void Object.assign(data, structuredClone(items)),
    clear: async () => {
      for (const k of Object.keys(data)) delete data[k];
    },
  };
}

const ENV = { version: "0.1.0", build: "debug" as const, browser: "Safari 27 on macOS" };

describe("scrub", () => {
  it("removes keys, emails, and URL paths", () => {
    const out = scrub("key sk-ant-api03-abcdefgh1234 for ada@example.test at https://shop.test/cart?id=9");
    expect(out).toBe("key [key] for [email] at shop.test");
  });

  it("caps length", () => {
    expect(scrub("x".repeat(1000)).length).toBe(300);
  });
});

describe("Diagnostics", () => {
  it("records stages, errors, outcome and persists them", async () => {
    let t = 1000;
    const store = memStore();
    const d = new Diagnostics(store, () => t);
    await d.load();
    const run = d.start("agent", { provider: "anthropic", model: "claude-sonnet-5-5", question: "Fill the form" });
    run.page("https://shop.test/checkout?session=secret");
    t = 1250;
    run.stage("snapshot:start 1");
    run.error("Could not read the page.");
    run.finish("error", "Could not read the page.", { inputTokens: 10, outputTokens: 2 });

    const saved = (store.data[DIAG_KEY] as { runs: Array<Record<string, unknown>> }).runs[0]!;
    expect(saved.pageHost).toBe("shop.test");
    expect(saved.question).toBeUndefined(); // not opted in
    expect(saved.events).toEqual([{ t: 250, stage: "snapshot:start 1" }]);
    expect(saved.outcome).toEqual({ status: "error", message: "Could not read the page." });

    const again = new Diagnostics(store);
    await again.load();
    expect(again.runs).toHaveLength(1);
  });

  it("records the question only after opt-in, and forgets it on opt-out", async () => {
    const d = new Diagnostics(memStore());
    await d.setIncludeQuestion(true);
    d.start("ask", { question: "What is the total? my email is ada@example.test" });
    expect(d.runs[0]!.question).toBe("What is the total? my email is [email]");
    await d.setIncludeQuestion(false);
    expect(d.runs[0]!.question).toBeUndefined();
  });

  it(`keeps only the last ${MAX_RUNS} runs`, () => {
    const d = new Diagnostics(undefined);
    for (let i = 0; i < MAX_RUNS + 3; i++) d.start("ask");
    expect(d.runs).toHaveLength(MAX_RUNS);
    expect(d.runs[0]!.id).toBe(4);
  });

  it("clear empties the runs", async () => {
    const store = memStore();
    const d = new Diagnostics(store);
    d.start("ask");
    await d.clear();
    expect(d.runs).toHaveLength(0);
  });
});

describe("buildReport", () => {
  it("formats the latest run as Actual behavior with a timeline", () => {
    const d = new Diagnostics(undefined, () => 0);
    d.start("ask", { provider: "anthropic", model: "m" }).finish("done", "ok");
    const r = d.start("agent", { provider: "anthropic", model: "claude-sonnet-5-5" });
    r.page("https://127.0.0.1:4318/forms.html");
    r.stage("snapshot:start 1");
    r.finish("error", "Could not read the page.");
    const text = buildReport(d.runs, ENV);
    expect(text).toContain("## Scout for Safari diagnostics — Actual behavior");
    expect(text).toContain("- Run: agent (#2)");
    expect(text).toContain('- Outcome: error — "Could not read the page."');
    expect(text).toContain("- Page: 127.0.0.1");
    expect(text).toContain("+0.00s  snapshot:start 1");
    expect(text).toContain("- #1 ask at");
    expect(text).toContain("not recorded (opt in under Diagnostics)");
  });

  // Owner report 2026-10-19 (run #227): opening the panel to copy the report
  // started a run of its own, and the coupon run was only listed below it.
  it("shows the latest run that is more than a quiet panel opening", () => {
    const d = new Diagnostics(undefined, () => 0);
    const c = d.start("coupons", { provider: "anthropic", model: "m" });
    c.stage("coupons:attempt 1 rejected expired from wethrift.com");
    c.finish("done", "No code lowered the total.");
    d.start("startup").finish("ready", "Ready.");
    d.start("startup").finish("ready", "Ready.");
    const text = buildReport(d.runs, ENV);
    expect(text).toContain("- Run: coupons (#1)");
    expect(text).toContain("coupons:attempt 1 rejected expired from wethrift.com");
    expect(text).toContain("### Other runs");
    expect(text).toContain("- #3 startup at");
    // A panel opening that went wrong is still the one shown.
    d.start("startup").finish("error", "No key.");
    expect(buildReport(d.runs, ENV)).toContain("- Run: startup (#4)");
  });

  it("says when nothing has been recorded", () => {
    expect(buildReport([], ENV)).toContain("No runs recorded yet.");
  });

  it("marks a run that never finished", () => {
    const d = new Diagnostics(undefined);
    d.start("agent").stage("snapshot:start 1");
    expect(buildReport(d.runs, ENV)).toContain("did not finish (popup closed or still running)");
  });
});

describe("describeBrowser", () => {
  it("reads Safari version and OS from the user agent", () => {
    expect(
      describeBrowser("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15"),
    ).toBe("Safari 27.0 on macOS");
    expect(
      describeBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1"),
    ).toBe("Safari 27.0 on iOS");
  });
});
