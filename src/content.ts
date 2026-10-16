// Content script (T009). Injected on demand with `scripting.executeScript`;
// never declared for all URLs. Exposes one handler: snapshot the page, perform
// one action by ref from the last snapshot, and (T031) read or set the store's
// Shopify cart discount. Page content is untrusted data and only leaves via the
// return value.
import { domPage } from "./actions/dom";
import { executeAction, type ActionResult } from "./actions/executor";
import { buildSnapshot, fromElement, type SnapNode, type Snapshot } from "./snapshot/snapshot";

import { CONTENT_HANDLER as HANDLER, type ContentRequest } from "./content-api";
import { shopifyCartInfo, shopifyCartUpdate } from "./coupons/shopify";

const FLAG = "__safariScoutContent";
const g = globalThis as unknown as Record<string, unknown>;

if (!g[FLAG]) {
  g[FLAG] = true;
  let refs = new Map<string, Element>();

  const snapshot = (): Snapshot => {
    const nodeToEl = new Map<SnapNode, Element>();
    const root = fromElement(document.documentElement, nodeToEl);
    const next = new Map<string, Element>();
    const snap = buildSnapshot(root, {
      url: location.href,
      title: document.title,
      onRef: (ref, node) => {
        const el = nodeToEl.get(node);
        if (el) next.set(ref, el);
      },
    });
    refs = next;
    return snap;
  };

  // Called from the popup through scripting.executeScript, not runtime
  // messaging: on iOS Safari a tabs.sendMessage to this script went
  // unanswered (T018), while executeScript results arrive reliably.
  g[HANDLER] = (req: ContentRequest): Promise<unknown> | Snapshot | null => {
    if (req.type === "assistant:snapshot") return snapshot();
    if (req.type === "assistant:act") return executeAction(domPage(refs, window), req.action) as Promise<ActionResult>;
    if (req.type === "assistant:cart-info") return shopifyCartInfo();
    if (req.type === "assistant:cart-update") return shopifyCartUpdate(String(req.discount ?? ""));
    if (req.type === "assistant:reload") {
      // Let the reply reach the popup first, then refresh the cart view.
      setTimeout(() => location.reload(), 50);
      return Promise.resolve(true);
    }
    return null;
  };
}
