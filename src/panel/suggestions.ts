// Empty-chat suggestions for the page the panel opened on. On a known shopping
// site the composer lists shopping actions, each marked with the store's own
// icon; on any other page the general chips in popup.html stay. Pure functions
// only, so they are unit-tested without a browser.
import { youtubeVideoId } from "../context/youtube";

export interface ShoppingSite {
  /** Shown to assistive tech and as the tile's tooltip. */
  name: string;
  /** Background of the letter tile shown when the store's icon cannot load; dark enough for white text (4.5:1). */
  color: string;
}

export interface Suggestion {
  label: string;
  /** The question sent to the chat. */
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
];

export const YOUTUBE_SITE: ShoppingSite = { name: "YouTube", color: "#cc0000" };

/**
 * On a YouTube video (owner request 2026-11-08), read from its captions
 * (src/context/youtube.ts). Formats from the sources the owner gave: the
 * digest's TL;DR, takeaways and timeline (youtube-digest-skill), its
 * watch-or-skip triage, and a short post (Youtube-Tweet). Times written as
 * [4:05] become links that jump the video there.
 */
export const VIDEO_SUGGESTIONS: readonly Suggestion[] = [
  {
    label: "Key points with timestamps",
    prompt:
      "Give the key points of this video. Start with a one-sentence TL;DR. Then a heading \"Key points\" with 3 to 7 bullet points, " +
      "each one standalone insight in one short sentence, ending with the time it is discussed, like [4:05]. " +
      "If the video is longer than 10 minutes, add a heading \"Timeline\" with one short line per main topic, each starting with its time. " +
      "Use only what the video says. No introduction and no closing line.",
  },
  {
    label: "Summarize the video",
    prompt:
      "Summarize this video: one or two sentences on what it is about and what it concludes, " +
      "then 3 to 5 bullet points with the most important facts, each ending with the time it is discussed, like [4:05].",
  },
  {
    label: "Is it worth watching?",
    prompt:
      "Is this video worth watching? Give a one-line verdict (watch, skim or skip) and why, say who it is for, " +
      "and list the parts most worth watching with their times, like [4:05]. Say so if the title promises something the video does not deliver.",
  },
  {
    label: "Write a post about it",
    prompt:
      "Write a short social media post about this video, under 280 characters, in plain words, on what is most useful or interesting in it. " +
      "At most two hashtags. Put the video's address on its own line after the post.",
  },
];

/** The short label a video starter shows in the chat; null for any other message. */
export function videoStarterLabel(question: string): string | null {
  return VIDEO_SUGGESTIONS.find((s) => s.prompt === question)?.label ?? null;
}

/** The suggestions for a page, with the site they belong to; null means keep the general chips. */
export function suggestionsFor(url: string | undefined): { site: ShoppingSite; items: readonly Suggestion[] } | null {
  if (youtubeVideoId(url)) return { site: YOUTUBE_SITE, items: VIDEO_SUGGESTIONS };
  const site = shoppingSite(url);
  return site ? { site, items: SHOPPING_SUGGESTIONS } : null;
}

/**
 * The store's own icon: the tab's favicon when Safari reports one, else the
 * site's /favicon.ico (the site the tab is already on; no other host is asked).
 */
export function siteIconUrl(url: string | undefined, favIconUrl?: string): string | null {
  if (favIconUrl && /^(https:|data:image\/)/.test(favIconUrl)) return favIconUrl;
  try {
    const u = new URL(url ?? "");
    return u.protocol === "https:" ? u.origin + "/favicon.ico" : null;
  } catch {
    return null;
  }
}
