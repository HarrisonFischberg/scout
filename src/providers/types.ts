// Provider layer (T005): one interface over Anthropic Messages and OpenAI
// Responses. Callers pass `fetch` so tests never touch the network.
export type ProviderId = "anthropic" | "openai";

/**
 * How hard the model thinks before answering. Anthropic sends it as
 * `output_config.effort` (all five levels, per model), OpenAI as
 * `reasoning.effort` (low, medium, high on reasoning models).
 */
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the tool input. */
  parameters: Record<string, unknown>;
}

/** Part of a user turn. Images are base64 without the data: prefix (Part 2: screenshots). */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: "image/jpeg" | "image/png"; data: string };

export interface ChatMessage {
  role: "user" | "assistant";
  /** A string, or parts for a user turn that carries an image. */
  content: string | ContentPart[];
}

/** The text of a message's content (image parts left out). */
export function textOf(content: string | ContentPart[]): string {
  return typeof content === "string" ? content : content.map((p) => (p.type === "text" ? p.text : "")).join("");
}

export interface ChatRequest {
  model: string;
  system?: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  maxTokens: number;
  /** Omitted: the model's default effort. */
  effort?: Effort;
  /** Enable the provider's own server-side web search tool (T019). */
  webSearch?: boolean;
  /** Max searches per request (Anthropic `max_uses`). Default 3. */
  webSearchMaxUses?: number;
  /** Also let the model read pages it found (Anthropic web fetch). */
  webFetch?: boolean;
  /** Max page fetches per request (Anthropic `max_uses`). Default: `webSearchMaxUses`. */
  webFetchMaxUses?: number;
  signal?: AbortSignal;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  /** Server-side web searches, billed per search (Anthropic). Absent when none ran. */
  webSearches?: number;
}

export type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  /**
   * A page the provider's web search returned, fetched, or cited. `text` is
   * the quoted passage of a citation; `page` is the text of a page the
   * model fetched (Anthropic web fetch); `age` is the search result's age.
   */
  | { type: "source"; url: string; title?: string; text?: string; page?: string; age?: string }
  /** A page the model asked the provider to fetch (Anthropic web fetch), whether or not it loaded. */
  | { type: "fetch"; url: string }
  | { type: "usage"; usage: Usage }
  | { type: "done" };

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface ProviderClient {
  readonly id: ProviderId;
  stream(req: ChatRequest): AsyncGenerator<StreamEvent, void, void>;
}

export interface ProviderConfig {
  apiKey: string;
  fetch: FetchLike;
  /** Overridable for tests only. */
  baseUrl?: string;
}
