// Empty-chat suggestions for the page the panel opened on. On a known shopping
// site the composer lists shopping actions, each marked with the store's own
// icon; on any other page the general chips in popup.html stay. Pure functions
// only, so they are unit-tested without a browser.
import { youtubeVideoId } from "../context/youtube";
import { readsInstagramPost } from "../context/instagram";

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
 * Summarize on a YouTube video (owner, 2026-11-08: "as good as Comet"): the
 * central takeaway, numbered takeaways each with a bold heading, a short
 * explanation and the time range it covers, then why the video says it
 * matters. [1:31–3:22] becomes a chip that plays the video from 1:31.
 */
export const VIDEO_SUMMARY_PROMPT =
  "Summarize this video. Start with one sentence that begins \"The video's central takeaway:\" and states its main claim, " +
  "then one sentence on how the video makes its case. " +
  "Then a heading \"### Key takeaways\" and a numbered list of 4 to 7 takeaways, ordered so they explain the video best. " +
  "Write each takeaway as a bold heading that states the point as a full sentence, then on the next line, indented three spaces, " +
  "2 or 3 sentences on what the video says and why, ending with the time range it covers, like [1:31–3:22]. " +
  "A range runs from the first to the last transcript line on that point; if the point comes up in more than one place, give each range, like [4:47–6:16; 8:15–10:00]. " +
  "Then a heading \"### Why it matters\" and one short paragraph on the video's closing argument or why it says this matters, ending with its time range. " +
  "Attribute claims to the video (for example \"the video argues\"), use only what the video says, and use only times from the transcript. " +
  "This answer may run to about 450 words. No other introduction and no closing line.\n\n" +
  "Shape:\nThe video's central takeaway: ...\n\n### Key takeaways\n\n1. **First point as a sentence.**\n   What the video says about it. [1:31–3:22]\n\n### Why it matters\n\n... [12:53–14:51]";

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
  { label: "Summarize the video", prompt: VIDEO_SUMMARY_PROMPT },
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

/** Dark enough for white text on the letter tile (5.6:1). */
export const INSTAGRAM_SITE: ShoppingSite = { name: "Instagram", color: "#b1246a" };

/**
 * Summarize on an Instagram post, reel or story (owner request 2026-11-08):
 * read from the post itself (src/context/instagram.ts), its photos or video
 * frames included. Claude can't hear audio, so the answer says when speech
 * would matter instead of guessing it.
 */
export const INSTAGRAM_SUMMARY_PROMPT =
  "Summarize this Instagram post. Start with one sentence on what it is (reel, photo, carousel or story), who posted it, and its main point. " +
  "Then 3 to 5 bullet points on what it shows and says: what happens in the pictures or video frames, any text shown on screen, and what the caption adds. " +
  "If the post makes claims or is an ad, say so. Use only the pictures and the page, and say when something can't be told from them, such as speech in the video. " +
  "No introduction and no closing line.";

/** Starters on an Instagram post, reel, story or the feed. */
export const INSTAGRAM_SUGGESTIONS: readonly Suggestion[] = [
  { label: "Summarize this post", prompt: INSTAGRAM_SUMMARY_PROMPT },
  {
    label: "What happens in it?",
    prompt:
      "Describe what happens in this Instagram post, picture by picture in order: the setting, people, objects, actions, and any text on screen. " +
      "Don't identify anyone from their face; name people only when the post names or tags them. Say what the pictures can't show, such as speech or music, instead of guessing.",
  },
  {
    label: "Is it true?",
    prompt:
      "Fact-check this Instagram post. List each claim it makes in the caption, the text on screen or the pictures, and for each say whether it is true, false, misleading or unclear, with a source. " +
      "Say if the post looks like an ad or a sponsored post.",
  },
  {
    label: "Find what's shown",
    prompt:
      "Identify the products, places, food, music and brands shown or tagged in this Instagram post, and where to find or buy them, with links. " +
      "Don't identify anyone from their face; name people only when the post names or tags them. Say which items you are unsure of.",
  },
];

/** The short label a site starter (YouTube or Instagram) shows in the chat; null for any other message. */
export function siteStarterLabel(question: string): string | null {
  return videoStarterLabel(question) ?? INSTAGRAM_SUGGESTIONS.find((s) => s.prompt === question)?.label ?? null;
}

/** The suggestions for a page, with the site they belong to; null means keep the general chips. */
export function suggestionsFor(url: string | undefined): { site: ShoppingSite; items: readonly Suggestion[] } | null {
  if (youtubeVideoId(url)) return { site: YOUTUBE_SITE, items: VIDEO_SUGGESTIONS };
  if (readsInstagramPost(url)) return { site: INSTAGRAM_SITE, items: INSTAGRAM_SUGGESTIONS };
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
