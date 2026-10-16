// Model and effort choices for the Settings dropdowns. The list comes from the
// provider's own read-only model list (the same endpoint the key check uses,
// no tokens billed), cached for a day. Without a key or a connection, a short
// built-in list is shown instead.
import { EFFORTS, type Effort, type FetchLike, type ProviderId } from "./types";

export interface ModelInfo {
  id: string;
  name: string;
  /** Effort levels the model accepts. Empty: no effort control (the setting is not sent). */
  efforts: Effort[];
}

export type ModelSource = "live" | "cached" | "builtin";

export interface ModelList {
  models: ModelInfo[];
  source: ModelSource;
  /** Set when the live list could not be loaded. */
  error?: string;
}

const ALL: Effort[] = [...EFFORTS];
const OPENAI_EFFORTS: Effort[] = ["low", "medium", "high"];

// Anthropic: https://platform.claude.com/docs/en/about-claude/models (claude-api
// skill table, cached 2026-10-06). OpenAI: the app's existing default only; the
// rest come from the live list.
export const BUILTIN_MODELS: Record<ProviderId, ModelInfo[]> = {
  anthropic: [
    { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", efforts: ALL },
    { id: "claude-opus-5-5", name: "Claude Opus 5.5", efforts: ALL },
    { id: "claude-haiku-5-5", name: "Claude Haiku 5.5", efforts: ALL },
    { id: "claude-fable-5-1", name: "Claude Fable 5.1", efforts: ALL },
  ],
  openai: [{ id: "gpt-5", name: "GPT-5", efforts: OPENAI_EFFORTS }],
};

export const EFFORT_LABEL: Record<"default" | Effort, string> = {
  default: "Default",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

const ENDPOINT: Record<ProviderId, string> = {
  anthropic: "https://api.anthropic.com/v1/models?limit=100",
  openai: "https://api.openai.com/v1/models",
};

const CACHE_KEY = "modelCache";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function rows(json: unknown): Array<Record<string, unknown>> {
  const data = json && typeof json === "object" ? (json as { data?: unknown }).data : undefined;
  return Array.isArray(data) ? data.filter((r): r is Record<string, unknown> => !!r && typeof r === "object") : [];
}

const builtin = (provider: ProviderId, id: string): ModelInfo | undefined =>
  BUILTIN_MODELS[provider].find((m) => m.id === id);

/** Anthropic GET /v1/models. Effort levels come from each model's `capabilities.effort`. */
export function parseAnthropicModels(json: unknown): ModelInfo[] {
  return rows(json).flatMap((r) => {
    if (typeof r.id !== "string" || !r.id) return [];
    const name = typeof r.display_name === "string" && r.display_name ? r.display_name : r.id;
    const caps = r.capabilities && typeof r.capabilities === "object" ? (r.capabilities as Record<string, unknown>) : null;
    const effort = caps?.effort && typeof caps.effort === "object" ? (caps.effort as Record<string, { supported?: unknown } | undefined>) : null;
    let efforts: Effort[];
    if (effort) efforts = (effort as { supported?: unknown }).supported === true ? EFFORTS.filter((l) => effort[l]?.supported === true) : [];
    else efforts = builtin("anthropic", r.id)?.efforts ?? [];
    return [{ id: r.id, name, efforts }];
  });
}

// OpenAI's list has every model the key can use, including audio, image,
// embedding, and dated snapshots. Keep the text models a chat can use.
const OPENAI_CHAT = /^(gpt-|o\d|chatgpt-)/;
const OPENAI_SKIP = /(audio|realtime|transcribe|tts|image|search|embedding|instruct|moderation|codex|computer-use|deep-research|dall-e|whisper)/;
const DATED = /-(\d{4}-\d{2}-\d{2}|\d{4})$/;
const OPENAI_REASONING = /^(o\d|gpt-5)/;
const OPENAI_NON_REASONING = /chat/;

/** OpenAI GET /v1/models: newest first. Effort only on reasoning models. */
export function parseOpenAIModels(json: unknown): ModelInfo[] {
  return rows(json)
    .filter((r) => typeof r.id === "string" && OPENAI_CHAT.test(r.id) && !OPENAI_SKIP.test(r.id) && !DATED.test(r.id))
    .sort((a, b) => (typeof b.created === "number" ? b.created : 0) - (typeof a.created === "number" ? a.created : 0))
    .map((r) => {
      const id = r.id as string;
      const reasoning = OPENAI_REASONING.test(id) && !OPENAI_NON_REASONING.test(id);
      return { id, name: id.replace(/^gpt-/, "GPT-").replace(/^chatgpt-/, "ChatGPT-"), efforts: reasoning ? OPENAI_EFFORTS : [] };
    });
}

export async function fetchModels(provider: ProviderId, apiKey: string, fetchFn: FetchLike): Promise<ModelInfo[]> {
  const headers: Record<string, string> =
    provider === "anthropic"
      ? {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          // Browser-origin call with the user's own key (see anthropic.ts).
          "anthropic-dangerous-direct-browser-access": "true",
        }
      : { authorization: `Bearer ${apiKey}` };
  const res = await fetchFn(ENDPOINT[provider], { method: "GET", headers });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const models = provider === "anthropic" ? parseAnthropicModels(await res.json()) : parseOpenAIModels(await res.json());
  if (!models.length) throw new Error("empty list");
  return models;
}

interface CacheEntry {
  at: number;
  models: ModelInfo[];
}

interface Storage {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

function parseCache(raw: unknown, provider: ProviderId): CacheEntry | null {
  const entry = raw && typeof raw === "object" ? (raw as Record<string, unknown>)[provider] : undefined;
  if (!entry || typeof entry !== "object") return null;
  const e = entry as { at?: unknown; models?: unknown };
  if (typeof e.at !== "number" || !Array.isArray(e.models)) return null;
  const models = e.models.flatMap((m: unknown): ModelInfo[] => {
    const r = m as Partial<ModelInfo> | null;
    if (!r || typeof r.id !== "string" || typeof r.name !== "string" || !Array.isArray(r.efforts)) return [];
    return [{ id: r.id, name: r.name, efforts: EFFORTS.filter((l) => r.efforts!.includes(l)) }];
  });
  return models.length ? { at: e.at, models } : null;
}

/**
 * The models to offer for `provider`: a fresh cache, else the live list (when
 * a key is given), else a stale cache, else the built-in list.
 */
export async function loadModelList(
  storage: Storage | undefined,
  provider: ProviderId,
  apiKey: string | null,
  fetchFn: FetchLike,
  now: number,
  opts: { refresh?: boolean } = {},
): Promise<ModelList> {
  const got = storage ? await storage.get(CACHE_KEY).catch(() => ({}) as Record<string, unknown>) : {};
  const all = (got as Record<string, unknown>)[CACHE_KEY];
  const cached = parseCache(all, provider);
  if (cached && !opts.refresh && now - cached.at < CACHE_TTL_MS) return { models: cached.models, source: "cached" };
  let error: string | undefined;
  if (apiKey) {
    try {
      const models = await fetchModels(provider, apiKey, fetchFn);
      const next = { ...(all && typeof all === "object" ? (all as object) : {}), [provider]: { at: now, models } };
      await storage?.set({ [CACHE_KEY]: next }).catch(() => undefined);
      return { models, source: "live" };
    } catch (err) {
      error = err instanceof Error ? err.message : "failed";
    }
  }
  if (cached) return { models: cached.models, source: "cached", ...(error ? { error } : {}) };
  return { models: BUILTIN_MODELS[provider], source: "builtin", ...(error ? { error } : {}) };
}

/** The list with `id` in it: a saved model the list does not show is kept, with no effort control. */
export function withModel(models: ModelInfo[], provider: ProviderId, id: string): ModelInfo[] {
  if (!id || models.some((m) => m.id === id)) return models;
  return [...models, builtin(provider, id) ?? { id, name: id, efforts: [] }];
}

/** The effort to send: the setting when the model supports it, otherwise none. */
export function effortFor(model: ModelInfo | undefined, setting: "default" | Effort): Effort | undefined {
  return setting !== "default" && model?.efforts.includes(setting) ? setting : undefined;
}

/** Effort for a model id with no list at hand: built-in knowledge only. */
export function effortForId(provider: ProviderId, id: string, setting: "default" | Effort, models: ModelInfo[] = []): Effort | undefined {
  return effortFor(models.find((m) => m.id === id) ?? builtin(provider, id), setting);
}
