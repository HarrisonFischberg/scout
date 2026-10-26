// Find coupons' reach into the browser, from the background worker
// (src/server/coupon-host.ts): the shop tab, through content.js, and the
// quiet page downloads of the browser fallback. Moved out of the panel so a run
// keeps going when the panel closes (owner request 2026-10-19).
import type { Action, ActionResult } from "../actions/executor";
import { CONTENT_HANDLER, type ContentRequest } from "../content-api";
import type { Snapshot } from "../snapshot/snapshot";
import type { BrowserTarget, PageBrowser } from "./browser-read";
import type { CartApi, CartState } from "./finder";
import type { MerchantMeta } from "./merchant";
import { quietPages } from "./quiet-read";
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
  // A page still loading or just reloaded can refuse the first injection; try a few times.
  for (let attempt = 0; ; attempt++) {
    try {
      await browser.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
      break;
    } catch (err) {
      if (attempt >= 2) throw err;
      trace("content:inject retry");
      await new Promise((r) => setTimeout(r, 400));
    }
  }
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

const originOf = (url: string): string | null => {
  try {
    return new URL(url).origin + "/*";
  } catch {
    return null;
  }
};

/**
 * Find coupons' browser fallback (src/coupons/browser-read.ts): coupon pages
 * the reader could not load are downloaded quietly from the worker, with no
 * tab opened on Mac or iPhone (owner's choice "Quiet only", 2026-10-19;
 * src/coupons/quiet-read.ts). Background tabs of the user's window were used
 * before; they flashed in the tab bar and iPhone could not read them.
 */
export function quietBrowser(): PageBrowser {
  return quietPages({
    fetch: (u, init) => fetch(u, init),
    hasAccess: async (origin) => !browser.permissions.contains || (await browser.permissions.contains({ origins: [origin] })),
  });
}

/**
 * Coupon pages the reader could not load are read quietly
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
