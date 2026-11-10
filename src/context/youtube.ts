// YouTube key points (owner request 2026-11-08): on a YouTube video, Scout
// reads the video's captions instead of the page around it, so Summarize,
// Explain, the video starters and any question answer from what is said.
//
// Methods, picked from the sources the owner gave:
// - Caption order from steipete/summarize: YouTube's own transcript panel
//   (youtubei get_transcript) first, then the caption track files
//   (captionTracks, json3 then XML), then the description when there are none.
// - youtube-transcript-api's player call with the Android client, as a third
//   try when the web caption files come back empty (yt-dlp's wiki: YouTube
//   gates some clients, so one method is not enough).
// - Layout of the text the model reads from wjgoarxiv/youtube-digest-skill:
//   header (channel, length, date), chapters, then the transcript, each line
//   starting with its time, so key points can carry [m:ss] timestamps.
// - One pass over the whole transcript (HimanshuGitCode, winnerumukoro): long
//   videos are trimmed evenly across the full length, never cut at the end.
//
// No server and no new permission: every request goes from the user's own
// YouTube tab to the same YouTube host (pageFetch runs in the tab through
// scripting.executeScript), and the parsing here runs in the worker. Nothing
// is downloaded but captions; no audio, no video.

/** The video's ID for a YouTube watch, Shorts, live or youtu.be address; null otherwise. */
export function youtubeVideoId(url: string | undefined): string | null {
  let u: URL;
  try {
    u = new URL(url ?? "");
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase();
  const ok = (id: string | null | undefined): string | null => (id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null);
  if (host === "youtu.be") return ok(u.pathname.slice(1).split("/")[0]);
  if (!/(^|\.)youtube\.com$/.test(host) && !/(^|\.)youtube-nocookie\.com$/.test(host)) return null;
  if (u.pathname === "/watch") return ok(u.searchParams.get("v"));
  const m = /^\/(?:shorts|live|embed|v)\/([^/?#]+)/.exec(u.pathname);
  return ok(m?.[1]);
}

/** A watch address for the video, at a time in seconds when given. */
export function videoUrl(id: string, seconds?: number): string {
  return "https://www.youtube.com/watch?v=" + id + (seconds && seconds > 0 ? "&t=" + Math.floor(seconds) + "s" : "");
}

/** "1:02:03" or "4:05" to seconds; NaN when it is not a time. */
export function parseTime(label: string): number {
  const parts = label.trim().split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d{1,2}$/.test(p))) return NaN;
  const nums = parts.map(Number);
  if (nums.slice(1).some((n) => n > 59)) return NaN;
  return nums.reduce((acc, n) => acc * 60 + n, 0);
}

/** Seconds as "4:05" or "1:02:03". */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? h + ":" + String(m).padStart(2, "0") + ":" + sec : m + ":" + sec;
}

// ---------- In the tab ----------

export interface FetchResult {
  status: number;
  text: string;
}

export interface FetchInit {
  method?: "GET" | "POST";
  /** JSON body; sent as application/json. */
  body?: string;
  /** "include" sends the user's YouTube cookies (only the watch page, for the consent and region YouTube shows them). */
  credentials?: "include" | "omit";
}

/**
 * Runs in the YouTube tab (scripting.executeScript({ func: pageFetch })), so
 * it must stay self-contained. Fetches a path on the tab's own host only and
 * returns the text; never throws.
 */
export async function pageFetch(path: string, init: FetchInit = {}): Promise<FetchResult> {
  const MAX = 4_000_000;
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) return { status: 0, text: "" };
  try {
    const headers: Record<string, string> = {};
    if (init.body) headers["Content-Type"] = "application/json";
    const res = await fetch(location.origin + path, {
      method: init.method === "POST" ? "POST" : "GET",
      ...(init.body ? { body: init.body } : {}),
      headers,
      credentials: init.credentials === "include" ? "include" : "omit",
      cache: "no-store",
    });
    const text = await res.text();
    return { status: res.status, text: text.length > MAX ? text.slice(0, MAX) : text };
  } catch {
    return { status: 0, text: "" };
  }
}

