// The step line of an answer that has no words yet (src/chat/steps.ts): one
// plain-English line that changes as the work moves on. The finished step
// slides up and fades out while the next slides in under it. Each step stays
// at least MIN_STEP_MS so a quick one is still readable; a step that arrives
// sooner waits, and only the newest waiting step is shown. With Reduce Motion
// the line changes in place (CSS, src/popup.html).

export const MIN_STEP_MS = 900;
/** How long the leaving step's animation runs before it is removed. */
const LEAVE_MS = 320;

export interface StepLine {
  readonly el: HTMLElement;
  /** Shows `label` next (after the current step's minimum time). */
  set(label: string): void;
  /** The step on screen now. */
  readonly label: string;
}

export function createStepLine(
  doc: Document,
  pulseHtml: string,
  first: string,
  clock: { now: () => number; later: (fn: () => void, ms: number) => unknown } = {
    now: () => performance.now(),
    later: (fn, ms) => setTimeout(fn, ms),
  },
): StepLine {
  const el = doc.createElement("span");
  el.className = "thinking steps";
  // Read out each new step, politely (never interrupts).
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  el.innerHTML = pulseHtml;
  const stack = doc.createElement("span");
  stack.className = "step-stack";
  el.appendChild(stack);

  let label = first;
  let shownAt = clock.now();
  let waiting: string | null = null;

  const item = (text: string, cls: string): HTMLElement => {
    const s = doc.createElement("span");
    s.className = "step " + cls;
    s.textContent = text + "…";
    stack.appendChild(s);
    return s;
  };
  let cur = item(first, "now");

  const show = (next: string): void => {
    waiting = null;
    if (next === label) return;
    const old = cur;
    old.className = "step leaving";
    old.setAttribute("aria-hidden", "true");
    clock.later(() => old.remove(), LEAVE_MS);
    cur = item(next, "now entering");
    label = next;
    shownAt = clock.now();
  };

  return {
    el,
    get label() {
      return label;
    },
    set(next: string) {
      if (next === (waiting ?? label)) return;
      const wait = MIN_STEP_MS - (clock.now() - shownAt);
      if (wait <= 0 && waiting === null) return show(next);
      const queued = waiting !== null;
      waiting = next;
      if (!queued) clock.later(() => waiting !== null && show(waiting), Math.max(0, wait));
    },
  };
}
