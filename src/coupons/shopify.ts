// Shopify cart API (T031), called from the content script inside the user's
// cart tab, so requests go to the store's own origin with the user's session,
// exactly like the cart page's Apply button. Never touches checkout.
import type { CartState } from "./finder";

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

function toState(j: unknown): CartState | null {
  const c = j as { total_price?: unknown; currency?: unknown; discount_codes?: unknown } | null;
  if (!c || typeof c.total_price !== "number") return null;
  const codes = Array.isArray(c.discount_codes)
    ? c.discount_codes.flatMap((d: { code?: unknown; applicable?: unknown }) =>
        typeof d?.code === "string" ? [{ code: d.code, applicable: d.applicable === true }] : [],
      )
    : [];
  return { total: c.total_price / 100, currency: typeof c.currency === "string" ? c.currency : null, codes };
}

/** Current cart, or null when the page is not a Shopify store. */
export async function shopifyCartInfo(f: FetchFn = fetch): Promise<CartState | null> {
  try {
    const r = await f("/cart.js", { credentials: "same-origin", headers: { accept: "application/json" } });
    if (!r.ok) return null;
    // Real stores label the JSON text/javascript, so parse the body and check
    // its shape instead of trusting the content type.
    return toState(JSON.parse(await r.text()));
  } catch {
    return null;
  }
}

/** Sets the cart's discount code(s) ("" clears, "A,B" sets two) and returns the new cart. */
export async function shopifyCartUpdate(discount: string, f: FetchFn = fetch): Promise<CartState | { rateLimited: true } | null> {
  try {
    const r = await f("/cart/update.js", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ discount }),
    });
    if (r.status === 429) return { rateLimited: true };
    if (!r.ok) return null;
    return toState(await r.json());
  } catch {
    return null;
  }
}
