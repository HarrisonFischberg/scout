// Plain-English steps while Scout works on an answer (owner, 2026-11-08):
// one line under the question says what is happening now, in big steps only
// ("Reading the page", "Searching the web for …", "Writing your summary").
// Each finished step fades out and the next takes its place; the first words
// of the answer replace the line. Every step comes from real progress: the
// panel's own page read, the provider's search, fetch and thinking blocks,
// and the browser tools the model asks for. Nothing runs on a timer.

/** A step the answer engine reports (src/server/engine.ts), kept in the store. */
export type ServerStep =
  | { step: "search"; detail?: string }
  | { step: "results"; count?: number }
  | { step: "fetch"; detail?: string }
  | { step: "thinking" }
  | { step: "writing" };

export const SERVER_STEPS: readonly ServerStep["step"][] = ["search", "results", "fetch", "thinking", "writing"];

/** The latest step of an answer: one the server reported, a handoff, or a browser tool. */
export type Step = ServerStep | { step: "handoff" } | { step: "tool"; name: string };

/** What the answer is about, for the wording. */
export interface StepContext {
  /** Summarize (page, YouTube video or Instagram post). */
  summary: boolean;
}

const MAX_DETAIL = 40;

/** A search query or host, short enough for one line. */
function short(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > MAX_DETAIL ? t.slice(0, MAX_DETAIL - 1).replace(/\s+\S*$/, "") + "…" : t;
}

const TOOL_STEP: Record<string, string> = {
  read_page: "Reading the page",
  search_tabs: "Looking through your tabs",
  screenshot_visible: "Looking at the screen",
  open_tab: "Opening a tab",
  close_tabs: "Closing tabs",
  group_tabs: "Grouping tabs",
  ungroup_tabs: "Ungrouping tabs",
  run_task: "Getting ready to take over",
};

/** The line for a step. */
export function stepText(s: Step, ctx: StepContext): string {
  switch (s.step) {
    case "search":
      return s.detail?.trim() ? "Searching for “" + short(s.detail) + "”" : "Searching the web";
    case "results":
      return s.count && s.count > 1 ? "Reading " + s.count + " results" : "Reading the results";
    case "fetch":
      return s.detail?.trim() ? "Opening " + short(s.detail) : "Opening a web page";
    case "thinking":
      return "Thinking it through";
    case "writing":
      return ctx.summary ? "Writing your summary" : "Writing your answer";
    case "handoff":
      // Apple's model couldn't answer; the key's model takes over (owner, 2026-10-27).
      return "Looking deeper";
    case "tool":
      return TOOL_STEP[s.name] ?? "Working on it";
  }
}

/** The first step, while the panel reads the page (or the tabs) for the question. */
export function readingStep(o: {
  /** The current page goes with the question. */
  page: boolean;
  /** A YouTube video: the panel reads its captions. */
  video: boolean;
  /** An Instagram post: the panel reads its photos or video frames. */
  instagram: boolean;
  /** Tabs attached with @. */
  tabs: number;
}): string | null {
  const tabs = o.tabs === 1 ? "1 tab" : o.tabs + " tabs";
  if (o.page && o.video) return o.tabs ? "Getting the video’s captions and " + tabs : "Getting the video’s captions";
  if (o.page && o.instagram) return o.tabs ? "Looking at the post and " + tabs : "Looking at the post";
  if (o.page) return o.tabs ? "Reading the page and " + tabs : "Reading the page";
  if (o.tabs) return "Reading " + tabs;
  return null;
}

/** The step once the question is on its way to the model, before it reports anything. */
export function waitingStep(o: { summary: boolean; video: boolean; continued: boolean }): string {
  if (o.continued) return "Picking up where it stopped";
  if (o.summary) return o.video ? "Picking out the key moments" : "Picking out the key points";
  return "Thinking it through";
}
