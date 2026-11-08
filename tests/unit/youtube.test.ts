// YouTube key points (owner request 2026-11-08): captions read through the
// user's own tab, fitted for the model, and [m:ss] times in answers.
import { describe, expect, it } from "vitest";
import {
  captionTracks,
  chaptersFromData,
  chaptersFromDescription,
  defaultTranscriptParams,
  formatTime,
  isVideoText,
  jsonAfter,
  loadVideo,
  parseJson3,
  parseTime,
  parseTimedTextXml,
  parseTranscriptPanel,
  pickTrack,
  trackPath,
  transcriptLines,
  videoPageText,
  youtubeVideoId,
  VIDEO_TRANSCRIPT_BUDGET,
  type FetchInit,
  type FetchResult,
  type Video,
} from "../../src/context/youtube";
import { toPageContext } from "../../src/context/clean";
import { buildMessages, FORMAT_RULES, PAGE_CHAR_BUDGET, starterLabel } from "../../src/chat/prompt";
import { parseInline } from "../../src/chat/markdown";
import { suggestionsFor, VIDEO_SUGGESTIONS } from "../../src/panel/suggestions";
import { classifyQuestion } from "../../src/chat/intent";

const ID = "dQw4w9WgXcQ";

describe("YouTube video addresses", () => {
  it("finds the video on watch, Shorts, live, embed, mobile and youtu.be addresses", () => {
    expect(youtubeVideoId("https://www.youtube.com/watch?v=" + ID)).toBe(ID);
    expect(youtubeVideoId("https://m.youtube.com/watch?v=" + ID + "&t=42s")).toBe(ID);
    expect(youtubeVideoId("https://youtube.com/watch?feature=share&v=" + ID)).toBe(ID);
    expect(youtubeVideoId("https://www.youtube.com/shorts/" + ID)).toBe(ID);
    expect(youtubeVideoId("https://www.youtube.com/live/" + ID + "?si=x")).toBe(ID);
    expect(youtubeVideoId("https://www.youtube-nocookie.com/embed/" + ID)).toBe(ID);
    expect(youtubeVideoId("https://youtu.be/" + ID + "?t=10")).toBe(ID);
    expect(youtubeVideoId("https://music.youtube.com/watch?v=" + ID)).toBe(ID);
  });

  it("ignores other pages and lookalike hosts", () => {
    expect(youtubeVideoId("https://www.youtube.com/")).toBeNull();
    expect(youtubeVideoId("https://www.youtube.com/@channel/videos")).toBeNull();
    expect(youtubeVideoId("https://www.youtube.com/results?search_query=cats")).toBeNull();
    expect(youtubeVideoId("https://youtube.com.evil.io/watch?v=" + ID)).toBeNull();
    expect(youtubeVideoId("https://notyoutube.com/watch?v=" + ID)).toBeNull();
    expect(youtubeVideoId("https://www.youtube.com/watch?v=short")).toBeNull();
    expect(youtubeVideoId("file:///watch?v=" + ID)).toBeNull();
    expect(youtubeVideoId(undefined)).toBeNull();
  });
});

describe("times", () => {
  it("reads and writes m:ss and h:mm:ss", () => {
    expect(parseTime("4:05")).toBe(245);
    expect(parseTime("1:02:03")).toBe(3723);
    expect(parseTime("0:00")).toBe(0);
    expect(parseTime("4:75")).toBeNaN();
    expect(parseTime("12")).toBeNaN();
    expect(formatTime(245)).toBe("4:05");
    expect(formatTime(3723.9)).toBe("1:02:03");
    expect(formatTime(5)).toBe("0:05");
  });
});

