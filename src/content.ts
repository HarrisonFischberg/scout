// Content script (T009). Injected on demand with `scripting.executeScript`;
// never declared for all URLs. Exposes one handler: snapshot the page, perform
// one action by ref from the last snapshot, (T031) read or set the store's
// cart discount (Shopify, WooCommerce, BigCommerce), and list codes the store's home page advertises.
// Part 3 adds the Scout mode executor (src/scout/execute.ts) and the Scouting
// overlay (src/scout/overlay.ts); the overlay's pill sends Take control / Stop
// to the worker as "task.control" messages.
// Page content is untrusted data and only leaves via the return value.
import { domPage } from "./actions/dom";
import { executeAction, type ActionResult } from "./actions/executor";
import { buildSnapshot, fromElement, type SnapNode, type Snapshot } from "./snapshot/snapshot";

import { envelope } from "./bridge/messages";
import { CONTENT_HANDLER as HANDLER, type ContentRequest, type ViewportInfo } from "./content-api";
import { storeCartInfo, storeCartUpdate } from "./coupons/carts";
import { codesInText, storeHomeText } from "./coupons/store";
import { executeScoutAction } from "./scout/execute";
import { createOverlay, type Overlay } from "./scout/overlay";

const FLAG = "__safariScoutContent";
const g = globalThis as unknown as Record<string, unknown>;

if (!g[FLAG]) {
  g[FLAG] = true;
  let refs = new Map<string, Element>();

  const snapshot = (limits: { maxElements?: number; maxTextChars?: number } = {}): Snapshot => {
    const nodeToEl = new Map<SnapNode, Element>();
    const root = fromElement(document.documentElement, nodeToEl);
    const next = new Map<string, Element>();
    const snap = buildSnapshot(root, {
      url: location.href,
      title: document.title,
      // Larger only on request (coupon runs), never past these caps.
      ...(typeof limits.maxElements === "number" ? { maxElements: Math.min(Math.max(limits.maxElements, 1), 1000) } : {}),
      ...(typeof limits.maxTextChars === "number" ? { maxTextChars: Math.min(Math.max(limits.maxTextChars, 1), 120_000) } : {}),
      onRef: (ref, node) => {
        const el = nodeToEl.get(node);
        if (el) next.set(ref, el);
      },
    });
    refs = next;
    return snap;
  };

  // ---------- Part 3: overlay and Scout actions ----------
  let overlay: Overlay | null = null;
  /** Aborted by scout:halt (Take control, Stop) so an action in progress ends at once. */
  let halt = new AbortController();

  const getOverlay = (): Overlay =>
    (overlay ??= createOverlay({
      doc: document,
      onCommand: (command) => {
        // Pause on the page first, so nothing more happens even before the worker answers.
        if (command !== "resume") halt.abort();
        if (typeof browser !== "undefined" && browser.runtime?.sendMessage) {
          void browser.runtime.sendMessage(envelope("task.control", { command })).catch(() => undefined);
        }
      },
      // The e2e harness reads the closed root to check styles and timing. Never in release builds.
      ...(__SCOUT_DEBUG__ ? { expose: (root: ShadowRoot | null) => void (g.__scoutOverlayRoot = root) } : {}),
    }));

  const scoutAct = (req: Extract<ContentRequest, { type: "scout:scout-act" }>): Promise<unknown> => {
    if (halt.signal.aborted) halt = new AbortController();
    const signal = halt.signal;
    return executeScoutAction(
      {
        doc: document,
        win: window,
        resolve: (ref) => refs.get(ref),
        marker: (x, y) => getOverlay().marker(x, y),
        signal,
      },
      req.action,
    );
  };

  const overlayCommand = (req: Extract<ContentRequest, { type: "scout:overlay" }>): Promise<unknown> => {
    if (req.command === "hide") {
      const o = overlay;
      overlay = null;
      return o ? o.hide().then(() => true) : Promise.resolve(true);
    }
    const o = getOverlay();
    if (req.state) o.setState(req.state);
    if (req.command === "show") o.show();
    return Promise.resolve(true);
  };

  // Called from the popup or the worker through scripting.executeScript, not
  // runtime messaging: on iOS Safari a tabs.sendMessage to this script went
  // unanswered (T018), while executeScript results arrive reliably.
  g[HANDLER] = (req: ContentRequest): Promise<unknown> | Snapshot | ViewportInfo | null => {
    if (req.type === "scout:snapshot") return snapshot({ maxElements: req.maxElements, maxTextChars: req.maxTextChars });
    if (req.type === "scout:act") return executeAction(domPage(refs, window), req.action) as Promise<ActionResult>;
    if (req.type === "scout:cart-info") return storeCartInfo();
    if (req.type === "scout:cart-update") return storeCartUpdate(String(req.discount ?? ""));
    if (req.type === "scout:store-codes") return storeHomeText().then((t) => (t ? codesInText(t) : []));
    if (req.type === "scout:reload") {
      // Let the reply reach the popup first, then refresh the cart view.
      setTimeout(() => location.reload(), 50);
      return Promise.resolve(true);
    }
    if (req.type === "scout:scout-act") return scoutAct(req);
    if (req.type === "scout:viewport") return { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio || 1 };
    if (req.type === "scout:overlay") return overlayCommand(req);
    if (req.type === "scout:halt") {
      halt.abort();
      return Promise.resolve(true);
    }
    return null;
  };
}