export type PageFetcher = (path: string, init?: FetchInit) => Promise<FetchResult>;

// ---------- Parsing (worker) ----------

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

/** The JSON value assigned after `marker` in a page's scripts: an object literal, or a JS string holding JSON (m.youtube.com). */
export function jsonAfter(html: string, marker: string): unknown {
  let from = 0;
  for (;;) {
    const at = html.indexOf(marker, from);
    if (at < 0) return null;
    from = at + marker.length;
    let i = from;
    while (i < html.length && /[\s=:]/.test(html[i]!)) i++;
    const c = html[i];
    if (c === "{" || c === "[") {
      const end = balancedEnd(html, i);
      if (end > 0) {
        try {
          return JSON.parse(html.slice(i, end));
        } catch {
          // Not JSON here; look for the next one.
        }
      }
    } else if (c === "'" || c === '"') {
      const s = jsString(html, i);
      if (s !== null) {
        try {
          return JSON.parse(s);
        } catch {
          // Not JSON.
        }
      }
    }
  }
}

/** The index just past the bracket that closes the one at `start`, or -1. */
function balancedEnd(s: string, start: number): number {
  let depth = 0;
  let quote = "";
  for (let i = start; i < s.length; i++) {
    const c = s[i]!;
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === '"') quote = c;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** A JS string literal at `start` (single or double quotes), unescaped; null when it does not close. */
function jsString(s: string, start: number): string | null {
  const q = s[start];
  let out = "";
  for (let i = start + 1; i < s.length; i++) {
    const c = s[i]!;
    if (c === q) return out;
    if (c !== "\\") {
      out += c;
      continue;
    }
    const n = s[++i];
    if (n === "x") {
      out += String.fromCharCode(parseInt(s.slice(i + 1, i + 3), 16));
      i += 2;
    } else if (n === "u") {
      out += String.fromCharCode(parseInt(s.slice(i + 1, i + 5), 16));
      i += 4;
    } else if (n === "n") out += "\n";
    else if (n === "t") out += "\t";
    else if (n === "r") out += "\r";
    else if (n !== undefined) out += n;
  }
  return null;
}

/** Every object under `root` that has `key`, depth first (bounded). */
export function findAll(root: unknown, key: string, limit = 10_000): Json[] {
  const out: Json[] = [];
  const stack: unknown[] = [root];
  let seen = 0;
  while (stack.length && seen++ < 500_000 && out.length < limit) {
    const v = stack.pop();
    if (Array.isArray(v)) {
      for (let i = v.length - 1; i >= 0; i--) stack.push(v[i]);
      continue;
    }
    const o = obj(v);
    if (!o) continue;
    if (key in o && obj(o[key])) out.push(o[key] as Json);
    const keys = Object.keys(o);
    for (let i = keys.length - 1; i >= 0; i--) stack.push(o[keys[i]!]);
  }
  return out;
}

/** Text from YouTube's { simpleText } / { runs: [{ text }] } / { content } shapes. */
function ytText(v: unknown): string {
  if (typeof v === "string") return v;
  const o = obj(v);
  if (!o) return "";
  if (typeof o.simpleText === "string") return o.simpleText;
  if (typeof o.content === "string") return o.content;
  return arr(o.runs).map((r) => str(obj(r)?.text)).join("");
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const clean = (s: string): string => decodeEntities(s).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

export interface Segment {
  /** Seconds from the start. */
  start: number;
  text: string;
}

export interface Chapter {
  start: number;
  title: string;
}

export interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  name: string;
  /** "asr" for YouTube's automatic captions. */
  kind?: string;
}

/** Segments and chapter headers from a youtubei get_transcript response. */
export function parseTranscriptPanel(json: unknown): { segments: Segment[]; chapters: Chapter[] } {
  const segments: Segment[] = [];
  for (const s of findAll(json, "transcriptSegmentRenderer")) {
    const start = Number(str(s.startMs)) / 1000;
    const text = clean(ytText(s.snippet));
    if (Number.isFinite(start) && text) segments.push({ start, text });
  }
  const chapters: Chapter[] = [];
  for (const h of findAll(json, "transcriptSectionHeaderRenderer")) {
    const start = Number(str(h.startMs)) / 1000;
    const title = clean(ytText(h.snippet) || ytText(obj(obj(obj(h.sectionHeader)?.sectionHeaderViewModel)?.headline)));
    if (Number.isFinite(start) && title) chapters.push({ start, title });
  }
  return { segments: sortByStart(segments), chapters: sortByStart(chapters) };
}

/** Segments from a timedtext json3 file. */
export function parseJson3(text: string): Segment[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return [];
  }
  const out: Segment[] = [];
  for (const e of arr(obj(json)?.events)) {
    const ev = obj(e);
    if (!ev || !Array.isArray(ev.segs)) continue;
    const t = clean(arr(ev.segs).map((s) => str(obj(s)?.utf8)).join(""));
    const start = Number(ev.tStartMs) / 1000;
    if (t && Number.isFinite(start)) out.push({ start, text: t });
  }
  return out;
}

