// Instagram reader (owner request 2026-11-08: "if you run it on an IG page
// ... it can understand the reel/story/video/photo"). On an Instagram post,
// reel, story or feed, Scout reads the post the user is looking at instead of
// the whole page, and sends its pictures to the model:
//
// - From the page: the account, date, caption, hashtags, location, the reel's
//   audio name, Instagram's own image descriptions (the alt text it writes,
//   "May be an image of ..."), any subtitles the video carries, and the text
//   around the post (likes, the comments shown).
// - Pictures: the photo or carousel slides on screen, and for a video the
//   frame on screen plus a few frames from across it, so the model sees what
//   happens. Drawn on a canvas in the tab, scaled down, re-encoded as JPEG.
//
// No server, no new vendor and no new permission: everything is read from the
// user's own open tab through scripting.executeScript, like the YouTube
// reader. Skill search (2026-11-08) found only tools that need Instagram
// logins or paid transcription services; none fit. Claude can't hear audio,
// so speech reaches the model only as subtitles Instagram shows.
//
// When the pictures can't be drawn (a cross-origin video or image the canvas
// refuses), the page text says so and the model can ask for a screenshot with
// screenshot_visible, which asks the user first.

import type { PageImage } from "../chat/images";

export type InstagramKind = "post" | "reel" | "story" | "feed" | "profile" | "other";

/** Pictures one read may send: photos, carousel slides and video frames together. */
export const MAX_PAGE_IMAGES = 5;
/** Long edge of a picture sent from the page. */
export const PAGE_IMAGE_EDGE = 1092;
export const INSTAGRAM_HEADER = "Instagram ";

const RESERVED = new Set([
  "explore", "accounts", "direct", "reels", "reel", "p", "tv", "stories", "about", "legal", "developer", "web", "challenge",
  "emails", "settings", "privacy", "terms", "session", "login", "signup", "oauth", "api", "graphql", "static", "ajax", "threads",
]);

/** What kind of Instagram page an address is; null when it is not Instagram. */
export function instagramKind(url: string | undefined): InstagramKind | null {
  let u: URL;
  try {
    u = new URL(url ?? "");
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (!/(^|\.)instagram\.com$/i.test(u.hostname)) return null;
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts.length === 0) return "feed";
  const [a, b] = [parts[0]!.toLowerCase(), parts[1]?.toLowerCase()];
  if (a === "stories") return parts.length >= 2 ? "story" : "other";
  if (a === "reel" || a === "reels" || a === "tv") return parts.length >= 2 || a === "reels" ? "reel" : "other";
  if (a === "p") return parts.length >= 2 ? "post" : "other";
  // Links of the form /username/p/CODE/ and /username/reel/CODE/.
  if (!RESERVED.has(a) && (b === "p" || b === "reel") && parts.length >= 3) return b === "p" ? "post" : "reel";
  if (!RESERVED.has(a) && parts.length === 1 && /^[a-z0-9._]{1,30}$/.test(a)) return "profile";
  return "other";
}

/** Pages the Instagram reader handles; a profile or the explore grid keeps the general reader. */
export function readsInstagramPost(url: string | undefined): boolean {
  const k = instagramKind(url);
  return k === "post" || k === "reel" || k === "story" || k === "feed";
}

/** What readInstagram returns. Page data: checked again in the worker (cleanInstagramRead). */
export interface InstagramRead {
  url: string;
  title: string;
  /** "video" | "photo" | "carousel" | "none": what the post on screen is. */
  media: string;
  author?: string;
  date?: string;
  dateLabel?: string;
  caption?: string;
  hashtags: string[];
  location?: string;
  audio?: string;
  alts: string[];
  /** Seconds. */
  duration?: number;
  current?: number;
  paused?: boolean;
  muted?: boolean;
  subtitles: string[];
  /** Visible text of the post and what is around it (likes, comments shown). */
  around: string;
  images: PageImage[];
  /** Pictures were on screen but the browser refused to draw them. */
  blocked: boolean;
}

export interface ReadOptions {
  maxImages?: number;
  edge?: number;
  /** Frames from across a video, besides the one on screen. */
  frames?: number;
  /** The whole read, in ms; frame seeking stops at this deadline. */
  budgetMs?: number;
}

