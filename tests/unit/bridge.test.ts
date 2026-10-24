import { describe, expect, it } from "vitest";
import {
  BridgeError,
  PANEL_PORT,
  REQUESTS,
  checkSchema,
  classifySender,
  createRouter,
  envelope,
  request,
  type Envelope,
} from "../../src/bridge/messages";
import { backoffDelay, connectPanelPort, type PortLike } from "../../src/bridge/port";

const SELF = { id: "scout-ext-id", baseUrl: "safari-web-extension://abc/" };
const PANEL = { id: SELF.id, url: "safari-web-extension://abc/popup.html" };
const CONTENT = { id: SELF.id, url: "https://shop.test/cart", tab: { id: 7 }, frameId: 0 };

describe("sender validation", () => {
  it("accepts Scout's panel and content scripts only", () => {
    expect(classifySender(PANEL, SELF)).toBe("panel");
    expect(classifySender(CONTENT, SELF)).toBe("content");
  });

  it("rejects web pages, other extensions, and senders with no id", () => {
    expect(classifySender({ url: "https://evil.test/", tab: { id: 1 } }, SELF)).toBeNull();
    expect(classifySender({ id: "other-ext", url: "https://evil.test/", tab: { id: 1 } }, SELF)).toBeNull();
    expect(classifySender({ id: "other-ext", url: "safari-web-extension://abc/popup.html" }, SELF)).toBeNull();
    expect(classifySender({ id: SELF.id, url: "https://evil.test/" }, SELF)).toBeNull();
    expect(classifySender(undefined, SELF)).toBeNull();
  });
});

describe("schemas", () => {
  it("checks types, required and unknown keys", () => {
    const s = { object: { tabId: "number", note: "string" }, optional: ["note"] } as const;
    expect(checkSchema(s, { tabId: 3 })).toBeNull();
    expect(checkSchema(s, { tabId: "3" })).toBe("payload.tabId must be a number");
    expect(checkSchema(s, {})).toBe("payload.tabId is required");
    expect(checkSchema(s, { tabId: 3, extra: 1 })).toBe("payload.extra is not allowed");
    expect(checkSchema({ array: { enum: ["a", "b"] } }, ["a", "c"])).toBe("payload[1] must be one of a, b");
  });
});

describe("router", () => {
  const route = createRouter({ ping: () => ({ from: "background" }), "panel.state": () => ({ open: true }) }, () => SELF);

  it("answers a valid request with the same request_id", async () => {
    const reply = await route(envelope("ping", {}, "r1"), PANEL);
    expect(reply).toEqual({ type: "ping.result", request_id: "r1", payload: { from: "background" } });
  });

  it("does not answer a web page at all", async () => {
    expect(await route(envelope("ping", {}, "r2"), { url: "https://evil.test/", tab: { id: 1 } })).toBeNull();
  });

  it("returns schema-error for malformed messages", async () => {
    const err = (r: Envelope | null) => (r?.payload as { error: string }).error;
    expect(err(await route("ping", PANEL))).toBe("schema-error");
    expect(err(await route({ type: "ping", payload: {} }, PANEL))).toBe("schema-error");
    expect(err(await route({ type: "ping", request_id: "r3", payload: {}, extra: 1 }, PANEL))).toBe("schema-error");
    expect(err(await route(envelope("nope", {}, "r4"), PANEL))).toBe("schema-error");
    expect(await route(envelope("panel.state", { tabId: "x" }, "r5"), PANEL)).toEqual({
      type: "error",
      request_id: "r5",
      payload: { error: "schema-error", message: "payload.tabId must be a number" },
    });
  });

  it("keeps panel-only messages away from content scripts", async () => {
    const reply = await route(envelope("panel.state", { tabId: 1 }, "r6"), CONTENT);
    expect(reply?.payload).toEqual({ error: "schema-error", message: "panel.state is not accepted from a content" });
  });

  it("reports a throwing or missing handler as unhandled", async () => {
    const r = createRouter({ ping: () => { throw new Error("boom"); } }, () => SELF);
    expect((await r(envelope("ping", {}, "r7"), PANEL))?.payload).toEqual({ error: "unhandled", message: "boom" });
    expect((await r(envelope("panel.state", { tabId: 1 }, "r8"), PANEL))?.payload).toEqual({
      error: "unhandled",
      message: "no handler for panel.state",
    });
  });
});

