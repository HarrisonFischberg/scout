// Which store the user is shopping at (coupon finder). The tab's hostname is
// the start, but checkouts often live on another host (checkout.brand.com,
// brand.myshopify.com, secure.brand.com) and the search works better with
// the brand's name than with "drinkolipop". The page's own meta tags
// (og:site_name, canonical link, title) name the store; all of it is
// untrusted page data and only ever used as search words.

export interface MerchantMeta {
  /** og:site_name or application-name from the page's meta tags. */
  siteName?: string;
  /** rel=canonical link, when the page has one. */
  canonical?: string;
  title?: string;
  /** The page's meta description: what the store says it sells. */
  description?: string;
}

export interface Merchant {
  /** Hostname the tab is on. */
  host: string;
  /** The store's domain without checkout-only subdomains ("melin.com"). */
  domain: string;
  /** The brand as the store names itself ("Melin"), else the domain label. */
  brand: string;
  /** Name tokens the store goes by, lowercase, for search wording and relevance checks. */
  names: string[];
}

// Subdomains that host a cart or checkout rather than name the store.
const UTILITY_LABELS = new Set([
  "www", "checkout", "shop", "store", "secure", "pay", "payments", "cart", "order", "orders", "m", "mobile", "app",
  "us", "en", "eu", "uk", "ca", "au", "de", "fr", "es", "it", "nl", "intl", "global", "buy", "my", "account",
]);
// Second-level public suffixes where the registrable domain has three labels.
const TWO_LEVEL_TLDS = new Set(["co.uk", "org.uk", "ac.uk", "com.au", "net.au", "co.nz", "co.jp", "com.br", "com.mx", "co.za", "com.sg", "com.hk", "co.in", "co.kr", "com.tr"]);
// Hosted checkouts whose domain is the platform, not the store.
const PLATFORM_HOSTS = /(?:^|\.)(?:myshopify\.com|shopifycdn\.com|shop\.app|bigcommerce\.com|mybigcommerce\.com|squarespace\.com|wixsite\.com|myshoplaza\.com)$/i;
const TITLE_NOISE =
  /^(?:(?:your\s+)?(?:shopping\s+)?(?:cart|bag|basket)(?:\s+page)?|checkout|check\s+out|order|review|payment|shipping|information|home|welcome|secure\s+checkout|my\s+cart|view\s+cart)$/i;
const NAME_NOISE = /\s*[-–|:]\s*(?:official\s+(?:site|store|website)|online\s+store|shop(?:ping)?|home)\s*$|[®™©]/gi;

function registrable(host: string): string {
  const labels = host.split(".").filter(Boolean);
  if (labels.length <= 2) return host;
  const lastTwo = labels.slice(-2).join(".");
  return labels.slice(TWO_LEVEL_TLDS.has(lastTwo) ? -3 : -2).join(".");
}

/** Hostname without checkout-only subdomains, down to the registrable domain. */
export function storeDomain(host: string): string {
  const h = host.toLowerCase().replace(/\.$/, "");
  const base = registrable(h);
  const labels = h.split(".");
  const extra = labels.slice(0, labels.length - base.split(".").length);
  const kept = extra.filter((l) => !UTILITY_LABELS.has(l) && !/^checkout|^shop-|^store-|^cart-|^secure-/.test(l));
  return [...kept, base].join(".");
}

function cleanName(raw: string | undefined): string {
  if (!raw) return "";
  const name = raw.replace(NAME_NOISE, "").replace(/\s+/g, " ").trim();
  // A theme that puts the page name in og:site_name ("Your Shopping Cart") names no store.
  return name.length >= 2 && name.length <= 60 && !TITLE_NOISE.test(name) ? name : "";
}

const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The brand from a page title such as "Cart – Melin", "Your Shopping Cart – Magic Spoon"
 * or "Melin | Checkout": the part that matches the domain label when one does,
 * else the only part left once page words are dropped, else the last part.
 */