/**
 * Runs in the Instagram tab (scripting.executeScript({ func: readInstagram })),
 * so it must stay self-contained: no imports, no helpers from outside.
 */
export async function readInstagram(opts: ReadOptions = {}): Promise<InstagramRead> {
  const maxImages = opts.maxImages ?? 5;
  const edge = opts.edge ?? 1092;
  const extraFrames = opts.frames ?? 3;
  const deadline = Date.now() + (opts.budgetMs ?? 4500);
  const vw = window.innerWidth || document.documentElement.clientWidth;
  const vh = window.innerHeight || document.documentElement.clientHeight;
  const squash = (s: string | null | undefined): string => (s ?? "").replace(/\s+/g, " ").trim();
  const visible = (el: Element): number => {
    const r = el.getBoundingClientRect();
    const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
    const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    return w * h;
  };
  const big = (el: Element): boolean => {
    const r = el.getBoundingClientRect();
    return r.width >= 150 && r.height >= 150;
  };
  const isAvatar = (img: HTMLImageElement): boolean => /profile picture|avatar/i.test(img.alt || "");

  // The post on screen: the largest visible photo or video.
  const candidates = Array.from(document.querySelectorAll<HTMLImageElement | HTMLVideoElement>("video, img")).filter(
    (el) => big(el) && !(el instanceof HTMLImageElement && isAvatar(el)),
  );
  let main: HTMLImageElement | HTMLVideoElement | null = null;
  let best = 0;
  for (const el of candidates) {
    const a = visible(el);
    if (a > best) {
      best = a;
      main = el;
    }
  }

  // Its container: the dialog or article around it, else the largest
  // ancestor that holds no other video (the next reel) and is not much taller
  // than the screen.
  let root: Element = document.querySelector("main") ?? document.body;
  // A post opened over the feed or a profile: the dialog holds the post and its caption.
  const dialog = main?.closest("[role='dialog']");
  if (dialog) root = dialog;
  else if (main) {
    root = main;
    for (let el = main.parentElement; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
      if (el.matches("article, [role='dialog']")) {
        root = el;
        break;
      }
      if (main instanceof HTMLVideoElement && el.querySelectorAll("video").length > 1) break;
      if (el.getBoundingClientRect().height > vh * 2.5) break;
      root = el;
    }
  }

  const textOf = (el: Element | null): string => squash((el as HTMLElement | null)?.innerText ?? el?.textContent ?? "");
  const userRe = /^[A-Za-z0-9._]{1,30}$/;
  let author: string | undefined;
  for (const a of Array.from(root.querySelectorAll<HTMLAnchorElement>("header a[href], a[href]"))) {
    const t = textOf(a);
    const href = a.getAttribute("href") ?? "";
    if (userRe.test(t) && (href === "/" + t + "/" || href === "/" + t)) {
      author = t;
      break;
    }
  }
  const story = /^\/stories\/([^/]+)\//.exec(location.pathname);
  if (!author && story && story[1] !== "highlights") author = story[1];

  const time = root.querySelector<HTMLTimeElement>("time[datetime]");
  const date = time?.getAttribute("datetime") ?? undefined;
  const dateLabel = squash(time?.getAttribute("title") || time?.textContent) || undefined;

  // The caption: Instagram's post view puts it in an h1. Else the page's
  // og:description, but only when it describes this address (Instagram keeps
  // the first page's meta tags after moving to another post).
  let caption = textOf(root.querySelector("h1")) || undefined;
  if (!caption) {
    const ogUrl = document.querySelector<HTMLMetaElement>("meta[property='og:url']")?.content ?? "";
    let same = false;
    try {
      same = !!ogUrl && new URL(ogUrl, location.href).pathname.replace(/\/$/, "") === location.pathname.replace(/\/$/, "");
    } catch {
      same = false;
    }
    if (same) caption = squash(document.querySelector<HTMLMetaElement>("meta[property='og:description']")?.content) || undefined;
  }

  const uniq = (xs: string[]): string[] => [...new Set(xs.filter(Boolean))];
  const linkTexts = (sel: string): string[] => uniq(Array.from(root.querySelectorAll(sel)).map((a) => textOf(a)));
  const hashtags = uniq([...linkTexts("a[href*='/explore/tags/']"), ...((caption ?? "").match(/#[\p{L}\p{N}_]+/gu) ?? [])])
    .map((t) => (t.startsWith("#") ? t : "#" + t))
    .slice(0, 30);
  const location_ = linkTexts("a[href*='/explore/locations/']")[0];
  const audio = linkTexts("a[href*='/reels/audio/'], a[href*='/audio/']")[0];

  const photos = Array.from(root.querySelectorAll<HTMLImageElement>("img")).filter((i) => big(i) && !isAvatar(i));
  const alts = uniq(photos.map((i) => squash(i.alt))).slice(0, 10);
  const video = main instanceof HTMLVideoElement ? main : null;
  const media = video ? "video" : photos.length > 1 ? "carousel" : photos.length === 1 ? "photo" : "none";

  // Subtitles the video carries, if any: tracks are switched to "hidden"
  // (loaded, not shown) for a moment and put back.
  const subtitles: string[] = [];
  if (video && video.textTracks) {
    const tracks = Array.from(video.textTracks).filter((t) => t.kind === "subtitles" || t.kind === "captions");
    const before = tracks.map((t) => t.mode);
    for (const t of tracks) if (t.mode === "disabled") t.mode = "hidden";
    if (tracks.length) await new Promise((r) => setTimeout(r, 250));
    for (const t of tracks) {
      for (const c of Array.from(t.cues ?? [])) {
        const text = squash((c as VTTCue).text?.replace(/<[^>]+>/g, " "));
        if (text) subtitles.push(Math.floor(c.startTime) + "|" + text);
      }
    }
    tracks.forEach((t, i) => (t.mode = before[i]!));
  }

  // ---- Pictures ----
  const images: PageImage[] = [];
  let blocked = false;
  const draw = (src: CanvasImageSource, w: number, h: number): { data: string; width: number; height: number } | null => {
    if (!w || !h) return null;
    const scale = Math.min(1, edge / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(h * scale));
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    try {
      ctx.drawImage(src, 0, 0, c.width, c.height);
      const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(c.toDataURL("image/jpeg", 0.8));
      return m ? { data: m[1]!, width: c.width, height: c.height } : null;
    } catch {
      // A cross-origin picture taints the canvas: the browser refuses to read it.
      return null;
    }
  };
  const fetched = async (url: string): Promise<{ data: string; width: number; height: number } | null> => {
    if (!/^https?:\/\//.test(url) || typeof createImageBitmap !== "function") return null;
    try {
      const res = await fetch(url, { mode: "cors", credentials: "omit" });
      if (!res.ok) return null;
      const bmp = await createImageBitmap(await res.blob());
      try {
        return draw(bmp, bmp.width, bmp.height);
      } finally {
        bmp.close();
      }
    } catch {
      return null;
    }
  };
  const add = (pic: { data: string; width: number; height: number } | null, label: string): boolean => {
    if (!pic || images.length >= maxImages) return false;
    images.push({ mediaType: "image/jpeg", data: pic.data, width: pic.width, height: pic.height, label });
    return true;
  };
  const clock = (s: number): string => {
    const t = Math.max(0, Math.floor(s));
    return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0");
  };

  const duration = video && Number.isFinite(video.duration) && video.duration > 0 ? video.duration : undefined;
  const current = video ? video.currentTime : undefined;
  const paused = video ? video.paused : undefined;
  const muted = video ? video.muted : undefined;

  if (video) {
    const seen = video.readyState >= 2 ? draw(video, video.videoWidth, video.videoHeight) : null;
    if (seen) {
      const frames: Array<{ t: number; pic: { data: string; width: number; height: number }; now: boolean }> = [
        { t: video.currentTime, pic: seen, now: true },
      ];
      // A few more frames from across the video, then back where it was.
      if (duration && duration >= 3 && extraFrames > 0) {
        const t0 = video.currentTime;
        const wasPaused = video.paused;
        const room = Math.min(extraFrames, maxImages - 1);
        // room + 1 evenly spaced points; the one nearest the frame on screen is that frame.
        const points = Array.from({ length: room + 1 }, (_, i) => (duration * (i + 0.5)) / (room + 1));
        let near = 0;
        points.forEach((t, i) => (Math.abs(t - t0) < Math.abs(points[near]! - t0) ? (near = i) : 0));
        const targets = points.filter((_, i) => i !== near);
        if (targets.length) {
          video.pause();
          try {
            for (const t of targets) {
              const left = deadline - Date.now();
              if (left < 300) break;
              await new Promise<void>((resolve) => {
                const done = (): void => {
                  clearTimeout(timer);
                  video.removeEventListener("seeked", done);
                  resolve();
                };
                const timer = setTimeout(done, Math.min(1500, left));
                video.addEventListener("seeked", done);
                video.currentTime = t;
              });
              if (Math.abs(video.currentTime - t) > 1.5 || video.readyState < 2) continue;
              const pic = draw(video, video.videoWidth, video.videoHeight);
              if (pic) frames.push({ t: video.currentTime, pic, now: false });
            }
          } finally {
            video.currentTime = t0;
            if (!wasPaused) void video.play().catch(() => undefined);
          }
        }
      }
      frames.sort((a, b) => a.t - b.t);
      for (const f of frames) {
        add(f.pic, "Video frame at " + clock(f.t) + (duration ? " of " + clock(duration) : "") + (f.now ? " (what the user is seeing now)" : ""));
      }
    } else {
      blocked = true;
      if (video.poster) add(await fetched(new URL(video.poster, location.href).href), "The video's cover image");
    }
  }

  // Photos: the one on screen first, then the other slides already loaded.
  const ordered = [...photos].sort((a, b) => visible(b) - visible(a));
  let slide = 0;
  for (const img of ordered) {
    if (images.length >= maxImages) break;
    if (!img.complete || !img.naturalWidth) continue;
    slide++;
    const label = (media === "carousel" ? (slide === 1 ? "Carousel slide on screen" : "Another carousel slide") : "Photo") + (img.alt ? ": " + squash(img.alt).slice(0, 160) : "");
    const pic = draw(img, img.naturalWidth, img.naturalHeight) ?? (await fetched(img.currentSrc || img.src));
    if (!add(pic, label)) blocked = true;
  }
  if (images.length) blocked = false;

  const around = ((root as HTMLElement).innerText ?? root.textContent ?? "")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, 8000);

  return {
    url: location.href,
    title: document.title,
    media,
    ...(author ? { author } : {}),
    ...(date ? { date } : {}),
    ...(dateLabel ? { dateLabel } : {}),
    ...(caption ? { caption } : {}),
    hashtags,
    ...(location_ ? { location: location_ } : {}),
    ...(audio ? { audio } : {}),
    alts,
    ...(duration ? { duration } : {}),
    ...(current !== undefined ? { current } : {}),
    ...(paused !== undefined ? { paused } : {}),
    ...(muted !== undefined ? { muted } : {}),
    subtitles: subtitles.slice(0, 400),
    around,
    images,
    blocked,
  };
}

// ---------- In the worker ----------

const s = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const strs = (v: unknown, n: number, max: number): string[] => (Array.isArray(v) ? v.map((x) => s(x, max)).filter(Boolean).slice(0, n) : []);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);

/** Pictures from the page, checked: JPEG or PNG base64 under the provider's size limit, with a short label. */
export function cleanPageImages(v: unknown, max = MAX_PAGE_IMAGES): PageImage[] {
  if (!Array.isArray(v)) return [];
  const out: PageImage[] = [];
  for (const x of v) {
    if (out.length >= max) break;
    if (!x || typeof x !== "object") continue;
    const i = x as Record<string, unknown>;
    if (i.mediaType !== "image/jpeg" && i.mediaType !== "image/png") continue;
    if (typeof i.data !== "string" || !i.data || i.data.length > 4_500_000 || !/^[A-Za-z0-9+/=]+$/.test(i.data)) continue;
    out.push({
      mediaType: i.mediaType,
      data: i.data,
      width: num(i.width) ?? 0,
      height: num(i.height) ?? 0,
      label: s(i.label, 200) || "Picture from the page",
    });
  }
  return out;
}

/** The in-tab result, checked (page data is untrusted input); null when it is not a read. */
export function cleanInstagramRead(raw: unknown): InstagramRead | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const url = s(r.url, 2000);
  if (!url) return null;
  const opt = <K extends string, V>(k: K, v: V | undefined | ""): { [P in K]?: V } => (v === undefined || v === "" ? {} : ({ [k]: v } as { [P in K]?: V }));
  return {
    url,
    title: s(r.title, 300),
    media: ["video", "photo", "carousel", "none"].includes(r.media as string) ? (r.media as string) : "none",
    ...opt("author", s(r.author, 60)),
    ...opt("date", s(r.date, 60)),
    ...opt("dateLabel", s(r.dateLabel, 80)),
    ...opt("caption", s(r.caption, 4000)),
    hashtags: strs(r.hashtags, 30, 80),
    ...opt("location", s(r.location, 200)),
    ...opt("audio", s(r.audio, 200)),
    alts: strs(r.alts, 10, 400),
    ...opt("duration", num(r.duration)),
    ...opt("current", num(r.current)),
    ...(typeof r.paused === "boolean" ? { paused: r.paused } : {}),
    ...(typeof r.muted === "boolean" ? { muted: r.muted } : {}),
    subtitles: strs(r.subtitles, 400, 400),
    around: typeof r.around === "string" ? r.around.slice(0, 8000) : "",
    images: cleanPageImages(r.images),
    blocked: r.blocked === true,
  };
}

function clockOf(seconds: number): string {
  const t = Math.max(0, Math.floor(seconds));
  return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0");
}

const KIND_NAME: Record<InstagramKind, string> = {
  post: "post",
  reel: "reel",
  story: "story",
  feed: "post (from the feed)",
  profile: "profile",
  other: "page",
};

/** The text the model reads for an Instagram post: what Instagram says about it, then the text around it. */
export function instagramPageText(r: InstagramRead, kind: InstagramKind): string {
  const lines: string[] = [INSTAGRAM_HEADER + KIND_NAME[kind]];
  const what = r.media === "video" ? "a video" : r.media === "carousel" ? "a carousel of photos" : r.media === "photo" ? "a photo" : "no photo or video Scout could find";
  lines.push("Shows: " + what);
  if (r.author) lines.push("Account: @" + r.author);
  if (r.date || r.dateLabel) lines.push("Posted: " + [r.dateLabel, r.date].filter(Boolean).join(" (") + (r.dateLabel && r.date ? ")" : ""));
  if (r.location) lines.push("Location tag: " + r.location);
  if (r.audio) lines.push("Audio: " + r.audio);
  if (r.duration !== undefined) {
    const at = r.current !== undefined ? ", " + (r.paused ? "paused" : "playing") + " at " + clockOf(r.current) : "";
    lines.push("Video length: " + clockOf(r.duration) + at + (r.muted === undefined ? "" : r.muted ? ", sound off" : ", sound on"));
  }
  if (r.caption) lines.push("", "Caption:", r.caption);
  if (r.hashtags.length) lines.push("", "Hashtags: " + r.hashtags.join(" "));
  if (r.alts.length) lines.push("", "Instagram's descriptions of the pictures:", ...r.alts.map((a) => "- " + a));
  if (r.subtitles.length) {
    lines.push("", "Subtitles in the video:");
    for (const line of r.subtitles) {
      const m = /^(\d+)\|(.*)$/.exec(line);
      lines.push(m ? "[" + clockOf(Number(m[1])) + "] " + m[2] : line);
    }
  } else if (r.media === "video") {
    lines.push("", "The video has no subtitles Scout can read, and the model can't hear audio: say so if the answer depends on what is said.");
  }
  if (r.blocked && r.images.length === 0) {
    lines.push("", "Scout couldn't capture the pictures directly. If seeing them matters, take a screenshot with the screenshot_visible tool.");
  }
  if (r.around) lines.push("", "Text on the page around the post:", r.around);
  return lines.join("\n");
}
