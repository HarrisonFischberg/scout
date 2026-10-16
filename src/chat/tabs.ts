// @tab multi-tab context (T012). Pure helpers: which other tabs a question
// refers to, and how their text is shared out of the prompt budget.

export interface TabInfo {
  id: number;
  title: string;
  url: string;
  active: boolean;
}

export const MAX_EXTRA_TABS = 4;

function host(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** `@token` matches a non-active tab whose host contains it or whose title has a word starting with it. */
export function resolveMentions(question: string, tabs: TabInfo[]): TabInfo[] {
  const tokens = [...question.matchAll(/(?:^|\s)@([\w.-]+)/g)].map((m) => (m[1] ?? "").toLowerCase());
  const found: TabInfo[] = [];
  for (const token of tokens) {
    if (!token) continue;
    for (const tab of tabs) {
      if (tab.active || found.some((f) => f.id === tab.id)) continue;
      const words = tab.title.toLowerCase().split(/\s+/);
      if (host(tab.url).includes(token) || words.some((w) => w.startsWith(token))) found.push(tab);
    }
  }
  return found.slice(0, MAX_EXTRA_TABS);
}

/** Checkbox-selected tabs first, then @mentions, without duplicates. */
export function mergeTabs(selected: TabInfo[], mentioned: TabInfo[]): TabInfo[] {
  const out = [...selected];
  for (const t of mentioned) if (!out.some((o) => o.id === t.id)) out.push(t);
  return out.slice(0, MAX_EXTRA_TABS);
}

/** Splits one character budget across pages; the first (active) page keeps the larger share. */
export function shareBudget(count: number, total: number): number[] {
  if (count <= 1) return [total];
  const rest = Math.floor(total / (2 * (count - 1)));
  return [total - rest * (count - 1), ...Array.from({ length: count - 1 }, () => rest)];
}
