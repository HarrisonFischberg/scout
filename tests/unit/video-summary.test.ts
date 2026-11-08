// Summarize on a YouTube video (owner, 2026-11-08): Comet-style takeaways
// with bold headings and time ranges like [1:31–3:22] that seek the video.
import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown } from "../../src/chat/markdown";
import { starterLabel } from "../../src/chat/prompt";
import { classifyQuestion } from "../../src/chat/intent";
import { VIDEO_SUGGESTIONS, VIDEO_SUMMARY_PROMPT } from "../../src/panel/suggestions";

describe("video time ranges", () => {
  it("reads [1:31–3:22] as one chip that starts at 1:31", () => {
    expect(parseInline("Worship came first. [1:31–3:22]")).toEqual([
      { type: "text", text: "Worship came first. " },
      { type: "time", seconds: 91, label: "1:31–3:22", end: 202 },
    ]);
  });

  it("accepts a hyphen or em dash and writes an en dash", () => {
    expect(parseInline("[1:31-3:22]")).toEqual([{ type: "time", seconds: 91, label: "1:31–3:22", end: 202 }]);
    expect(parseInline("[59:00 — 1:02:03]")).toEqual([{ type: "time", seconds: 3540, label: "59:00–1:02:03", end: 3723 }]);
  });

  it("splits several ranges into one chip each", () => {
    expect(parseInline("[4:47–6:16; 8:15–10:00]")).toEqual([
      { type: "time", seconds: 287, label: "4:47–6:16", end: 376 },
      { type: "text", text: " " },
      { type: "time", seconds: 495, label: "8:15–10:00", end: 600 },
    ]);
    expect(parseInline("[3:23, 6:48]")).toEqual([
      { type: "time", seconds: 203, label: "3:23" },
      { type: "text", text: " " },
      { type: "time", seconds: 408, label: "6:48" },
    ]);
  });

  it("leaves a backwards or broken range as text", () => {
    expect(parseInline("[3:22–1:31]")).toEqual([{ type: "text", text: "[3:22–1:31]" }]);
    expect(parseInline("[1:31–3:75]")).toEqual([{ type: "text", text: "[1:31–3:75]" }]);
  });
});

describe("takeaways with a bold heading", () => {
  const answer = [
    "The video's central takeaway: the Trinity means one God in three persons.",
    "",
    "### Key takeaways",
    "",
    "1. **The doctrine grew out of worship.**",
    "   Early Christians met God as Father, Son and Spirit. [1:31–3:22]",
    "",
    "2. **One substance, three persons.**",
    "In Tertullian's terms they share one being. [6:48–8:14]",
    "3. **Modalism is rejected.** Jesus prays to the Father. [3:23–4:46]",
    "",
    "### Why it matters",
    "",
    "Love belongs to God's eternal nature. [12:53–14:51]",
  ].join("\n");

  it("keeps one numbered list across blank lines and puts each explanation on its own line", () => {
    const blocks = parseMarkdown(answer);
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "heading", "list", "heading", "paragraph"]);
    const list = blocks[2];
    if (list?.type !== "list") throw new Error("no list");
    expect(list.ordered).toBe(true);
    expect(list.items).toHaveLength(3);
    expect(list.items[0]?.children.map((c) => c.type)).toEqual(["strong", "br", "text", "time"]);
    // An unindented line right after a heading-only item still belongs to it.
    expect(list.items[1]?.children.map((c) => c.type)).toEqual(["strong", "br", "text", "time"]);
    // A heading followed by text on the same line stays inline.
    expect(list.items[2]?.children.map((c) => c.type)).toEqual(["strong", "text", "time"]);
  });

  it("still ends a list at a blank line before a paragraph", () => {
    expect(parseMarkdown("1. one\n\nAfter.").map((b) => b.type)).toEqual(["list", "paragraph"]);
    expect(parseMarkdown("- a\n\n- b").length).toBe(1);
    expect(parseMarkdown("- a\nplain").map((b) => b.type)).toEqual(["list", "paragraph"]);
  });
});

describe("the video summary prompt", () => {
  it("asks for the Comet-style shape with time ranges", () => {
    for (const part of ["central takeaway", "### Key takeaways", "bold heading", "[1:31–3:22]", "### Why it matters"]) {
      expect(VIDEO_SUMMARY_PROMPT).toContain(part);
    }
  });

  it("is the Summarize the video starter, shown briefly and sent with the transcript", () => {
    expect(VIDEO_SUGGESTIONS.find((s) => s.label === "Summarize the video")?.prompt).toBe(VIDEO_SUMMARY_PROMPT);
    expect(starterLabel(VIDEO_SUMMARY_PROMPT)).toBe("Summarize the video");
    expect(classifyQuestion({ question: VIDEO_SUMMARY_PROMPT })).toBe("page");
  });
});
