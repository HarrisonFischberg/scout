// The worker's view of the tab a Scout task acts on (Part 3). Every call goes
// through the injected content script (src/content.ts) with
// scripting.executeScript, as the popup's page adapter does: on iOS Safari a
// tabs.sendMessage to the content script went unanswered (T018), while
// executeScript results arrive reliably. A page that navigates loses the
// script, so it is injected again on demand.
import { CONTENT_HANDLER, type ContentRequest } from "../content-api";
import type { ScoutAction, Size } from "./actions";
import type { OverlayState } from "./overlay";
import type { TaskPage } from "./runner";
import type { ToolImage } from "../tools/host";

export interface PageDeps {
  /** Injects content.js into the tab. */
  inject(tabId: number): Promise<void>;
  /** Runs the content handler with one request and returns its reply envelope. */
  call(tabId: number, req: ContentRequest): Promise<{ ok: boolean; value?: unknown; why?: string }>;
  capture(tabId: number): Promise<(ToolImage & Size) | null>;
  tab(tabId: number): Promise<{ url: string; title: string; incognito?: boolean } | null>;
  /** Diagnostics: stage names only. */
  trace?: (stage: string) => void;
}

/** Runs inside the page (isolated world): calls the content script's handler and wraps the outcome. */
export function contentBridge(r: ContentRequest, name: string): unknown {
  try {
    const h = (globalThis as unknown as Record<string, ((x: ContentRequest) => unknown) | undefined>)[name];
    if (typeof r !== "object" || r === null) return { ok: false, why: "no-args" };
    if (!h) return { ok: false, why: "no-handler" };
    const out = h(r);
    if (out && typeof (out as Promise<unknown>).then === "function") {
      return (out as Promise<unknown>).then(
        (value) => ({ ok: true, value }),
        () => ({ ok: false, why: "threw-async" }),
      );
    }
    return { ok: true, value: out };
  } catch {
    return { ok: false, why: "threw" };
  }
}

export { CONTENT_HANDLER };

export function createTaskPage(tabId: number, deps: PageDeps): TaskPage {
  let injected = false;
  const call = async (req: ContentRequest, retries = 6): Promise<unknown> => {
    for (let attempt = 0; ; attempt++) {
      if (!injected) {
        await deps.inject(tabId);
        injected = true;
      }
      const out = await deps.call(tabId, req).catch(() => ({ ok: false as const, why: "threw-inject" }));
      if (out.ok) return out.value;
      // The page navigated or reloaded (script gone): inject again, briefly.
      if (attempt >= retries || !/no-handler|threw-inject/.test(out.why ?? "")) {
        deps.trace?.("content:" + req.type + " " + (out.why ?? "failed"));
        return null;
      }
      injected = false;
      await new Promise((r) => setTimeout(r, 300));
    }
  };
  return {
    snapshot: () => call({ type: "scout:snapshot" }),
    viewport: async () => {
      const v = (await call({ type: "scout:viewport" })) as { width?: unknown; height?: unknown } | null;
      return v && typeof v.width === "number" && typeof v.height === "number" ? { width: v.width, height: v.height } : null;
    },
    act: (action: ScoutAction) => call({ type: "scout:scout-act", action }),
    halt: async () => void (await call({ type: "scout:halt" }, 0)),
    overlay: async (command: "show" | "hide" | "state", state?: OverlayState) =>
      void (await call(command === "state" ? { type: "scout:overlay", command, state: state ?? "running" } : { type: "scout:overlay", command, ...(state ? { state } : {}) }, command === "hide" ? 0 : 2)),
    screenshot: () => deps.capture(tabId),
    tab: () => deps.tab(tabId),
  };
}
