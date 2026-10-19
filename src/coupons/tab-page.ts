// Find coupons' reach into the browser, from the background worker
// (src/server/coupon-host.ts): the shop tab, through content.js, and the
// background tabs of the browser fallback. Moved out of the panel so a run
// keeps going when the panel closes (owner request 2026-10-19).
import type { Action, ActionResult } from "../actions/executor";
import { CONTENT_HANDLER, type ContentRequest } from "../content-api";
import { callInjected } from "../content-call";
import type { Snapshot } from "../snapshot/snapshot";
import type { BrowserTarget, PageBrowser } from "./browser-read";
import type { CartApi, CartState } from "./finder";
import type { MerchantMeta } from "./merchant";
import { MAX_STORE_CODES, type StoreCode } from "./store";

/** The coupon finder's view of the current tab . */
export interface CouponPage {
  snapshot(limits?: { maxElements?: number; maxTextChars?: number }): Promise<Snapshot>;
  act(action: Action): Promise<ActionResult>;
  cart: CartApi;
  /** Codes the store's home page advertises, with the words around each. */
  storeCodes(): Promise<StoreCode[]>;
  /** How the page names the store (meta tags). */
  meta(): Promise<MerchantMeta | null>;
}

/**
 * The tab a coupon run works on, reached through content.js (injected on
 * demand). `aboveSheet`: iPhone, where the panel's sheet covers the bottom
 * half of the page (src/actions/pointer.ts). `trace`: diagnostics stage names.
 */
export async function tabCouponPage(tabId: number, opts: { aboveSheet?: boolean; trace?: (stage: string) => void } = {}): Promise<CouponPage> {
  const trace = opts.trace ?? (() => undefined);
  await browser.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  // A page that reloads (a store whose Apply button submits a form) loses the
  // content script: inject it again and retry, for up to about 4 s.
  const call = async (req: ContentRequest): Promise<unknown> => {
    for (let attempt = 0; ; attempt++) {
      const out = await callOnce(req).catch(() => ({ ok: false as const, why: "threw-inject" }));
      if (out.ok || attempt >= 10 || !/no-handler|threw-inject|null-result/.test(out.why)) {
        if (!out.ok) trace("content:" + req.type + " " + out.why);
        return out.ok ? out.value : null;
      }
      await new Promise((r) => setTimeout(r, 400));
      await browser.scripting.executeScript({ target: { tabId }, files: ["content.js"] }).catch(() => undefined);
    }
  };
  // Same isolated world as content.js, so its handler is visible here.
  const callOnce = async (req: ContentRequest): Promise<{ ok: true; value: unknown } | { ok: false; why: string }> => {
    const [res] = await browser.scripting.executeScript({
      target: { tabId },
      // Returns an envelope so a failure inside the page is reported, not
      // silently turned into null by Safari.
      func: (r: ContentRequest, name: string) => {
        try {
          const h = (globalThis as unknown as Record<string, ((x: ContentRequest) => unknown) | undefined>)[name];
          if (typeof r !== "object" || r === null) return { ok: false, why: "no-args" };
          if (!h) {
            const loaded = (globalThis as unknown as Record<string, unknown>).__safariScoutContent === true;
            return { ok: false, why: "no-handler loaded=" + String(loaded) };
          }
          const out = h(r);
          if (out && typeof (out as Promise<unknown>).then === "function") {
            return (out as Promise<unknown>).then(
              (value) => ({ ok: true, value }),
              () => ({ ok: false, why: "threw-async" }),
            );
          }
          return { ok: true, value: out };
        } catch {
          return { ok: false, why: "threw" };
        }
      },
      args: [req, CONTENT_HANDLER],
    });
    const env = res?.result as { ok?: boolean; value?: unknown; why?: string } | null | undefined;
    if (!env || env.ok !== true) return { ok: false, why: env ? (env.why ?? "bad-envelope") : "null-result" };
    return { ok: true, value: env.value };
  };

  return {
    snapshot: async (limits: { maxElements?: number; maxTextChars?: number } = {}) => (await call({ type: "scout:snapshot", ...limits })) as Snapshot,
    // Coupon runs show a pointer pressing and typing on the page, so the user can watch (owner, 2026-10-17).
    // On iPhone the panel's sheet covers the bottom half, so the pointer works in the top part (owner, 2026-10-19).
    act: async (action: Action) => (await call({ type: "scout:act", action, show: true, ...(opts.aboveSheet ? { aboveSheet: true } : {}) })) as ActionResult,
    cart: {
      info: async () => (await call({ type: "scout:cart-info" })) as CartState | null,
      update: async (discount: string) => (await call({ type: "scout:cart-update", discount })) as CartState | { rateLimited: true } | null,
      reload: async () => void (await call({ type: "scout:reload" })),
    },
    storeCodes: async () => {
      const codes = await call({ type: "scout:store-codes" });
      return Array.isArray(codes)
        ? codes.filter((c): c is StoreCode => !!c && typeof (c as StoreCode).code === "string" && typeof (c as StoreCode).context === "string").slice(0, MAX_STORE_CODES)
        : [];
    },
    meta: async () => {
      const m = (await call({ type: "scout:page-meta" })) as MerchantMeta | null;
      return m && typeof m === "object" ? m : null;
    },
  };
}