/** Segments from a timedtext XML file: <text start="1.2"> (format 1) or <p t="1200"> (srv3). */
export function parseTimedTextXml(xml: string): Segment[] {
  const out: Segment[] = [];
  const re = /<(text|p)\b([^>]*)>([\s\S]*?)<\/\1>/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const attrs = m[2]!;
    const start = m[1] === "text" ? Number(/\bstart="([\d.]+)"/.exec(attrs)?.[1]) : Number(/\bt="(\d+)"/.exec(attrs)?.[1]) / 1000;
    // Captions are double-escaped in format 1 ("&amp;#39;").
    const t = clean(decodeEntities(m[3]!));
    if (t && Number.isFinite(start)) out.push({ start, text: t });
  }
  return out;
}

export function parseCaptionFile(text: string): Segment[] {
  const t = text.trimStart();
  if (t.startsWith("{")) return parseJson3(t);
  if (t.startsWith("<")) return parseTimedTextXml(t);
  return [];
}

/** Caption tracks listed in a player response. */
export function captionTracks(player: unknown): CaptionTrack[] {
  const list = obj(obj(obj(player)?.captions)?.playerCaptionsTracklistRenderer)?.captionTracks;
  return arr(list).flatMap((t) => {
    const o = obj(t);
    const baseUrl = str(o?.baseUrl);
    if (!o || !baseUrl) return [];
    return [{ baseUrl, languageCode: str(o.languageCode), name: ytText(o.name), ...(str(o.kind) ? { kind: str(o.kind) } : {}) }];
  });
}

/**
 * The track to read: one written by people in the user's language, then
 * automatic captions in it, then people's captions in the spoken language,
 * then automatic ones, then whatever is first.
 */
export function pickTrack(tracks: CaptionTrack[], userLang: string): CaptionTrack | null {
  const lang = (userLang || "en").toLowerCase().split("-")[0]!;
  const is = (t: CaptionTrack): boolean => t.languageCode.toLowerCase().split("-")[0] === lang;
  const asr = tracks.find((t) => t.kind === "asr");
  const spoken = asr?.languageCode.toLowerCase().split("-")[0];
  return (
    tracks.find((t) => t.kind !== "asr" && is(t)) ??
    tracks.find((t) => t.kind === "asr" && is(t)) ??
    tracks.find((t) => t.kind !== "asr" && t.languageCode.toLowerCase().split("-")[0] === spoken) ??
    asr ??
    tracks[0] ??
    null
  );
}

