import type { Page } from "@playwright/test";

// Part 2 harness: runs the real background worker (background.js) in the
// popup's page next to the panel, sharing the spec's `browser` stub. It wires
// runtime.sendMessage/onMessage and runtime.connect/onConnect the way Safari
// does between the panel and the worker: the panel is the sender, messages
// are copied, and ports deliver asynchronously. Call it after the spec's own
// addInitScript so it extends that stub. Run `npm run build` first.
//
// Test hooks on window: __scoutDropPorts() disconnects every port from the
// worker side (as when Safari unloads the worker page),
// __scoutPortCount() says how many ports were opened, and
// __scoutSendAs(message, sender) delivers a message with another sender (a
// content script in a tab, Part 3). Every message the panel
// posts on a port is also logged to sessionStorage "__scoutPortLog" (kept
// across reloads) as { name, type, payload }.
export async function withWorker(page: Page): Promise<void> {
  await page.route("**/background.js", (r) => r.fulfill({ path: "apple/Extension/Resources/background.js", contentType: "text/javascript" }));
  await page.addInitScript(() => {
    type Fn = (...args: never[]) => unknown;
    const g = globalThis as unknown as Record<string, unknown>;
    const b = g.browser as Record<string, Record<string, unknown>> | undefined;
    if (!b) return;
    const runtime = (b.runtime ??= {});
    runtime.id ??= "scout-test";
    runtime.getURL ??= (p: string) => location.origin + "/" + p;
    b.permissions ??= { request: async () => false, getAll: async () => ({ origins: [] }), remove: async () => true };
    const id = runtime.id as string;
    const copy = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

    let ready: () => void = () => undefined;
    const workerReady = new Promise<void>((r) => (ready = r));
    const messageListeners: Fn[] = [];
    const connectListeners: Fn[] = [];
    runtime.onMessage = {
      addListener: (f: Fn) => {
        messageListeners.push(f);
        ready();
      },
    };
    runtime.onConnect = { addListener: (f: Fn) => connectListeners.push(f) };
    const deliver = async (m: unknown, sender: unknown): Promise<unknown> => {
      await workerReady;
      for (const f of messageListeners) {
        const r = await (f as (m: unknown, s: unknown) => unknown)(copy(m), copy(sender));
        if (r !== undefined) return copy(r);
      }
      return undefined;
    };
    runtime.sendMessage = (m: unknown) => deliver(m, { id, url: location.href });
    // Part 3: a content script in a tab sends with the tab's sender (the overlay pill's commands).
    g.__scoutSendAs = (m: unknown, sender: Record<string, unknown>) => deliver(m, { id, ...sender });

    const ports: Array<{ disconnect(): void }> = [];
    runtime.connect = ({ name }: { name: string }) => {
      const ends = [0, 1].map(() => ({ msg: [] as Fn[], disc: [] as Fn[] }));
      let alive = true;
      const end = (i: number) => ({
        name,
        // The worker's end carries the panel as its sender.
        sender: i === 1 ? { id, url: location.href } : undefined,
        postMessage(m: unknown) {
          if (!alive) throw new Error("Attempting to use a disconnected port object");
          const c = copy(m);
          if (i === 0) {
            const logged = JSON.parse(sessionStorage.getItem("__scoutPortLog") ?? "[]") as unknown[];
            const env = c as { type?: string; payload?: unknown };
            logged.push({ name, type: env.type, payload: env.payload });
            sessionStorage.setItem("__scoutPortLog", JSON.stringify(logged));
          }
          setTimeout(() => {
            if (alive) for (const f of ends[1 - i]!.msg) (f as (x: unknown) => void)(c);
          }, 0);
        },
        disconnect() {
          if (!alive) return;
          alive = false;
          setTimeout(() => {
            for (const f of ends[1 - i]!.disc) (f as () => void)();
          }, 0);
        },
        onMessage: { addListener: (f: Fn) => ends[i]!.msg.push(f) },
        onDisconnect: { addListener: (f: Fn) => ends[i]!.disc.push(f) },
      });
      const panel = end(0);
      const worker = end(1);
      ports.push(worker);
      void workerReady.then(() => {
        for (const f of connectListeners) (f as (p: unknown) => void)(worker);
      });
      return panel;
    };
    g.__scoutDropPorts = () => {
      for (const p of ports) p.disconnect();
    };
    g.__scoutPortCount = () => ports.length;

    document.addEventListener("DOMContentLoaded", () => {
      const s = document.createElement("script");
      s.src = "background.js";
      document.head.appendChild(s);
    });
  });
}
