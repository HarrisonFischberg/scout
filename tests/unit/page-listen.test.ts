import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PAGE_START_TIMEOUT_MS, PageListener, pageListenPoll, POLL_MS, type RunInTab } from "../../src/panel/page-listen";

// iPhone mic fallback (owner bug report 2026-10-20): the recognizer runs in the
// page. Here "the page" is this global, with a recognizer the test drives.
class PageRec {
  static last: PageRec | null = null;
  static silent = false;
  lang = "";
  continuous = false;
  interimResults = false;
  onstart: (() => void) | null = null;
  onaudiostart: (() => void) | null = null;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  aborted = false;
  constructor() {
    PageRec.last = this;
  }
  start(): void {
    if (!PageRec.silent) this.onstart?.();
  }
  stop(): void {
    this.onend?.();
  }
  abort(): void {
    this.aborted = true;
    this.onerror?.({ error: "aborted" });
    this.onend?.();
  }
  say(text: string, final: boolean): void {
    this.onresult?.({ results: [{ isFinal: final, 0: { transcript: text } }] });
  }
}

const g = globalThis as unknown as Record<string, unknown>;
const run: RunInTab = async (func, args) => func(...args);
const flush = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(POLL_MS);
};

describe("mic listens from the page when the panel can't (iPhone, 2026-10-20)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    g.webkitSpeechRecognition = PageRec;
    PageRec.silent = false;
  });
  afterEach(() => {
    vi.useRealTimers();
    delete g.webkitSpeechRecognition;
    delete g.__scoutListen;
  });

  it("passes the page's words to the panel and ends cleanly on stop", async () => {
    const l = new PageListener(run, "en-US");
    const seen: Array<[string, boolean]> = [];
    const ends: Array<string | undefined> = [];
    l.start({ onText: (t, f) => seen.push([t, f]), onEnd: (e) => ends.push(e) });
    await flush();
    const rec = PageRec.last!;
    expect(rec.continuous).toBe(true);
    expect(rec.lang).toBe("en-US");
    rec.say("cheap  shoes ", false);
    await flush();
    rec.say("cheap shoes", true);
    await flush();
    expect(seen).toEqual([["cheap shoes", false], ["cheap shoes", true]]);
    l.stop();
    await flush();
    expect(ends).toEqual([undefined]);
    expect(l.active).toBe(false);
  });

  it("gives Safari time to ask, then ends with no-start and aborts", async () => {
    PageRec.silent = true;
    const l = new PageListener(run, "en-US");
    const ends: Array<string | undefined> = [];
    l.start({ onText: () => undefined, onEnd: (e) => ends.push(e) });
    await vi.advanceTimersByTimeAsync(PAGE_START_TIMEOUT_MS - POLL_MS);
    expect(ends).toEqual([]);
    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    expect(ends).toEqual(["no-start"]);
    expect(PageRec.last!.aborted).toBe(true);
    expect(pageListenPoll()).toBeNull();
  });

  it("reports the page's refusal", async () => {
    const l = new PageListener(run, "en-US");
    const ends: Array<string | undefined> = [];
    l.start({ onText: () => undefined, onEnd: (e) => ends.push(e) });
    await flush();
    PageRec.last!.onerror?.({ error: "not-allowed" });
    PageRec.last!.onend?.();
    await flush();
    expect(ends).toEqual(["not-allowed"]);
  });

  it("a page Scout can't run in ends at once", async () => {
    const l = new PageListener(async () => {
      throw new Error("no access");
    }, "en-US");
    const ends: Array<string | undefined> = [];
    l.start({ onText: () => undefined, onEnd: (e) => ends.push(e) });
    await flush();
    expect(ends).toEqual(["page-unavailable"]);
    delete g.webkitSpeechRecognition;
    const l2 = new PageListener(run, "en-US");
    l2.start({ onText: () => undefined, onEnd: (e) => ends.push(e) });
    await flush();
    expect(ends).toEqual(["page-unavailable", "unsupported"]);
  });

  it("a page that reloads mid-dictation ends it", async () => {
    const l = new PageListener(run, "en-US");
    const ends: Array<string | undefined> = [];
    l.start({ onText: () => undefined, onEnd: (e) => ends.push(e) });
    await flush();
    delete g.__scoutListen;
    await flush();
    expect(ends).toEqual(["page-unavailable"]);
  });
});