/** A caption file's address as a path on the tab's own host, in json3; null for another host. */
export function trackPath(track: CaptionTrack, format: "json3" | "xml"): string | null {
  let u: URL;
  try {
    u = new URL(track.baseUrl, "https://www.youtube.com");
  } catch {
    return null;
  }
  if (!/(^|\.)youtube\.com$/.test(u.hostname)) return null;
  u.searchParams.delete("fmt");
  if (format === "json3") u.searchParams.set("fmt", "json3");
  return u.pathname + u.search;
}

/** Chapters from description lines that start with a time ("0:00 Intro"); needs a 0:00 line and at least three. */
export function chaptersFromDescription(desc: string): Chapter[] {
  const out: Chapter[] = [];
  for (const line of desc.split("\n")) {
    const m = /^\s*(?:[-•*▶►]\s*)?\(?((?:\d{1,2}:)?\d{1,2}:\d{2})\)?\s*[-–—:|]?\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    const start = parseTime(m[1]!);
    if (Number.isFinite(start) && m[2]) out.push({ start, title: m[2].slice(0, 120) });
  }
  return out.length >= 3 && out[0]!.start === 0 ? out : [];
}

/** Chapters from the watch page's player bar (chapterRenderer). */
export function chaptersFromData(data: unknown): Chapter[] {
  const out: Chapter[] = [];
  for (const c of findAll(data, "chapterRenderer", 500)) {
    const start = Number(c.timeRangeStartMillis) / 1000;
    const title = clean(ytText(c.title));
    if (Number.isFinite(start) && title && !out.some((x) => x.start === start)) out.push({ start, title });
  }
  return sortByStart(out);
}

function sortByStart<T extends { start: number }>(list: T[]): T[] {
  return list.sort((a, b) => a.start - b.start);
}

// ---------- Fetching (worker, through the tab) ----------

export interface WatchPage {
  player: unknown;
  data: unknown;
  apiKey?: string;
  context?: Json;
}

export function parseWatchPage(html: string): WatchPage {
  const apiKey = /"INNERTUBE_API_KEY"\s*:\s*"([A-Za-z0-9_-]+)"/.exec(html)?.[1];
  const context = obj(jsonAfter(html, '"INNERTUBE_CONTEXT"')) ?? undefined;
  return {
    player: jsonAfter(html, "ytInitialPlayerResponse"),
    data: jsonAfter(html, "ytInitialData"),
    ...(apiKey ? { apiKey } : {}),
    ...(context ? { context } : {}),
  };
}

/** get_transcript's params when the page has none: protobuf { 1: videoId }, the field YouTube's transcript button starts with. */
export function defaultTranscriptParams(id: string): string {
  return btoa("\x0a" + String.fromCharCode(id.length) + id);
}

export type TranscriptMethod = "panel" | "captions" | "android" | "none";

export interface Video {
  id: string;
  title: string;
  channel: string;
  /** Seconds; 0 when unknown. */
  length: number;
  published: string;
  description: string;
  chapters: Chapter[];
  segments: Segment[];
  /** Language of the transcript, and whether it is YouTube's automatic one. */
  language: string;
  auto: boolean;
  method: TranscriptMethod;
  live: boolean;
}

// The Android client YouTube's apps use; youtube-transcript-api reads caption tracks through it.
const ANDROID_CONTEXT = { client: { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 30, hl: "en" } };
const WEB_CONTEXT = { client: { clientName: "WEB", clientVersion: "2.20251101.00.00", hl: "en" } };

