import { describe, expect, it, vi } from "vitest";
import { createAskQueue, parseQuickAsk, PENDING_ASK_MS, placeQuickAsk, QUICK_ASK_BOTTOM_GAP_PX, QUICK_ASK_MAX_CHARS, quickAskOffered } from "../../src/panel/quick-ask";

// Quick ask (owner request 2026-10-18, option A of the Comet comparison): on a
// phone the page tab opens a small question box over a dimmed page, and the
// worker hands what was asked to Scout's panel. Synthetic data only.
type Fn = (...args: never[]) => unknown;

describe("quick ask rules", () => {
  it("is offered on phones only", () => {
    expect(quickAskOffered(true, 390)).toBe(true);
    expect(quickAskOffered(true, 820)).toBe(false);
    expect(quickAskOffered(false, 390)).toBe(false);
  });

  it("accepts a question or a summarize, and nothing else", () => {
    expect(parseQuickAsk({ kind: "ask", question: "  What is this?  " })).toEqual({ kind: "ask", question: "What is this?" });
    expect(parseQuickAsk({ kind: "summarize", question: "ignored" })).toEqual({ kind: "summarize", question: "" });
    expect(parseQuickAsk({ kind: "ask", question: "   " })).toBeNull();
    expect(parseQuickAsk({ kind: "agent", question: "x" })).toBeNull();
    expect(parseQuickAsk(null)).toBeNull();
    expect(parseQuickAsk({ kind: "ask", question: "x".repeat(QUICK_ASK_MAX_CHARS + 50) })?.question.length).toBe(QUICK_ASK_MAX_CHARS);
  });

  it("hands each question over once, per tab, and forgets stale ones", () => {
    const q = createAskQueue();
    q.put(1, { kind: "ask", question: "one" }, 1000);
    q.put(2, { kind: "summarize", question: "" }, 1000);
    q.put(1, { kind: "ask", question: "newer" }, 1100);
    expect(q.take(1, 1200)).toEqual({ kind: "ask", question: "newer" });
    expect(q.take(1, 1200)).toBeNull();
    expect(q.take(2, 1000 + PENDING_ASK_MS + 1)).toBeNull();
  });

  it("sits right above the keyboard, and the dim ends there", () => {
    // 390 x 664 layout viewport, keyboard up: 360 px of page on screen.
    const at = placeQuickAsk({ layoutHeight: 664, viewTop: 0, viewHeight: 360, boxHeight: 120, scale: 1 });
    expect(at).toEqual({ boxTop: 360 - 8 - 120, dimHeight: 360 });
  });

  it("never covers the strip Safari samples under its bottom bar, keyboard or not", () => {
    for (const scale of [1, 2.5]) {
      const at = placeQuickAsk({ layoutHeight: 664 * scale, viewTop: 0, viewHeight: 664 * scale, boxHeight: 120 * scale, scale });
      const floor = 664 * scale - QUICK_ASK_BOTTOM_GAP_PX * scale;
      expect(at.dimHeight).toBeLessThanOrEqual(floor);
      expect(at.boxTop + 120 * scale).toBeLessThanOrEqual(floor);
    }
  });

  it("follows the page when Safari pans it above the keyboard", () => {
    const at = placeQuickAsk({ layoutHeight: 664, viewTop: 100, viewHeight: 360, boxHeight: 120, scale: 1 });
    expect(at.boxTop).toBe(460 - 8 - 120);
    expect(at.dimHeight).toBe(460);
  });
});

describe("worker hands the quick ask to Scout's panel", () => {
  async function loadWorker(openOk = true) {
    const listeners: Record<string, Fn[]> = {};
    const on = (name: string) => ({ addListener: (f: Fn) => (listeners[name] ??= []).push(f) });
    const openPopup = vi.fn(async () => {
      if (!openOk) throw new Error("no gesture");
    });
    const g = globalThis as unknown as Record<string, unknown>;
    g.browser = {
      runtime: { id: "scout-test", getURL: (p: string) => "safari-web-extension://scout-test/" + p, onMessage: on("message"), onConnect: on("connect"), onStartup: on("startup"), onInstalled: on("installed") },
      storage: { local: { get: async () => ({}), set: async () => undefined, remove: async () => undefined } },
      action: { openPopup, setTitle: async () => undefined, setIcon: async () => undefined },
      tabs: { onActivated: on("activated"), onRemoved: on("removed"), onUpdated: on("updated"), query: async () => [{ id: 7 }] },
      scripting: { executeScript: async () => [] },
      permissions: { getAll: async () => ({ origins: [] }), onAdded: on("permAdded"), onRemoved: on("permRemoved") },
    };
    vi.resetModules();
    await import("../../src/background");
    let n = 0;
    const send = async (type: string, payload: unknown, sender: object) => {
      const f = listeners.message?.[0] as (m: unknown, s: unknown) => Promise<{ type: string; payload: Record<string, unknown> }>;
      return f({ type, request_id: "r" + ++n, payload }, { id: "scout-test", ...sender });
    };
    const page = { url: "https://shop.example/item", tab: { id: 7 } };
    const panel = { url: "safari-web-extension://scout-test/popup.html" };
    return { openPopup, send, page, panel };
  }

  it("opens the panel and gives it the question once", async () => {
    const w = await loadWorker();
    const r = await w.send("panel.ask", { kind: "ask", question: "Is this in stock?" }, w.page);
    expect(r.payload).toEqual({ opened: true });
    expect(w.openPopup).toHaveBeenCalledTimes(1);
    expect((await w.send("panel.take_ask", { tabId: 7 }, w.panel)).payload).toEqual({ kind: "ask", question: "Is this in stock?" });
    expect((await w.send("panel.take_ask", { tabId: 7 }, w.panel)).payload).toEqual({});
  });

  it("keeps nothing when the panel cannot open", async () => {
    const w = await loadWorker(false);
    const r = await w.send("panel.ask", { kind: "summarize", question: "" }, w.page);
    expect(r.payload).toEqual({ opened: false });
    expect((await w.send("panel.take_ask", { tabId: 7 }, w.panel)).payload).toEqual({});
  });

  it("only a page asks and only the panel takes", async () => {
    const w = await loadWorker();
    expect((await w.send("panel.ask", { kind: "ask", question: "x" }, w.panel)).type).toBe("error");
    await w.send("panel.ask", { kind: "ask", question: "x" }, w.page);
    expect((await w.send("panel.take_ask", { tabId: 7 }, w.page)).type).toBe("error");
  });
});
