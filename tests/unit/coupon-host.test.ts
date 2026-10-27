// Find coupons host in the worker (owner request 2026-10-19): the run keeps
// going with no panel open, a panel that opens later catches up with every
// event so far (including a question still waiting), Stop comes from the
// panel or the overlay in the run's own tab only, and the outcome is saved.
// Fake tab and cart, synthetic codes; no provider call leaves the test.
import { describe, expect, it } from "vitest";
import { BridgeError, checkSchema, WORKER_EVENTS } from "../../src/bridge/messages";
import type { OverlayRequest } from "../../src/content-api";
import type { CartState } from "../../src/coupons/finder";
import type { CouponPage } from "../../src/coupons/tab-page";
import { ProviderError, type ProviderClient } from "../../src/providers";
import { CouponHost, failReason, COUPON_QUESTION } from "../../src/server/coupon-host";

// The web search finds nothing: the only code is the one the store's page shows.
const quiet: ProviderClient = {
  id: "anthropic",
  async *stream() {
    yield { type: "text", delta: "NONE\n" };
  },
};

const cartPage = (opts: { hang?: boolean } = {}): CouponPage => {
  const cart: CartState = { total: 100, currency: "USD", codes: [], platform: "shopify" };
  return {
    snapshot: () =>
      opts.hang
        ? new Promise(() => undefined)
        : Promise.resolve({ url: "https://shop.test/cart", title: "Cart", text: "Total: $100.00", elements: [], truncated: false }),
    act: async (a) => ({ ok: true, action: a.type, message: "ok" }),
    cart: {
      info: async () => cart,
      // The store refuses every code.
      update: async (code) => ({ ...cart, codes: code ? [{ code, applicable: false }] : [] }),
      reload: async () => undefined,
    },
    storeCodes: async () => [{ code: "SYNTH5", context: "Use code SYNTH5 today" }],
    meta: async () => ({ title: "Synthetic Shop" }),
  };
};

function fake(page: CouponPage, blocked?: string) {
  const overlay: OverlayRequest[] = [];
  const saved: Array<{ conv: string; question: string; answer: string }> = [];
  const posted: Array<Record<string, unknown>> = [];
  const host = new CouponHost({
    provider: async () => quiet,
    page: async () => page,
    ...(blocked ? { blocked: async () => blocked } : {}),
    tabs: () => ({ open: async () => null, read: async () => null, click: async () => false, close: async () => undefined, wait: async () => undefined }),
    allowBrowser: async () => false,
    overlay: async (_tab, req) => void overlay.push(req),
    save: async (e) => void saved.push(e),
    now: () => 1000,
  });
  const port = { postMessage: (m: unknown) => void posted.push((m as { payload: Record<string, unknown> }).payload) };
  return { host, overlay, saved, posted, port };
}