/** Reads a video's details and transcript through the tab. Never throws: a video without captions comes back with no segments. */
export async function loadVideo(id: string, fetcher: PageFetcher, userLang = "en"): Promise<Video> {
  const watch = await fetcher("/watch?v=" + id, { credentials: "include" }).catch(() => ({ status: 0, text: "" }));
  const page = watch.status === 200 ? parseWatchPage(watch.text) : { player: null, data: null };
  const player = obj(page.player);
  const details = obj(player?.videoDetails);
  const micro = obj(obj(player?.microformat)?.playerMicroformatRenderer);
  const description = str(details?.shortDescription) || ytText(micro?.description);
  const video: Video = {
    id,
    title: str(details?.title) || ytText(micro?.title),
    channel: str(details?.author) || ytText(micro?.ownerChannelName),
    length: Number(str(details?.lengthSeconds)) || 0,
    published: str(micro?.publishDate).slice(0, 10),
    description,
    chapters: [],
    segments: [],
    language: "",
    auto: false,
    method: "none",
    live: details?.isLiveContent === true && details?.isLive === true,
  };
  const key = page.apiKey ? "&key=" + page.apiKey : "";

  // 1. The transcript panel, as YouTube's "Show transcript" button reads it.
  const params = str(findAll(page.data, "getTranscriptEndpoint", 1)[0]?.params) || defaultTranscriptParams(id);
  const panel = await fetcher("/youtubei/v1/get_transcript?prettyPrint=false" + key, {
    method: "POST",
    body: JSON.stringify({ context: page.context ?? WEB_CONTEXT, params }),
  }).catch(() => ({ status: 0, text: "" }));
  if (panel.status === 200) {
    try {
      const got = parseTranscriptPanel(JSON.parse(panel.text));
      if (got.segments.length) {
        video.segments = got.segments;
        video.chapters = got.chapters;
        video.method = "panel";
      }
    } catch {
      // Not JSON: try the caption files.
    }
  }

  // 2. The caption files the watch page lists; 3. the ones the Android player lists.
  const fromTracks = async (tracks: CaptionTrack[], method: TranscriptMethod): Promise<boolean> => {
    const track = pickTrack(tracks, userLang);
    if (!track) return false;
    for (const format of ["json3", "xml"] as const) {
      const path = trackPath(track, format);
      if (!path) return false;
      const file = await fetcher(path).catch(() => ({ status: 0, text: "" }));
      const segs = file.status === 200 ? parseCaptionFile(file.text) : [];
      if (segs.length) {
        video.segments = segs;
        video.language = track.name || track.languageCode;
        video.auto = track.kind === "asr";
        video.method = method;
        return true;
      }
    }
    return false;
  };
  if (!video.segments.length) await fromTracks(captionTracks(player), "captions");
  if (!video.segments.length) {
    const res = await fetcher("/youtubei/v1/player?prettyPrint=false", {
      method: "POST",
      body: JSON.stringify({ context: ANDROID_CONTEXT, videoId: id }),
    }).catch(() => ({ status: 0, text: "" }));
    if (res.status === 200) {
      try {
        const android = JSON.parse(res.text) as unknown;
        await fromTracks(captionTracks(android), "android");
        if (!video.title) video.title = str(obj(obj(android)?.videoDetails)?.title);
        if (!video.channel) video.channel = str(obj(obj(android)?.videoDetails)?.author);
        if (!video.length) video.length = Number(str(obj(obj(android)?.videoDetails)?.lengthSeconds)) || 0;
        if (!video.description) video.description = str(obj(obj(android)?.videoDetails)?.shortDescription);
      } catch {
        // No captions this way either.
      }
    }
  }
  if (video.method === "panel" && !video.language) {
    const track = pickTrack(captionTracks(player), userLang);
    if (track) {
      video.language = track.name || track.languageCode;
      video.auto = track.kind === "asr";
    }
  }
  if (!video.chapters.length) video.chapters = chaptersFromData(page.data);
  if (!video.chapters.length) video.chapters = chaptersFromDescription(video.description);
  if (!video.length && video.segments.length) video.length = Math.ceil(video.segments[video.segments.length - 1]!.start);
  return video;
}

// ---------- The text the model reads ----------

/** Where the model's page text says it is a video transcript (prompt.ts gives such pages a larger budget). */
export const VIDEO_HEADER = "YouTube video";
/** About 2 to 3 hours of speech; roughly 30,000 tokens. */
export const VIDEO_TRANSCRIPT_BUDGET = 110_000;
/** Room for the transcript plus header, chapters and description. */
export const VIDEO_PAGE_CHARS = VIDEO_TRANSCRIPT_BUDGET + 12_000;
const BLOCK_SECONDS = 30;
const MAX_DESCRIPTION = 3_000;

