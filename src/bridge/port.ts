// Long-lived port from the panel to the background worker, for streaming
// events. Safari can unload a non-persistent background page; when the port
// drops, the panel reconnects with exponential backoff and says hello again.
import { BridgeError, PANEL_PORT, WORKER_EVENTS, checkSchema, envelope, parseEnvelope, type Envelope } from "./messages";

export interface PortLike {
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: { addListener(fn: (message: unknown) => void): void };
  onDisconnect: { addListener(fn: () => void): void };
}

export type Connect = (info: { name: string }) => PortLike;

export interface PanelPortOptions {
  connect: Connect;
  /** Sent first on every (re)connection, e.g. panel.hello. */
  hello: () => Envelope;
  onEvent?: (env: Envelope) => void;
  onState?: (state: "connected" | "reconnecting") => void;
  baseDelayMs?: number;
  maxDelayMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface PanelPort {
  post(type: string, payload: unknown): void;
  close(): void;
  /** Reconnect attempts since the last message from the worker. */
  readonly attempts: number;
}

/** Delay before reconnect attempt n (0-based): base * 2^n, capped. */
export function backoffDelay(attempt: number, baseMs = 250, maxMs = 8000): number {
  return Math.min(maxMs, baseMs * 2 ** Math.min(attempt, 20));
}

export function connectPanelPort(opts: PanelPortOptions): PanelPort {
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let port: PortLike | null = null;
  let closed = false;
  let attempts = 0;
  let timer: unknown = null;

  const open = (): void => {
    timer = null;
    if (closed) return;
    let p: PortLike;
    try {
      p = opts.connect({ name: PANEL_PORT });
    } catch {
      schedule();
      return;
    }
    port = p;
    p.onMessage.addListener((raw) => {
      const parsed = parseEnvelope(raw);
      if (!parsed.ok) return;
      const schema = (WORKER_EVENTS as Record<string, Parameters<typeof checkSchema>[0]>)[parsed.env.type];
      if (!schema || checkSchema(schema, parsed.env.payload)) return;
      // A valid message proves the worker is up: reset the backoff.
      if (attempts > 0) opts.onState?.("connected");
      attempts = 0;
      opts.onEvent?.(parsed.env);
    });
    p.onDisconnect.addListener(() => {
      if (port === p) port = null;
      if (!closed) schedule();
    });
    try {
      p.postMessage(opts.hello());
    } catch {
      // onDisconnect follows and schedules the retry.
    }
  };

  const schedule = (): void => {
    if (closed || timer !== null) return;
    opts.onState?.("reconnecting");
    timer = setTimer(open, backoffDelay(attempts, opts.baseDelayMs, opts.maxDelayMs));
    attempts++;
  };

  open();

  return {
    post(type, payload) {
      if (!port) throw new BridgeError("unhandled", "panel port is not connected");
      port.postMessage(envelope(type, payload));
    },
    close() {
      closed = true;
      if (timer !== null) clearTimer(timer);
      port?.disconnect();
      port = null;
    },
    get attempts() {
      return attempts;
    },
  };
}