describe("the watch page's data", () => {
  it("reads an object literal and the escaped string m.youtube.com uses", () => {
    const html = 'x<script>var ytInitialPlayerResponse = {"a":{"b":"}{\\"q"},"c":[1,2]};var other = 1;</script>';
    expect(jsonAfter(html, "ytInitialPlayerResponse")).toEqual({ a: { b: '}{"q' }, c: [1, 2] });
    const mobile = "<script>var ytInitialData = '\\x7b\\x22k\\x22:\\x22v\\x22\\x7d';</script>";
    expect(jsonAfter(mobile, "ytInitialData")).toEqual({ k: "v" });
    expect(jsonAfter("nothing here", "ytInitialData")).toBeNull();
  });

  it("skips a mention that is not an assignment", () => {
    const html = 'if (window.ytInitialPlayerResponse) x(); var ytInitialPlayerResponse = {"ok":true};';
    expect(jsonAfter(html, "ytInitialPlayerResponse")).toEqual({ ok: true });
  });

  it("lists caption tracks and picks the best one", () => {
    const player = {
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [
            { baseUrl: "https://www.youtube.com/api/timedtext?v=x&lang=de", languageCode: "de", name: { simpleText: "German" } },
            { baseUrl: "https://www.youtube.com/api/timedtext?v=x&lang=en&kind=asr", languageCode: "en", kind: "asr", name: { runs: [{ text: "English (auto-generated)" }] } },
            { baseUrl: "https://www.youtube.com/api/timedtext?v=x&lang=en-US", languageCode: "en-US", name: { simpleText: "English" } },
          ],
        },
      },
    };
    const tracks = captionTracks(player);
    expect(tracks).toHaveLength(3);
    expect(pickTrack(tracks, "en-GB")?.name).toBe("English");
    expect(pickTrack(tracks, "de-DE")?.name).toBe("German");
    // No track in French: the people-written one in the spoken language (English).
    expect(pickTrack(tracks, "fr")?.name).toBe("English");
    expect(pickTrack(tracks.filter((t) => t.languageCode !== "en-US"), "fr")?.name).toBe("English (auto-generated)");
    expect(pickTrack([], "en")).toBeNull();
  });

  it("asks for caption files on the tab's own host only", () => {
    expect(trackPath({ baseUrl: "https://www.youtube.com/api/timedtext?v=x&fmt=srv3", languageCode: "en", name: "" }, "json3")).toBe(
      "/api/timedtext?v=x&fmt=json3",
    );
    expect(trackPath({ baseUrl: "/api/timedtext?v=x", languageCode: "en", name: "" }, "xml")).toBe("/api/timedtext?v=x");
    expect(trackPath({ baseUrl: "https://evil.example/api/timedtext?v=x", languageCode: "en", name: "" }, "json3")).toBeNull();
  });

  it("builds get_transcript params for the video", () => {
    expect(atob(defaultTranscriptParams(ID))).toBe("\n\x0b" + ID);
  });
});

describe("caption formats", () => {
  it("reads YouTube's transcript panel, with chapter headers", () => {
    const json = {
      actions: [
        {
          updateEngagementPanelAction: {
            content: {
              transcriptRenderer: {
                body: {
                  initialSegments: [
                    { transcriptSectionHeaderRenderer: { startMs: "0", snippet: { simpleText: "Intro" } } },
                    { transcriptSegmentRenderer: { startMs: "1200", snippet: { runs: [{ text: "Hello " }, { text: "there &amp; welcome" }] } } },
                    { transcriptSegmentRenderer: { startMs: "65000", snippet: { simpleText: "Next part" } } },
                  ],
                },
              },
            },
          },
        },
      ],
    };
    const got = parseTranscriptPanel(json);
    expect(got.segments).toEqual([
      { start: 1.2, text: "Hello there & welcome" },
      { start: 65, text: "Next part" },
    ]);
    expect(got.chapters).toEqual([{ start: 0, title: "Intro" }]);
  });

  it("reads json3 caption files", () => {
    const text = JSON.stringify({
      events: [
        { tStartMs: 0, dDurationMs: 1000 },
        { tStartMs: 1500, segs: [{ utf8: "first" }, { utf8: " line" }] },
        { tStartMs: 3000, segs: [{ utf8: "\n" }] },
        { tStartMs: 4000, segs: [{ utf8: "it&#39;s second" }] },
      ],
    });
    expect(parseJson3(text)).toEqual([
      { start: 1.5, text: "first line" },
      { start: 4, text: "it's second" },
    ]);
    expect(parseJson3("not json")).toEqual([]);
  });

  it("reads XML caption files, both formats", () => {
    const v1 = '<?xml version="1.0"?><transcript><text start="0.5" dur="2">Don&amp;#39;t stop</text><text start="3" dur="1">go &lt;on&gt;</text></transcript>';
    expect(parseTimedTextXml(v1)).toEqual([
      { start: 0.5, text: "Don't stop" },
      { start: 3, text: "go" },
    ]);
    const srv3 = '<timedtext><body><p t="2000" d="1000"><s>word</s><s t="300"> two</s></p></body></timedtext>';
    expect(parseTimedTextXml(srv3)).toEqual([{ start: 2, text: "word two" }]);
  });
});