const BROWSER_SNAPSHOT = { maxElements: 600, maxTextChars: 60_000 };

const originOf = (url: string): string | null => {
  try {
    return new URL(url).origin + "/*";
  } catch {
    return null;
  }
};

/**
 * Find coupons' browser fallback (src/coupons/browser-read.ts): coupon pages
 * the reader could not load open in background tabs of the user's own Safari
 * window (a Private window stays private), read through Scout's content
 * script, and close again with any tab they opened.
 */
export function backgroundTabs(windowId: number | undefined): PageBrowser {
  const children = new Map<number, Set<number>>();
  const onCreated = (t: { id?: number; openerTabId?: number }): void => {
    if (t.id !== undefined && t.openerTabId !== undefined) children.get(t.openerTabId)?.add(t.id);
  };
  let listening = false;
  return {
    open: async (url) => {
      const origin = originOf(url);
      if (!origin || !browser.tabs.create) return null;
      // Without site access the tab could open but never be read.
      if (browser.permissions.contains && !(await browser.permissions.contains({ origins: [origin] }).catch(() => false))) return null;
      if (!listening) {
        browser.tabs.onCreated?.addListener(onCreated);
        listening = true;
      }
      const t = await browser.tabs.create({ url, active: false, ...(windowId !== undefined ? { windowId } : {}) });
      if (t.id === undefined) return null;
      children.set(t.id, new Set());
      return t.id;
    },
    read: async (tab) => {
      const snap = (await callInjected(tab, "content.js", CONTENT_HANDLER, { type: "scout:snapshot", ...BROWSER_SNAPSHOT }).catch(() => null)) as Snapshot | null;
      return snap && typeof snap.text === "string" && Array.isArray(snap.elements) ? snap : null;
    },
    click: async (tab, ref) => {
      const r = (await callInjected(tab, "content.js", CONTENT_HANDLER, { type: "scout:act", action: { type: "click", ref } }).catch(() => null)) as ActionResult | null;
      return r?.ok === true;
    },
    close: async (tab) => {
      const extra = [...(children.get(tab) ?? [])];
      children.delete(tab);
      if (!children.size && listening) {
        browser.tabs.onCreated?.removeListener?.(onCreated);
        listening = false;
      }
      await browser.tabs.remove?.([tab, ...extra]);
    },
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}

/**
 * Coupon pages the reader could not load open in background tabs
 * automatically (owner's choice, 2026-10-17), wherever Safari gives Scout
 * access to those sites. Access to every site is asked for once, on the
 * Find coupons press (the panel's `askSiteAccessOnce`); without it the pages
 * are skipped and the summary says so.
 */
export async function allowBrowserPages(pages: BrowserTarget[], trace: (stage: string) => void = () => undefined): Promise<boolean> {
  const origins = [...new Set(pages.flatMap((p) => originOf(p.url) ?? []))];
  const ok = origins.length > 0 && (await browser.permissions.contains?.({ origins }).catch(() => false)) === true;
  trace("coupons:browser-allow " + (ok ? "auto" : "no-access") + " pages=" + pages.length);
  return ok;
}
