// Multi-tab context (T012). Which tabs go with a question is the user's
// explicit choice (Part 2 attach picker, src/panel/attach.ts); this holds the
// tab shape, the cap, and how page text is shared out of the prompt budget.

export interface TabInfo {
  id: number;
  title: string;
  url: string;
  active: boolean;
}

export const MAX_EXTRA_TABS = 4;

/** Splits one character budget across pages; the first (active) page keeps the larger share. */
export function shareBudget(count: number, total: number): number[] {
  if (count <= 1) return [total];
  const rest = Math.floor(total / (2 * (count - 1)));
  return [total - rest * (count - 1), ...Array.from({ length: count - 1 }, () => rest)];
}
