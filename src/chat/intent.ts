// Is a message about the open page, or a general question? (owner request
// 2026-10-21: on a Home Depot toilets page, "best coffee shop in Noe Valley"
// must get a coffee shop answer, never a Home Depot one.) Decided on the
// device, instantly and for free, before anything is sent: a general question
// goes to the provider without the page, so the answer cannot lean on it. A
// miss is cheap: the model can still call read_page when the message turns out
// to be about the page (GENERAL_SCOPE_RULES).

export type QuestionScope = "page" | "general";

export interface ScopeInput {
  question: string;
  /** The open page, for words its title shares with the question. */
  pageTitle?: string;
  /** The scope of the previous message in this chat, for follow-ups. */
  previous?: QuestionScope;
  /** Tabs the user attached to this message (@ mentions) count as page questions. */
  attachedTabs?: number;
}

// Words that point at what is on screen. "this"/"these" only count before a
// noun that is not a time ("this weekend" is general).
const PAGE_NOUNS =
  "page|site|website|web ?page|article|post|story|blog|product|item|listing|model|recipe|video|thread|review|reviews|comment|comments|" +
  "doc|document|pdf|paper|report|study|deal|offer|sale|price|one|ones|thing|stuff|text|paragraph|section|table|chart|graph|image|picture|photo|" +
  "list|guide|tutorial|course|job|role|position|house|home|apartment|property|car|book|song|album|movie|show|episode|game|app|company|event|" +
  "menu|place|hotel|flight|ticket|tickets|form|email|message|code|error|author|writer|brand|store|shop|seller|plan|policy|terms|contract|result|results|link|links|search";
const TIME_WORDS = "week|weekend|weekday|morning|afternoon|evening|night|year|month|season|summer|winter|spring|fall|autumn|time|moment|monday|tuesday|wednesday|thursday|friday|saturday|sunday";

// Always about the page: "this article", "summarize", "here", "on the page".
const STRONG: RegExp[] = [
  new RegExp("\\b(this|these)\\s+(?:\\w+\\s+)?(" + PAGE_NOUNS + ")\\b", "i"),
  /\b(summari[sz]e|summary|tl;?dr|recap|key points|main points|takeaways?|gist)\b/i,
  /\b(on|in|from|of|at) (the|this) (page|site|website|article|post|screen|tab|listing|video|product)\b/i,
  /\b(the|this) (page|article|author|post|listing|product|item|tab|screen|website)\b/i,
  /\b(here|above|below|on screen|on my screen|i'?m (looking at|reading|viewing|on)|i am (looking at|reading|viewing|on))\b/i,
  /\b(explain|translate|rewrite|proofread|fact[- ]check)\s+(this|these)\b/i,
  // "this" standing alone, as in "where can I buy this?"
  /\b(this|these)\s*([?.!,;:]|$)/i,
  /^(what|who|why) (is|are) (this|these)\??$/i,
  /\bwhat('?s| is| are) (this|these)( about| for)?\b/i,
];

// About the page at the start of a chat, but about the last answer after a
// general one ("is that one open late?" after coffee shop picks).
const WEAK: RegExp[] = [
  new RegExp("\\b(that|those)\\s+(?:\\w+\\s+)?(" + PAGE_NOUNS + ")\\b", "i"),
  /\b(it|this|that)\s+(say|says|said|mean|means|cost|costs|come|comes|include|includes|work|works|fit|fits|ship|ships)\b/i,
  /\bhow much (is|are|does|do) (it|this|that|they|these|those|the)\b/i,
  /\b(is|are) (it|this|that|they|these|those) (worth|any good|good|legit|safe|accurate|true|real|in stock|on sale|a good deal)\b/i,
  /\b(worth (it|buying)|in stock|on sale|good deal|should i buy)\b/i,
  /\b(explain|translate|rewrite|proofread|fact[- ]check)\s+(that|it|those)\b/i,
  /^(what|who|why) (is|are) (that|those)\??$/i,
  /\bwhat('?s| is| are) (that|those)( about| for)?\b/i,
];

// Follow-ups that lean on the message before ("and in red?", "what about it").
const FOLLOW_UP = /^(and|also|what about|how about|ok(ay)?|so|but|then|why|really|more|which one|compared to|vs\.?)\b|\b(it|its|they|them|their|that one)\b/i;

const STOP = new Set(
  "the and for with from your you our are was were this that these those what when where which who whom whose why how have has had not but can will just into onto over under about more most less than then them they their there here best good great new free shop store official site home page online buy sale deals deal near".split(" "),
);

/** Lowercase words of four letters or more, without a plural or possessive s. */
function keywords(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().match(/[a-z][a-z0-9'-]{3,}/g) ?? []) {
    const stem = w.replace(/'s$/, "").replace(/(?<=[a-z]{3}[^s])s$/, "");
    if (!STOP.has(w) && !STOP.has(stem)) out.add(stem);
  }
  return out;
}

/** Does the question name something in the page title ("toilets" on a toilets page)? */
function sharesTitleWords(question: string, title: string): boolean {
  const t = keywords(title);
  for (const w of keywords(question)) if (t.has(w)) return true;
  return false;
}

export function classifyQuestion(input: ScopeInput): QuestionScope {
  const q = input.question.trim();
  if (!q) return "general";
  if ((input.attachedTabs ?? 0) > 0) return "page";
  // "this weekend", "this morning": a time, not the page. Masked before the patterns run.
  const masked = q
    .replace(new RegExp("\\b(this|these|that|next|last)\\s+(" + TIME_WORDS + ")s?\\b", "gi"), " ")
    // "near here" is a place, not the page.
    .replace(/\b(near|around|close to|far from|from) here\b/gi, " ");
  if (STRONG.some((re) => re.test(masked))) return "page";
  if (input.previous !== "general" && WEAK.some((re) => re.test(masked))) return "page";
  if (input.pageTitle && sharesTitleWords(q, input.pageTitle)) return "page";
  // A short follow-up keeps the topic of the message before it.
  if (input.previous && q.split(/\s+/).length <= 8 && FOLLOW_UP.test(masked)) return input.previous;
  return "general";
}

// A search engine's results page ("Hannah Marie Kelly - Google Search"):
// its title is the user's own search, so a question repeating those words is
// not about the page (owner report 2026-10-23: a song lookup on Google got
// "the results page doesn't name the song" instead of the song).
const SEARCH_ENGINES = /(^|\.)(google|bing|duckduckgo|yahoo|ecosia|startpage|brave|kagi|qwant|yandex|baidu)\.[a-z.]+$/i;

export function isSearchResultsPage(url: string | undefined): boolean {
  try {
    const u = new URL(url ?? "");
    if (!SEARCH_ENGINES.test(u.hostname)) return false;
    return /^\/(search|web|s)?\/?$/i.test(u.pathname) && /[?&](q|p|query|wd|text)=[^&]/.test(u.search);
  } catch {
    return false;
  }
}

/**
 * The words that say what a page is: its title and the words in its address
 * path ("/b/Bath-Toilets"). None for a search results page, whose title is
 * only the user's search.
 */
export function pageWords(title: string | undefined, url: string | undefined): string {
  if (isSearchResultsPage(url)) return "";
  let path = "";
  try {
    path = decodeURIComponent(new URL(url ?? "").pathname).replace(/[^A-Za-z]+/g, " ");
  } catch {
    // No address: the title alone.
  }
  return [title ?? "", path].join(" ").trim();
}