describe("chapters", () => {
  it("reads chapters from a description that starts at 0:00", () => {
    const desc = "My video\n\n0:00 Intro\n1:30 - Setup\n12:05 The test\n1:02:00 Wrap up\nThanks!";
    expect(chaptersFromDescription(desc)).toEqual([
      { start: 0, title: "Intro" },
      { start: 90, title: "Setup" },
      { start: 725, title: "The test" },
      { start: 3720, title: "Wrap up" },
    ]);
    expect(chaptersFromDescription("Buy at 1:30 pm\n2:45 later")).toEqual([]);
  });

  it("reads chapters from the player bar", () => {
    const data = { markers: [{ chapterRenderer: { title: { simpleText: "Two" }, timeRangeStartMillis: 60000 } }, { chapterRenderer: { title: { simpleText: "One" }, timeRangeStartMillis: 0 } }] };
    expect(chaptersFromData(data)).toEqual([
      { start: 0, title: "One" },
      { start: 60, title: "Two" },
    ]);
  });
});

describe("transcript text for the model", () => {
  const segs = Array.from({ length: 600 }, (_, i) => ({ start: i * 6, text: "word ".repeat(20).trim() + " " + i }));

  it("groups captions into lines of about 30 seconds, each with its time", () => {
    const lines = transcriptLines(segs.slice(0, 12));
    expect(lines[0]).toMatch(/^\[0:00\] word/);
    expect(lines[1]).toMatch(/^\[0:30\] /);
    expect(lines).toHaveLength(3);
  });

  it("starts a new line at each chapter", () => {
    const lines = transcriptLines(segs.slice(0, 5), [{ start: 0, title: "a" }, { start: 12, title: "b" }]);
    expect(lines.map((l) => l.slice(0, 7))).toEqual(["[0:00] ", "[0:12] "]);
  });

  it("trims a long video evenly, so the ending is still there", () => {
    const lines = transcriptLines(segs, [], 20_000);
    const text = lines.join("\n");
    expect(text.length).toBeLessThan(26_000);
    expect(lines[0]).toMatch(/^\[0:00\] /);
    expect(lines[lines.length - 1]).toMatch(/^\[59:30\] /);
    expect(lines.every((l) => l.length > 30)).toBe(true);
  });

  const video: Video = {
    id: ID,
    title: "How it works",
    channel: "Some Channel",
    length: 754,
    published: "2025-03-02",
    description: "About this.\n0:00 Intro",
    chapters: [{ start: 0, title: "Intro" }],
    segments: [{ start: 0, text: "hi" }, { start: 40, text: "more" }],
    language: "English",
    auto: true,
    method: "panel",
    live: false,
  };

  it("writes a header, chapters, transcript and description", () => {
    const text = videoPageText(video);
    expect(text).toContain("YouTube video\nChannel: Some Channel\nLength: 12:34\nPublished: 2025-03-02");
    expect(text).toContain("Chapters:\n[0:00] Intro");
    expect(text).toContain("Transcript (YouTube's automatic captions, English; each line starts with its time in the video):\n[0:00] hi\n[0:40] more");
    expect(text).toContain("Description:\nAbout this.");
    expect(isVideoText(text)).toBe(true);
    expect(isVideoText("Some article\n\nYouTube video is great")).toBe(false);
  });

  it("says so when a video has no transcript", () => {
    const text = videoPageText({ ...video, segments: [], method: "none" });
    expect(text).toContain("Transcript: none available for this video.");
    expect(text).toContain("Description:");
  });

  it("keeps a long transcript whole through the page cleaner and the prompt", () => {
    const long = videoPageText({ ...video, segments: segs.concat(segs.map((s) => ({ ...s, start: s.start + 3600 }))) });
    expect(long.length).toBeGreaterThan(60_000);
    expect(long.length).toBeLessThan(VIDEO_TRANSCRIPT_BUDGET + 20_000);
    const cleaned = toPageContext({ url: "https://www.youtube.com/watch?v=" + ID, title: "How it works", text: long, meta: { site: "YouTube" } });
    expect(cleaned?.partial).toBe(false);
    expect(cleaned?.page.text.endsWith("0:00 Intro")).toBe(true);
    const [msg] = buildMessages([], "Key points?", cleaned!.page);
    expect(String(msg!.content)).not.toContain("[page text truncated]");
    expect(String(msg!.content)).toContain("[1:59:30]");
  });

  it("still holds other pages to the usual budget", () => {
    const article = { url: "https://example.com/a", title: "A", text: "x".repeat(PAGE_CHAR_BUDGET + 5_000) };
    const [msg] = buildMessages([], "Summarize", article);
    expect(String(msg!.content)).toContain("[page text truncated]");
  });
});

