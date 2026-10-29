// Answer sources (owner items 10 and 12, 2026-10-17): the numbered pages an
// answer may cite as [n], shown as a site chip at the end of the paragraph
// that used them, a hover card, and the "N sources" list under the answer.
// No favicons are fetched: the chip's icon is a letter drawn locally, so
// showing a source sends nothing to its site.

export interface Source {
  url: string;
  title?: string;
  /** Quoted passage, when the provider gave one (web citations). */
  snippet?: string;
  /** "page": a tab the user shared with the question. "web": a provider web result. */
  kind?: "page" | "web";
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** The host without "www.", as shown on the hover card: "www.lepage.ca" -> "lepage.ca". */
export function displayHost(url: string): string {
  return hostOf(url).replace(/^www\./, "");
}

/**
 * The short site name on a chip: the registrable name without its suffix.
 * "www.amazon.com" -> "amazon", "shop.bbc.co.uk" -> "bbc", "127.0.0.1" stays.
 */
export function siteName(url: string): string {
  const host = displayHost(url);
  if (!host || /^[\d.]+$/.test(host) || host.includes(":")) return host || url;
  const parts = host.split(".");
  if (parts.length < 2) return host;
  const [sld, tld] = parts.slice(-2) as [string, string];
  // Two-part public suffixes such as co.uk, com.au, co.jp.
  if (parts.length >= 3 && tld.length === 2 && sld.length <= 3) return parts[parts.length - 3]!;
  return sld;
}

/** A stable hue for the site's letter icon, so each site keeps its color. */
export function siteHue(url: string): number {
  let h = 0;
  for (const ch of siteName(url)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

/**
 * Drops citation markers no source matches, as the panel does: "[12-1]" (the
 * search tool's own result-passage numbers) or a number past the list.
 * Only markers after a space, so code such as "items[1]" stays.
 */
export function dropUnmatchedCites(text: string, count: number): string {
  return text.replace(/[ \t]+\[(\d{1,3}(?:-\d{1,3})?(?:\s*,\s*\d{1,3}(?:-\d{1,3})?)*)\](?!\()/g, (all, list: string) => {
    const kept = list.split(",").map((x) => x.trim()).filter((x) => /^\d+$/.test(x) && Number(x) >= 1 && Number(x) <= count);
    return kept.length === list.split(",").length ? all : kept.length ? " [" + kept.join(", ") + "]" : "";
  });
}

/** The answer as copied or shared: its Markdown, then the numbered sources it may cite. */
export function answerText(answer: string, sources: Source[]): string {
  const text = dropUnmatchedCites(answer.trim(), sources.length);
  if (!sources.length) return text;
  const lines = sources.map((s, i) => "[" + (i + 1) + "] " + (s.title ? s.title + " (" + s.url + ")" : s.url));
  return text + "\n\nSources:\n" + lines.join("\n");
}

/** URL kept with saved history: no query or fragment, which can hold session tokens. */
export function savedUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return "";
  }
}

/** Builds the letter icon for a source. */
export function siteIcon(doc: Document, url: string): HTMLElement {
  const icon = doc.createElement("span");
  icon.className = "site-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.style.setProperty("--site-hue", String(siteHue(url)));
  icon.textContent = (siteName(url)[0] ?? "?").toUpperCase();
  return icon;
}

/** The hover card's content: site, title (a link), snippet, and what kind of source it is. */
export function fillSourceCard(doc: Document, card: HTMLElement, src: Source): void {
  card.replaceChildren();
  const head = doc.createElement("div");
  head.className = "cite-site";
  const name = doc.createElement("span");
  name.textContent = displayHost(src.url) || siteName(src.url);
  head.append(siteIcon(doc, src.url), name);
  const title = doc.createElement("a");
  title.className = "cite-title";
  title.href = src.url;
  title.target = "_blank";
  title.rel = "noopener noreferrer";
  title.textContent = src.title || src.url;
  card.append(head, title);
  if (src.snippet) {
    const p = doc.createElement("p");
    p.className = "cite-snippet";
    p.textContent = src.snippet;
    card.appendChild(p);
  }
  const kind = doc.createElement("p");
  kind.className = "cite-kind";
  kind.textContent = src.kind === "web" ? "Web result" : "Page you shared";
  card.appendChild(kind);
}
