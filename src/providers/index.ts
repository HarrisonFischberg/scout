import { createAnthropic } from "./anthropic";
import { createOpenAI } from "./openai";
import type { ProviderClient, ProviderConfig, ProviderId } from "./types";

export * from "./types";
export { ProviderError } from "./errors";
export type { ProviderErrorCode } from "./errors";

export function createProvider(id: ProviderId, cfg: ProviderConfig): ProviderClient {
  return id === "anthropic" ? createAnthropic(cfg) : createOpenAI(cfg);
}
