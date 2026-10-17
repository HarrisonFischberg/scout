// Content script (T009). Injected on demand with `scripting.executeScript`;
// never declared for all URLs. Exposes one handler: snapshot the page, perform
// one action by ref from the last snapshot, (Part 3) probe and perform Scout
// mode actions, (T031) read or set the store's cart discount (Shopify,
// WooCommerce, BigCommerce), and list codes the store's home page advertises.
// Page content is untrusted data and only leaves via the return value.
import { domPage } from "./actions/dom";
import { executeAction, type ActionResult } from "./actions/executor";
import { performTaskAction } from "./actions/task";
import { taskDomPage } from "./actions/task-dom";
import { buildSnapshot, fromElement, type SnapNode, type Snapshot } from "./snapshot/snapshot";

import { CONTENT_HANDLER as HANDLER, type ContentRequest } from "./content-api";
import { storeCartInfo, storeCartUpdate } from "./coupons/carts";
import { codesWithContext, storeHomeText } from "./coupons/store";

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
    // Part 3: coordinates from the server are scaled to this (spec 8.3).
    snap.viewport = { width: window.innerWidth, height: window.innerHeight };
    return snap;
  };

  // Called from the popup through scripting.executeScript, not runtime
  // messaging: on iOS Safari a tabs.sendMessage to this script went
  // unanswered (T018), while executeScript results arrive reliably.
  // Meta tags that name the store, as plain strings (untrusted page data).
  const meta = (sel: string): string | undefined => {
    const v = document.querySelector<HTMLMetaElement | HTMLLinkElement>(sel);
    const raw = v instanceof HTMLLinkElement ? v.href : v?.content;
    return typeof raw === "string" && raw.trim() ? raw.trim().slice(0, 200) : undefined;
  };
  const pageMeta = (): { title: string; siteName?: string; canonical?: string } => ({
    title: document.title.slice(0, 200),
    ...(meta('meta[property="og:site_name"]') ?? meta('meta[name="application-name"]') ? { siteName: meta('meta[property="og:site_name"]') ?? meta('meta[name="application-name"]') } : {}),
    ...(meta('link[rel="canonical"]') ? { canonical: meta('link[rel="canonical"]') } : {}),
  });

  g[HANDLER] = (req: ContentRequest): Promise<unknown> | Snapshot | object | null => {
    if (req.type === "scout:snapshot") return snapshot({ maxElements: req.maxElements, maxTextChars: req.maxTextChars });
    if (req.type === "scout:act") return executeAction(domPage(refs, window), req.action) as Promise<ActionResult>;
    if (req.type === "scout:task-probe") return taskDomPage(refs, window).probe(req.target);
    if (req.type === "scout:task-act") return performTaskAction(taskDomPage(refs, window), req.action);
    if (req.type === "scout:cart-info") return storeCartInfo();
    if (req.type === "scout:cart-update") return storeCartUpdate(String(req.discount ?? ""));
    if (req.type === "scout:store-codes") return storeHomeText().then((t) => (t ? codesWithContext(t) : []));
    if (req.type === "scout:page-meta") return pageMeta();
    if (req.type === "scout:reload") {
      // Let the reply reach the popup first, then refresh the cart view.
      setTimeout(() => location.reload(), 50);
      return Promise.resolve(true);
    }
    return null;
  };
}
