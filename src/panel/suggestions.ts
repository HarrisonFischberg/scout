// Empty-chat suggestions for the page the panel opened on. On a known shopping
// site the panel offers shopping actions, each marked with the store's tile; on
// any other page it keeps the general chips in popup.html. Pure functions only,
// so they are unit-tested without a browser.

export interface ShoppingSite {
  /** Shown to assistive tech and as the tile's tooltip. */
  name: string;
  /** Tile background, dark enough for white text (4.5:1); the tile shows the store's first letter, never its logo. */
  color: string;
}

export interface Suggestion {
  label: string;
  /** A question for the chat, or "coupons" for the Find coupons run. */
  prompt: string;
}

/** Each entry matches the store's registrable domain; `tlds: "any"` also matches its country sites (amazon.co.uk). */
const SITES: { label: string; tlds: string[] | "any"; site: ShoppingSite }[] = [
  { label: "amazon", tlds: "any", site: { name: "Amazon", color: "#c45500" } },
  { label: "ebay", tlds: "any", site: { name: "eBay", color: "#3665f3" } },
  { label: "target", tlds: ["com"], site: { name: "Target", color: "#cc0000" } },
  { label: "walmart", tlds: ["com", "ca"], site: { name: "Walmart", color: "#0071dc" } },
  { label: "bestbuy", tlds: ["com", "ca"], site: { name: "Best Buy", color: "#0046be" } },
  { label: "costco", tlds: ["com", "ca"], site: { name: "Costco", color: "#e31837" } },
  { label: "etsy", tlds: ["com"], site: { name: "Etsy", color: "#c2410c" } },
  { label: "homedepot", tlds: ["com", "ca"], site: { name: "The Home Depot", color: "#c2410c" } },
  { label: "lowes", tlds: ["com"], site: { name: "Lowe's", color: "#004990" } },
  { label: "wayfair", tlds: ["com", "ca", "co.uk"], site: { name: "Wayfair", color: "#7b189f" } },
  { label: "macys", tlds: ["com"], site: { name: "Macy's", color: "#e21a2c" } },
  { label: "kohls", tlds: ["com"], site: { name: "Kohl's", color: "#5b2c83" } },
  { label: "newegg", tlds: ["com", "ca"], site: { name: "Newegg", color: "#b45309" } },
  { label: "ikea", tlds: ["com"], site: { name: "IKEA", color: "#0058a3" } },
];

/** Two-part public suffixes the store list uses (amazon.co.uk, amazon.com.au). */
const SECOND_LEVEL = /^(co|com|ne|or)\.[a-z]{2}$/;

/** The known shopping site for a page URL, or null. */
export function shoppingSite(url: string | undefined): ShoppingSite | null {
  let host: string;
  try {
    const u = new URL(url ?? "");
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    host = u.hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
  const parts = host.split(".");
  for (const s of SITES) {
    const at = parts.lastIndexOf(s.label);
    if (at < 0) continue;
    const tld = parts.slice(at + 1).join(".");
    if (!tld) continue;
    const ok = s.tlds === "any" ? /^[a-z]{2,3}$/.test(tld) || SECOND_LEVEL.test(tld) : s.tlds.includes(tld);
    if (ok) return s.site;
  }
  return null;
}

/** Shopping actions, in the order the panel lists them. */
export const SHOPPING_SUGGESTIONS: readonly Suggestion[] = [
  {
    label: "Compare prices across sites",
    prompt:
      "Compare the price of the product on this page across other major stores. List each store with its current price and a link, " +
      "say which is cheapest including shipping where you can tell, and note anything that makes the offers differ (seller, condition, size or model).",
  },
  {
    label: "Find similar products",
    prompt:
      "Find 3 to 5 products similar to the one on this page, from this store or others. For each, give the name, price, a link, " +
      "and one line on how it differs from this one.",
  },
  {
    label: "Summarize product reviews",
    prompt:
      "Summarize the customer reviews for the product on this page: the overall rating and how many reviews, what people like most, " +
      "the most common complaints, and who it suits. Say if the reviews shown on the page are too few to judge.",
  },
  { label: "Find coupons", prompt: "coupons" },
];

/** The suggestions for a page, with the store they belong to; null means keep the general chips. */
export function suggestionsFor(url: string | undefined): { site: ShoppingSite; items: readonly Suggestion[] } | null {
  const site = shoppingSite(url);
  return site ? { site, items: SHOPPING_SUGGESTIONS } : null;
}