describe("reading a video through the tab", () => {
  const playerJson = {
    videoDetails: { title: "How it works", author: "Some Channel", lengthSeconds: "754", shortDescription: "About.\n0:00 Start\n1:00 Middle\n2:00 End" },
    microformat: { playerMicroformatRenderer: { publishDate: "2025-03-02T00:00:00-08:00" } },
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [{ baseUrl: "https://www.youtube.com/api/timedtext?v=" + ID + "&lang=en&kind=asr", languageCode: "en", kind: "asr", name: { simpleText: "English (auto-generated)" } }],
      },
    },
  };
  const html =
    '<script>ytcfg.set({"INNERTUBE_API_KEY":"AIzaFAKE_key-1","INNERTUBE_CONTEXT":{"client":{"clientName":"WEB","clientVersion":"2.1"}}});</script>' +
    "<script>var ytInitialPlayerResponse = " + JSON.stringify(playerJson) + ";</script>" +
    '<script>var ytInitialData = {"engagementPanels":[{"getTranscriptEndpoint":{"params":"PAGEPARAMS"}}]};</script>';
  const panelJson = { actions: [{ transcriptSegmentRenderer: { startMs: "0", snippet: { simpleText: "from the panel" } } }] };
  const json3 = JSON.stringify({ events: [{ tStartMs: 0, segs: [{ utf8: "from the caption file" }] }] });

  function fetcher(routes: Record<string, (init?: FetchInit) => FetchResult>) {
    const calls: Array<{ path: string; init?: FetchInit }> = [];
    const f = async (path: string, init?: FetchInit): Promise<FetchResult> => {
      calls.push({ path, ...(init ? { init } : {}) });
      const key = Object.keys(routes).find((k) => path.startsWith(k));
      return key ? routes[key]!(init) : { status: 404, text: "" };
    };
    return { f, calls };
  }

  it("uses YouTube's transcript panel first, with the page's own params", async () => {
    const { f, calls } = fetcher({
      "/watch": () => ({ status: 200, text: html }),
      "/youtubei/v1/get_transcript": () => ({ status: 200, text: JSON.stringify(panelJson) }),
    });
    const v = await loadVideo(ID, f, "en-US");
    expect(v.method).toBe("panel");
    expect(v.segments).toEqual([{ start: 0, text: "from the panel" }]);
    expect(v).toMatchObject({ title: "How it works", channel: "Some Channel", length: 754, published: "2025-03-02", language: "English (auto-generated)", auto: true });
    expect(v.chapters.map((c) => c.title)).toEqual(["Start", "Middle", "End"]);
    expect(calls[0]).toEqual({ path: "/watch?v=" + ID, init: { credentials: "include" } });
    expect(calls[1]!.path).toBe("/youtubei/v1/get_transcript?prettyPrint=false&key=AIzaFAKE_key-1");
    const body = JSON.parse(calls[1]!.init!.body!);
    expect(body).toEqual({ context: { client: { clientName: "WEB", clientVersion: "2.1" } }, params: "PAGEPARAMS" });
    // Only the watch page is asked with the user's cookies.
    expect(calls.slice(1).every((c) => c.init?.credentials !== "include")).toBe(true);
  });

  it("falls back to the caption file when the panel fails", async () => {
    const { f, calls } = fetcher({
      "/watch": () => ({ status: 200, text: html }),
      "/youtubei/v1/get_transcript": () => ({ status: 400, text: "{}" }),
      "/api/timedtext": () => ({ status: 200, text: json3 }),
    });
    const v = await loadVideo(ID, f);
    expect(v.method).toBe("captions");
    expect(v.segments[0]!.text).toBe("from the caption file");
    expect(calls.some((c) => c.path.includes("fmt=json3"))).toBe(true);
  });

  it("tries the Android player's caption list when the web ones come back empty", async () => {
    const androidPlayer = {
      videoDetails: { title: "T" },
      captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl: "https://www.youtube.com/api/timedtext?v=" + ID + "&android=1", languageCode: "en", name: { simpleText: "English" } }] } },
    };
    const { f } = fetcher({
      "/watch": () => ({ status: 200, text: html }),
      "/youtubei/v1/get_transcript": () => ({ status: 403, text: "" }),
      "/youtubei/v1/player": () => ({ status: 200, text: JSON.stringify(androidPlayer) }),
      "/api/timedtext?v=dQw4w9WgXcQ&android=1": () => ({ status: 200, text: json3 }),
      "/api/timedtext": () => ({ status: 200, text: "" }),
    });
    const v = await loadVideo(ID, f);
    expect(v.method).toBe("android");
    expect(v.language).toBe("English");
    expect(v.auto).toBe(false);
  });

  it("comes back with the description when there are no captions, and never throws", async () => {
    const { f } = fetcher({ "/watch": () => ({ status: 200, text: html }) });
    const v = await loadVideo(ID, f);
    expect(v.method).toBe("none");
    expect(v.segments).toEqual([]);
    expect(v.description).toContain("About.");
    const broken = await loadVideo(ID, async () => {
      throw new Error("tab closed");
    });
    expect(broken.method).toBe("none");
  });
});