const until = async (ok: () => boolean, ms = 20_000): Promise<void> => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe("coupon host", () => {
  it("keeps running with no panel open; a panel that opens later catches up, answers the waiting question, and the outcome is saved", async () => {
    const f = fake(cartPage());
    await f.host.start({ tab_id: 1, provider: "anthropic", model: "m", conv: "c1" });
    expect(f.overlay[0]).toMatchObject({ type: "overlay:show", taskId: "coupons:1", state: "running" });
    // Nobody is watching: the code is tested and the question waits, with the page still glowing.
    await until(() => !!f.host.status(1).run?.prompt_id);
    // The host never brings the panel up itself: on iPhone that left Safari unable to open it (owner report 2026-10-19).
    expect(f.overlay[f.overlay.length - 1]).toMatchObject({ type: "overlay:state", state: "waiting" });
    // The panel opens: everything so far, in order, diagnostics stages included with their time in the run.
    const run = f.host.status(1).run!;
    expect(run.done).toBe(false);
    // The run's chat, so a panel showing another chat (after New chat) leaves it there.
    expect(run.conv).toBe("c1");
    const kinds = run.events.map((e) => e.kind);
    expect(kinds).toContain("say");
    expect(kinds).toContain("attempt");
    expect(kinds[kinds.length - 1]).toBe("ask");
    const traces = run.events.filter((e) => e.kind === "trace");
    expect(traces.length).toBeGreaterThan(0);
    for (const t of traces) expect(typeof t.at_ms).toBe("number");
    // Each tested code names the site it came from.
    expect(traces.some((t) => /^coupons:attempt 1 rejected from \S+$/.test(String(t.stage)))).toBe(true);
    expect(kinds).not.toContain("page");
    expect(run.events.map((e) => e.seq)).toEqual([...run.events.map((e) => e.seq)].sort((a, b) => a - b));
    expect(run.events.find((e) => e.kind === "attempt")?.attempt).toMatchObject({ code: "SYNTH5", accepted: false });
    f.host.watch(f.port, 1);
    expect(f.host.answer({ tab_id: 1, prompt_id: "nope", more: false })).toEqual({ accepted: false });
    expect(f.host.answer({ tab_id: 1, prompt_id: run.prompt_id!, more: false })).toEqual({ accepted: true });
    await until(() => f.host.status(1).run?.done === true);
    const done = f.posted.find((e) => e.kind === "done")!;
    expect(done).toMatchObject({ tab_id: 1, tone: "assistant", outcome: "done" });
    expect(f.posted.some((e) => e.kind === "answered")).toBe(true);
    expect(f.overlay[f.overlay.length - 1]).toEqual({ type: "overlay:hide" });
    await until(() => f.saved.length === 1);
    expect(f.saved[0]).toMatchObject({ conv: "c1", question: COUPON_QUESTION, answer: done.summary });
  }, 30_000);

  it("lists every tab's run for the chats menu, with its chat and store, and saves the store with the outcome", async () => {
    const f = fake(cartPage());
    expect(f.host.list()).toEqual({ runs: [] });
    await f.host.start({ tab_id: 1, provider: "anthropic", model: "m", conv: "c1", site: "shop.test" });
    await until(() => !!f.host.status(1).run?.prompt_id);
    const [run] = f.host.list().runs;
    expect(run).toMatchObject({ tab_id: 1, conv: "c1", site: "shop.test", done: false });
    expect(run!.prompt_id).toBeTruthy();
    expect(run).not.toHaveProperty("events");
    f.host.answer({ tab_id: 1, prompt_id: run!.prompt_id!, more: false });
    await until(() => f.saved.length === 1);
    expect(f.saved[0]).toMatchObject({ conv: "c1", site: "shop.test" });
    expect(f.host.list().runs[0]).toMatchObject({ done: true });
  }, 30_000);

  it("stopAll (Delete all data) ends every run and resolves only after each has saved", async () => {
    const f = fake(cartPage());
    await f.host.start({ tab_id: 1, provider: "anthropic", model: "m", conv: "c1" });
    await until(() => !!f.host.status(1).run?.prompt_id);
    await f.host.stopAll();
    expect(f.saved).toHaveLength(1);
    expect(f.host.status(1).run?.done).toBe(true);
  }, 30_000);

  it("Stop comes from the panel or the overlay in the run's own tab, hides the overlay at once, and one run per tab", async () => {
    const f = fake(cartPage({ hang: true }));
    await f.host.start({ tab_id: 1, provider: "anthropic", model: "m" });
    await expect(f.host.start({ tab_id: 1, provider: "anthropic", model: "m" })).rejects.toBeInstanceOf(BridgeError);
    expect(() => f.host.stop(1, { kind: "content", raw: { tab: { id: 2 } } })).toThrow(BridgeError);
    expect(f.host.stop(7)).toEqual({ ok: false });
    expect(f.host.stop(1, { kind: "content", raw: { tab: { id: 1 } } })).toEqual({ ok: true });
    expect(f.overlay[f.overlay.length - 1]).toEqual({ type: "overlay:hide" });
  });

  it("a site blocked in Settings or by the organization does not start, and the page is never touched", async () => {
    let touched = false;
    const page = cartPage();
    const f = fake({ ...page, snapshot: () => ((touched = true), page.snapshot()) }, "shop.test is blocked in Settings, so Scout cannot act on it.");
    await expect(f.host.start({ tab_id: 3, provider: "anthropic", model: "m" })).rejects.toThrow(/blocked in Settings/);
    expect(touched).toBe(false);
    expect(f.overlay).toEqual([]);
    expect(f.host.status(3).run).toBeFalsy();
  });

  it("a page it cannot reach does not start", async () => {
    const f = fake(cartPage());
    const host = new CouponHost({ ...(f.host as unknown as { deps: ConstructorParameters<typeof CouponHost>[0] }).deps, page: async () => Promise.reject(new Error("no")) });
    await expect(host.start({ tab_id: 3, provider: "anthropic", model: "m" })).rejects.toBeInstanceOf(BridgeError);
    expect(host.status(3)).toEqual({});
  });

  // Owner report 2026-10-26 (checkout.stripe.com): "Could not reach this page"
  // came with no stages at all. A watching panel now gets the reason, with no page address in it.
  it("tells a watching panel why a page could not be reached", async () => {
    const f = fake(cartPage());
    const host = new CouponHost({
      ...(f.host as unknown as { deps: ConstructorParameters<typeof CouponHost>[0] }).deps,
      page: async () => Promise.reject(new Error("Cannot access https://checkout.stripe.com/c/pay/cs_test_123 right now")),
    });
    host.watch(f.port, 4);
    await expect(host.start({ tab_id: 4, provider: "anthropic", model: "m" })).rejects.toThrow("Could not reach this page. Reload it and try again.");
    expect(f.posted.filter((p) => p.kind === "trace").map((p) => p.stage)).toEqual(["coupons:start-failed Error: Cannot access <url> right now"]);
    expect(failReason(new BridgeError("blocked-by-user", "Blocked"))).toBe("blocked-by-user: Blocked");
  });
  // Owner report 2026-10-27 (getbeefy.co): no saved permission showed as "Could not reach this page".
  it("says when the provider needs permission, not that the page could not be reached", async () => {
    const f = fake(cartPage());
    const host = new CouponHost({
      ...(f.host as unknown as { deps: ConstructorParameters<typeof CouponHost>[0] }).deps,
      provider: async () => Promise.reject(new ProviderError("anthropic", "consent_required")),
    });
    await expect(host.start({ tab_id: 5, provider: "anthropic", model: "m" })).rejects.toThrow(
      "Scout needs your permission before it sends anything to this provider. Nothing was sent.",
    );
    expect(host.status(5)).toEqual({});
  });
  // Owner report 2026-10-19 (run #203): a coupon run's report showed no stages,
  // only the panel's own "port:reconnecting". The worker stamps each stage with
  // its time in the run, and the panel's port dropped every event that carried it.
  it("every event a watching panel receives passes the panel's message check, stages included", async () => {
    const f = fake(cartPage());
    f.host.watch(f.port, 3);
    await f.host.start({ tab_id: 3, provider: "anthropic", model: "m", conv: "c3" });
    await until(() => !!f.host.status(3).run?.prompt_id);
    f.host.answer({ tab_id: 3, prompt_id: f.host.status(3).run!.prompt_id!, more: false });
    await until(() => f.posted.some((p) => p.kind === "done"));
    expect(f.posted.some((p) => p.kind === "trace")).toBe(true);
    for (const p of f.posted) expect(checkSchema(WORKER_EVENTS["coupons.event"], p), String(p.kind)).toBeNull();
  }, 30_000);
});
