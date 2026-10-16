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

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
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
  /** A page the provider's web search returned or cited. */
  | { type: "source"; url: string; title?: string }
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