describe("answers and starters", () => {
  it("reads [4:05] and [1:02:03] as video times, not citations or links", () => {
    expect(parseInline("Setup is easy [4:05].")).toEqual([
      { type: "text", text: "Setup is easy " },
      { type: "time", seconds: 245, label: "4:05" },
      { type: "text", text: "." },
    ]);
    expect(parseInline("[1:02:03]")).toEqual([{ type: "time", seconds: 3723, label: "1:02:03" }]);
    expect(parseInline("see [2]")[1]).toEqual({ type: "cite", n: 2 });
    expect(parseInline("[4:05](https://example.com)")[0]?.type).toBe("link");
    expect(parseInline("[4:75]")).toEqual([{ type: "text", text: "[4:75]" }]);
  });

  it("tells the model to mark points with transcript times", () => {
    expect(FORMAT_RULES).toContain("[4:05]");
  });

  it("offers video starters on a YouTube video, labelled briefly in the chat", () => {
    const s = suggestionsFor("https://www.youtube.com/watch?v=" + ID);
    expect(s?.site.name).toBe("YouTube");
    expect(s?.items.map((i) => i.label)).toEqual(["Key points with timestamps", "Summarize the video", "Is it worth watching?", "Write a post about it"]);
    expect(suggestionsFor("https://www.youtube.com/")).toBeNull();
    for (const v of VIDEO_SUGGESTIONS) {
      expect(starterLabel(v.prompt)).toBe(v.label);
      // Each starter is about the open page, so the transcript goes with it.
      expect(classifyQuestion({ question: v.prompt })).toBe("page");
    }
  });
});
