// Part 2: screenshots reach the provider as image parts in a user turn.
import { describe, expect, it } from "vitest";
import { anthropicMessages } from "../../src/providers/anthropic";
import { openaiInput } from "../../src/providers/openai";
import type { ChatMessage } from "../../src/providers/types";

const MSGS: ChatMessage[] = [
  { role: "user", content: "hi" },
  { role: "assistant", content: "hello" },
  { role: "user", content: [{ type: "text", text: "Tool results" }, { type: "image", mediaType: "image/jpeg", data: "AAAA" }] },
];

describe("content parts", () => {
  it("Anthropic: base64 image blocks, strings unchanged", () => {
    expect(anthropicMessages(MSGS)).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      {
        role: "user",
        content: [
          { type: "text", text: "Tool results" },
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAAA" } },
        ],
      },
    ]);
  });

  it("OpenAI: input_text and data-URL input_image", () => {
    expect(openaiInput(MSGS)[2]).toEqual({
      role: "user",
      content: [
        { type: "input_text", text: "Tool results" },
        { type: "input_image", image_url: "data:image/jpeg;base64,AAAA" },
      ],
    });
  });
});
