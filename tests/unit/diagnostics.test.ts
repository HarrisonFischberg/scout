import { describe, expect, it } from "vitest";
import { BUTTON_KEY, buildReport, describeBrowser, describeCrash, Diagnostics, DIAG_KEY, loadButtonFailures, loadCrashes, MAX_BUTTON_FAILURES, MAX_CRASHES, MAX_RUNS, parseCrashes, recordButtonFailure, recordCrash, scrub, watchCrashes } from "../../src/diagnostics";
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
    expect(text).toContain("## Scout AI Assistant diagnostics — Actual behavior");
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

  // Owner report 2026-10-19: earlier runs said "no_form (1 error)" with no
  // site or message, so it could not be told what failed or where.
  it("names the site and the error of earlier runs", () => {
    const d = new Diagnostics(undefined, () => 0);
    const c = d.start("coupons");
    c.page("https://shop.test/cart?id=9");
    c.error("No coupon box found on this page. Open the cart or checkout page first.");
    c.finish("no_form", "No coupon box found on this page.");
    d.start("ask").finish("done", "ok");
    const text = buildReport(d.runs, ENV);
    expect(text).toContain('- #1 coupons on shop.test at');
    expect(text).toContain('→ no_form (1 error: "No coupon box found on this page. Open the cart or checkout page first.")');
  });

  it("lists times the page button could not open Scout, newest first", () => {
    const d = new Diagnostics(undefined, () => 0);
    d.start("startup").finish("ready", "Ready.");
    const text = buildReport(d.runs, ENV, [
      { at: 0, reason: "Another popup is already open.", tries: 3 },
      { at: 1000, reason: "no answer from Scout: panel.open got no answer", tries: 0 },
    ]);
    expect(text).toContain("### Page button could not open Scout");
    expect(text.indexOf("no answer from Scout")).toBeLessThan(text.indexOf("Another popup"));
    expect(text).toContain('after 3 tries: "Another popup is already open."');
    expect(buildReport([], ENV, [{ at: 0, reason: "x", tries: 1 }])).toContain('after 1 try: "x"');
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

  it("tells Chrome and Firefox apart from Safari", () => {
    expect(
      describeBrowser("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"),
    ).toBe("Chrome 141 on Windows");
    expect(describeBrowser("Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:144.0) Gecko/20100101 Firefox/144.0")).toBe("Firefox 144.0 on macOS");
    expect(describeBrowser("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36")).toBe(
      "Chrome 141 on Linux",
    );
  });
});

describe("page button failures", () => {
  it("are kept scrubbed and capped in storage", async () => {
    const store = memStore();
    for (let i = 0; i < MAX_BUTTON_FAILURES + 2; i++) await recordButtonFailure(store, { at: i, reason: "failed at https://shop.test/cart?x=" + i, tries: 3 });
    const got = await loadButtonFailures(store);
    expect(got).toHaveLength(MAX_BUTTON_FAILURES);
    expect(got[got.length - 1]).toEqual({ at: MAX_BUTTON_FAILURES + 1, reason: "failed at shop.test", tries: 3 });
  });

  it("ignores malformed stored data", async () => {
    const store = memStore();
    store.data[BUTTON_KEY] = [{ at: "x" }, null, { at: 1, reason: "ok", tries: 1 }];
    expect(await loadButtonFailures(store)).toEqual([{ at: 1, reason: "ok", tries: 1 }]);
  });
});

describe("unexpected errors", () => {
  it("records crashes scrubbed, counts repeats, and keeps the last ones", async () => {
    const store = memStore();
    const err = new TypeError("bad sk-ant-api03-abcdefgh1234 at https://shop.test/x?y=1");
    err.stack = "TypeError: bad\n    at run (safari-web-extension://ABC/popup.js:120:7)\n    at go (safari-web-extension://ABC/popup.js:9:1)";
    const msg = describeCrash(err);
    expect(msg).toBe("TypeError: bad [key] at shop.test at popup.js:120 < popup.js:9");
    await recordCrash(store, { at: 1, where: "panel", message: msg });
    await recordCrash(store, { at: 2, where: "panel", message: msg });
    await recordCrash(store, { at: 3, where: "worker", message: describeCrash("plain", "safari-web-extension://ABC/background.js", 4) });
    const list = await loadCrashes(store);
    expect(list).toEqual([
      { at: 2, where: "panel", message: msg, count: 2 },
      { at: 3, where: "worker", message: "plain at background.js:4", count: 1 },
    ]);
    for (let i = 0; i < MAX_CRASHES + 5; i++) await recordCrash(store, { at: i, where: "worker", message: "e" + i });
    expect(await loadCrashes(store)).toHaveLength(MAX_CRASHES);
  });

  it("watches error and unhandledrejection events", async () => {
    const store = memStore();
    const handlers: Record<string, (e: Event) => void> = {};
    watchCrashes({ addEventListener: (t, l) => void (handlers[t] = l) }, store, "worker", () => 5);
    const boom = Object.assign(new Error("boom"), { stack: "" });
    handlers.error!({ error: boom, message: "boom" } as unknown as Event);
    await new Promise((r) => setTimeout(r, 0));
    handlers.unhandledrejection!({ reason: "nope" } as unknown as Event);
    await new Promise((r) => setTimeout(r, 0));
    const list = await loadCrashes(store);
    expect(list.map((c) => c.message)).toEqual(["Error: boom", "Unhandled rejection: nope"]);
  });

  it("drops malformed stored entries", () => {
    expect(parseCrashes([{ at: 1, where: "panel", message: "x" }, { at: "x" }, null, { at: 1, where: "elsewhere", message: "y" }])).toEqual([
      { at: 1, where: "panel", message: "x", count: 1 },
    ]);
  });
});

describe("full debug log", () => {
  it("keeps every run's steps, then unexpected errors and setup", () => {
    const d = new Diagnostics(undefined, () => 0);
    const a = d.start("agent", { provider: "anthropic", model: "m" });
    a.stage("step:ok Did: click “See all reviews”");
    a.finish("error", "Blocked by a human check.");
    d.start("startup").finish("ready", "Ready.");
    d.start("ask", { provider: "anthropic", model: "m" }).finish("done", "Answered.");
    const text = buildReport(d.runs, ENV, [], {
      crashes: [{ at: 12 * 3600_000, where: "worker", message: "TypeError: x at background.js:3", count: 3 }],
      setup: ["Surface: panel · touch", "Keys saved: Anthropic yes, OpenAI no"],
    });
    expect(text).toContain("- Run: ask (#3)");
    // The earlier agent run keeps its outcome and timeline.
    expect(text).toContain("- #1 agent at");
    expect(text).toContain('  outcome: "Blocked by a human check."');
    expect(text).toContain("+0.00s  step:ok Did: click “See all reviews”");
    // A quiet panel opening stays one line.
    expect(text).toMatch(/- #2 startup at .* → ready\n- #1/);
    expect(text).toContain("### Unexpected errors\n- 1970");
    expect(text).toContain("worker (×3): TypeError: x at background.js:3");
    expect(text).toContain("### Setup\n- Build: Scout AI Assistant 0.1.0 (debug) · Safari 27 on macOS");
    expect(text).toContain("- Keys saved: Anthropic yes, OpenAI no");
    expect(text.indexOf("### Unexpected errors")).toBeLessThan(text.indexOf("### Setup"));
  });

  it("includes setup even before any run", () => {
    expect(buildReport([], ENV, [], { setup: ["Mode: Chat"] })).toContain("### Setup");
  });
});