function brandFromTitle(title: string | undefined, label: string): string {
  if (!title) return "";
  const parts = title.split(/\s+[-–—|·:]\s+/).map((p) => cleanName(p)).filter((p) => p);
  if (!parts.length) return "";
  const flat = squash(label);
  const match = flat.length >= 3 ? parts.find((p) => squash(p) === flat || squash(p).includes(flat) || (squash(p).length >= 4 && flat.includes(squash(p)))) : undefined;
  return match ?? (parts.length === 1 ? (parts[0] ?? "") : (parts[parts.length - 1] ?? ""));
}

const token = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Domain labels often wrap the brand: drinkolipop -> olipop, getkion -> kion, usehuron -> huron.
const LABEL_PREFIXES = ["get", "shop", "try", "the", "my", "use", "buy", "go", "join", "drink", "eat", "wear", "hello", "meet", "its", "we", "live", "love"];
const LABEL_SUFFIXES = ["shop", "store", "hq", "co", "official", "online", "usa", "us", "brand", "inc", "app"];

/** The brand inside a domain label, when a known prefix or suffix wraps it ("drinkolipop" -> "olipop"). */
export function coreLabel(label: string): string {
  let core = label.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const p of LABEL_PREFIXES) if (core.startsWith(p) && core.length - p.length >= 4) core = core.slice(p.length);
  for (const sfx of LABEL_SUFFIXES) if (core.endsWith(sfx) && core.length - sfx.length >= 4) core = core.slice(0, -sfx.length);
  return core;
}

export function identifyMerchant(url: string, meta: MerchantMeta = {}): Merchant {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    host = url.toLowerCase().replace(/^https?:\/\//, "").split("/")[0] ?? "";
  }
  let domain = storeDomain(host);
  // A hosted checkout: the canonical link may point at the store's real domain.
  if (PLATFORM_HOSTS.test(domain) && meta.canonical) {
    try {
      const c = storeDomain(new URL(meta.canonical).hostname);
      if (!PLATFORM_HOSTS.test(c)) domain = c;
    } catch {
      // keep the platform domain
    }
  }
  // An IP address or "localhost" names no store (local fixtures): the page's own name or "this store".
  const bare = /^(?:\d{1,3}\.){3}\d{1,3}$|^localhost$|^\[/.test(domain);
  const label = bare ? "" : PLATFORM_HOSTS.test(domain) ? (host.split(".")[0] ?? "").replace(/-/g, " ") : (domain.split(".")[0] ?? "");
  const brand = cleanName(meta.siteName) || brandFromTitle(meta.title, label) || label || "this store";
  const names = new Set<string>();
  const named = brand !== "this store";
  for (const n of [...(named ? [brand, brand.replace(/\s+/g, "")] : []), label, ...(bare ? [] : [domain]), coreLabel(label)]) {
    const t = token(n);
    if (t.length >= 3) names.add(t);
  }
  return { host, domain, brand, names: [...names] };
}

/** Whether `text` names the store (for pages the search returns). */
export function mentionsStore(text: string, m: Merchant): boolean {
  const hay = token(text);
  const flat = hay.replace(/\s+/g, "");
  return m.names.some((n) => hay.includes(n) || flat.includes(n.replace(/\s+/g, "")));
}

const MAX_SELLS = 120;
/**
 * What the store sells, in its own words, as search words: its meta
 * description, cut at the first sentence. Owner report 2026-10-19: "Beefy"
 * plus "code" missed a creator's Linktree that only said "meat chips";
 * the owner's other tool searched with what was in the cart. Untrusted page
 * text, used only as search words.
 */
export function sellsLine(meta: Pick<MerchantMeta, "description"> | null | undefined): string | undefined {
  const raw = (meta?.description ?? "").replace(/\s+/g, " ").trim();
  if (raw.length < 8) return undefined;
  const first = raw.split(/(?<=[.!?])\s/)[0] ?? raw;
  const cut = first.length > MAX_SELLS ? first.slice(0, MAX_SELLS).replace(/\s+\S*$/, "") : first;
  return cut.replace(/[.!?]+$/, "") || undefined;
}