describe("request client", () => {
  it("resolves the payload of a matching reply", async () => {
    const route = createRouter({ ping: () => ({ from: "background" }) }, () => SELF);
    expect(await request((m) => route(m, PANEL), "ping", {})).toEqual({ from: "background" });
  });

  it("throws the typed error from an error reply", async () => {
    const route = createRouter({}, () => SELF);
    await expect(request((m) => route(m, PANEL), "panel.state", { tabId: "bad" })).rejects.toMatchObject({ error: "schema-error" });
  });

  it("times out when nothing answers", async () => {
    const never = () => new Promise<unknown>(() => undefined);
    const err = await request(never, "ping", {}, { timeoutMs: 10 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BridgeError);
    expect((err as BridgeError).error).toBe("timeout");
  });
});

// A fake runtime.connect: each call makes a port the test can drop, as when
// Safari unloads the background page.
function fakeRuntime() {
  const ports: Array<PortLike & { sent: unknown[]; drop(): void; reply(m: unknown): void; name: string }> = [];
  const connect = ({ name }: { name: string }) => {
    const msg: Array<(m: unknown) => void> = [];
    const disc: Array<() => void> = [];
    const port = {
      name,
      sent: [] as unknown[],
      postMessage: (m: unknown) => void port.sent.push(m),
      disconnect: () => undefined,
      onMessage: { addListener: (fn: (m: unknown) => void) => void msg.push(fn) },
      onDisconnect: { addListener: (fn: () => void) => void disc.push(fn) },
      drop: () => disc.forEach((f) => f()),
      reply: (m: unknown) => msg.forEach((f) => f(m)),
    };
    ports.push(port);
    return port;
  };
  return { ports, connect };
}

describe("panel port", () => {
  it("backs off exponentially with a cap", () => {
    expect([0, 1, 2, 3, 10].map((n) => backoffDelay(n, 250, 8000))).toEqual([250, 500, 1000, 2000, 8000]);
  });

  it("says hello, reconnects after the worker restarts, and resets the backoff", () => {
    const rt = fakeRuntime();
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const events: string[] = [];
    connectPanelPort({
      connect: rt.connect,
      hello: () => envelope("panel.hello", { tabId: 4 }, "h"),
      onEvent: (e) => events.push(e.type),
      setTimer: (fn, ms) => timers.push({ fn, ms }),
    });
    expect(rt.ports[0]?.name).toBe(PANEL_PORT);
    expect(rt.ports[0]?.sent).toEqual([{ type: "panel.hello", request_id: "h", payload: { tabId: 4 } }]);

    // Worker restarts twice before answering: 250 ms, then 500 ms.
    rt.ports[0]!.drop();
    expect(timers.map((t) => t.ms)).toEqual([250]);
    timers[0]!.fn();
    rt.ports[1]!.drop();
    expect(timers.map((t) => t.ms)).toEqual([250, 500]);
    timers[1]!.fn();
    expect(rt.ports).toHaveLength(3);
    expect(rt.ports[2]?.sent).toHaveLength(1);

    // The worker answers: events flow and the next drop starts from 250 ms again.
    rt.ports[2]!.reply(envelope("panel.ack", { tabId: 4 }, "h"));
    expect(events).toEqual(["panel.ack"]);
    rt.ports[2]!.drop();
    expect(timers[timers.length - 1]?.ms).toBe(250);
  });

  it("ignores malformed worker events and stops reconnecting once closed", () => {
    const rt = fakeRuntime();
    const timers: Array<() => void> = [];
    const events: string[] = [];
    const port = connectPanelPort({
      connect: rt.connect,
      hello: () => envelope("panel.hello", { tabId: 1 }),
      onEvent: (e) => events.push(e.type),
      setTimer: (fn) => timers.push(fn),
    });
    rt.ports[0]!.reply({ type: "panel.ack", payload: { tabId: 1 } });
    rt.ports[0]!.reply(envelope("panel.ack", { tabId: "1" }));
    rt.ports[0]!.reply(envelope("task.evil", {}));
    expect(events).toEqual([]);
    port.close();
    rt.ports[0]!.drop();
    expect(timers).toHaveLength(0);
  });
});

describe("chat.start schema", () => {
  // A general question sends the open page's address and title (PR #92). The
  // schema rejected open_page, so every general question on a normal page
  // ended in "Could not start the answer".
  it("accepts a general question with open_page", () => {
    const payload = {
      message_id: "m1",
      conv: "c1",
      provider: "anthropic",
      model: "claude-haiku-5-5",
      question: "best coffee shop in Denver",
      history: [],
      pages: [],
      shared: [],
      site: "homedepot.com",
      scope: "general",
      open_page: { url: "https://www.homedepot.com/", title: "The Home Depot" },
    };
    expect(checkSchema(REQUESTS["chat.start"].payload, payload)).toBeNull();
  });
});
