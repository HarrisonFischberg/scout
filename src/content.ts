// Content script (T009). Injected on demand by the background script (T010)
// with `scripting.executeScript`; never declared for all URLs. Answers two
// messages: snapshot the page, and perform one action by ref from the last
// snapshot. Page content is untrusted data and only leaves via the reply.
import { domPage } from "./actions/dom";
import { executeAction, type Action, type ActionResult } from "./actions/executor";
import { buildSnapshot, fromElement, type SnapNode, type Snapshot } from "./snapshot/snapshot";

export type ContentRequest = { type: "assistant:snapshot" } | { type: "assistant:act"; action: Action };

const FLAG = "__assistAntContent";
const g = globalThis as unknown as Record<string, unknown>;

if (!g[FLAG]) {
  g[FLAG] = true;
  let refs = new Map<string, Element>();

  const snapshot = (): Snapshot => {
    const nodeToEl = new Map<SnapNode, Element>();
    const root = fromElement(document.documentElement, nodeToEl);
    const next = new Map<string, Element>();
    const snap = buildSnapshot(root, {
      url: location.href,
      title: document.title,
      onRef: (ref, node) => {
        const el = nodeToEl.get(node);
        if (el) next.set(ref, el);
      },
    });
    refs = next;
    return snap;
  };

  browser.runtime.onMessage.addListener((message: unknown): Promise<Snapshot | ActionResult> | undefined => {
    const req = message as Partial<ContentRequest> | null;
    if (req?.type === "assistant:snapshot") return Promise.resolve(snapshot());
    if (req?.type === "assistant:act") {
      return executeAction(domPage(refs, window), (req as { action: Action }).action);
    }
    return undefined;
  });
}
