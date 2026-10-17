// Tool call log (Part 2, spec 7): tool, site (host only), duration, and result
// status for every call, including rejected ones. Never page text or tool
// input. Kept like chat history: in storage.local for the retention window,
// or only in the worker's memory when history is off.
import type { Retention, StorageArea } from "../settings/settings";

export const TOOL_LOG_KEY = "toolLog";
export const MAX_LOG = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ToolLogEntry {
  at: number;
  tool: string;
  /** Host(s) the call touched, or "" when none. */
  site: string;
  ms: number;
  status: string;
}

export function parseToolLog(raw: unknown): ToolLogEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((e: unknown) => {
    const r = e as Partial<ToolLogEntry> | null;
    return r && typeof r.at === "number" && typeof r.tool === "string" && typeof r.site === "string" && typeof r.ms === "number" && typeof r.status === "string"
      ? [{ at: r.at, tool: r.tool.slice(0, 40), site: r.site.slice(0, 200), ms: r.ms, status: r.status.slice(0, 40) }]
      : [];
  });
}

export function pruneToolLog(entries: ToolLogEntry[], retention: Retention, now: number): ToolLogEntry[] {
  if (retention === "off") return [];
  const cutoff = now - Number(retention) * DAY_MS;
  return entries.filter((e) => e.at > cutoff).slice(-MAX_LOG);
}

export class ToolLog {
  private memory: ToolLogEntry[] = [];
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: Pick<StorageArea, "get" | "set"> | undefined,
    private readonly retention: () => Promise<Retention>,
  ) {}

  /** Records one call. Writes are queued so concurrent calls do not drop entries. */
  add(entry: ToolLogEntry): Promise<void> {
    this.memory = [...this.memory, entry].slice(-MAX_LOG);
    const storage = this.storage;
    if (!storage) return Promise.resolve();
    this.queue = this.queue
      .then(async () => {
        const retention = await this.retention();
        if (retention === "off") return;
        const got = await storage.get(TOOL_LOG_KEY);
        await storage.set({ [TOOL_LOG_KEY]: pruneToolLog([...parseToolLog(got[TOOL_LOG_KEY]), entry], retention, entry.at) });
      })
      .catch(() => undefined);
    return this.queue;
  }

  /** Newest first: stored entries within retention, plus this session's when history is off. */
  async list(now: number): Promise<ToolLogEntry[]> {
    await this.queue;
    const retention = await this.retention().catch(() => "7" as Retention);
    let entries: ToolLogEntry[] = this.memory;
    if (this.storage && retention !== "off") {
      const got = await this.storage.get(TOOL_LOG_KEY).catch(() => ({}) as Record<string, unknown>);
      entries = pruneToolLog(parseToolLog(got[TOOL_LOG_KEY]), retention, now);
    }
    return [...entries].sort((a, b) => b.at - a.at);
  }

  /** After Delete all data or Clear activity. */
  forget(): void {
    this.memory = [];
  }
}
