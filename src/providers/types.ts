// Provider layer (T005): one interface over Anthropic Messages and OpenAI
// Responses. Callers pass `fetch` so tests never touch the network.
export type ProviderId = "anthropic" | "openai";

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
  signal?: AbortSignal;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
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