/**
 * Transcript lines of about 30 seconds each, a new line at every chapter,
 * each starting with its time. Over `budget`, every line is shortened by the
 * same share, so the whole video stays covered.
 */
export function transcriptLines(segments: Segment[], chapters: Chapter[] = [], budget = VIDEO_TRANSCRIPT_BUDGET): string[] {
  const breaks = chapters.map((c) => c.start).filter((s) => s > 0);
  const blocks: Array<{ start: number; text: string }> = [];
  for (const s of segments) {
    const last = blocks[blocks.length - 1];
    const crossesChapter = last && breaks.some((b) => last.start < b && s.start >= b);
    if (!last || s.start - last.start >= BLOCK_SECONDS || crossesChapter) blocks.push({ start: s.start, text: s.text });
    else last.text += " " + s.text;
  }
  const total = blocks.reduce((n, b) => n + b.text.length + 10, 0);
  const share = total > budget ? budget / total : 1;
  return blocks.map((b) => {
    let t = b.text.replace(/\s+/g, " ").trim();
    if (share < 1) {
      const max = Math.max(40, Math.floor(t.length * share));
      if (t.length > max) t = t.slice(0, max).replace(/\s+\S*$/, "") + " …";
    }
    return "[" + formatTime(b.start) + "] " + t;
  });
}

/** The page text for a video: header, chapters, transcript, description. */
export function videoPageText(v: Video, budget = VIDEO_TRANSCRIPT_BUDGET): string {
  const head = [VIDEO_HEADER];
  if (v.channel) head.push("Channel: " + v.channel);
  if (v.length) head.push("Length: " + formatTime(v.length));
  if (v.published) head.push("Published: " + v.published);
  const parts = [head.join("\n")];
  if (v.chapters.length) parts.push("Chapters:\n" + v.chapters.map((c) => "[" + formatTime(c.start) + "] " + c.title).join("\n"));
  if (v.segments.length) {
    const lines = transcriptLines(v.segments, v.chapters, budget);
    const what = v.auto ? "YouTube's automatic captions" : "captions";
    parts.push(
      "Transcript (" + what + (v.language ? ", " + v.language : "") + "; each line starts with its time in the video):\n" + lines.join("\n"),
    );
  } else {
    parts.push(
      v.live
        ? "Transcript: none, this is a live stream. Only the description below is available."
        : "Transcript: none available for this video. Only the description below is available, so say that key points come from the description.",
    );
  }
  if (v.description) {
    const d = v.description.trim();
    parts.push("Description:\n" + (d.length > MAX_DESCRIPTION ? d.slice(0, MAX_DESCRIPTION) + " …" : d));
  }
  return parts.join("\n\n");
}

/**
 * Is this page text a video read by videoPageText? The address must be a
 * YouTube video too: any page can carry the header line (audit 2026-11-10).
 */
export function isVideoText(text: string, url: string): boolean {
  if (youtubeVideoId(url) === null) return false;
  return text.startsWith(VIDEO_HEADER + "\n") || text.includes("\n\n" + VIDEO_HEADER + "\n");
}

/**
 * Runs in the YouTube tab (scripting.executeScript({ func: seekVideo })):
 * jumps the playing video to `seconds` when the tab shows video `id`. False
 * when it does not, so the panel opens the link instead.
 */
export function seekVideo(id: string, seconds: number): boolean {
  const here =
    /[?&]v=([A-Za-z0-9_-]{11})/.exec(location.search)?.[1] ?? /^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{11})/.exec(location.pathname)?.[1];
  if (here !== id || !Number.isFinite(seconds)) return false;
  const video = document.querySelector("video");
  if (!video) return false;
  video.currentTime = Math.max(0, seconds);
  void video.play().catch(() => undefined);
  return true;
}
