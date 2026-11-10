// Attached tabs (Part 2, spec 6): only tabs the user picks. Picked by typing
// @ in the ask box, shown as chips above it, and sent with every question
// until removed. Nothing else is read. The matching rules are in attach.ts.
// Moved out of the panel's main() (audit 2026-11-10).
import { MAX_EXTRA_TABS, type TabInfo } from "../chat/tabs";
import { hostOf } from "../permissions/gate";
import { dropMention, mentionAt, suggestTabs } from "./attach";

export interface TabPickerDeps {
  question: HTMLTextAreaElement;
  status: HTMLElement;
  /** The tabs attached to this conversation; the picker adds and removes, the panel reads. */
  attached: Map<number, TabInfo>;
  listTabs: () => Promise<TabInfo[]>;
  /** Whether typing @ suggests tabs right now (chat mode, not the full-window chat). */
  enabled: () => boolean;
  autosize: () => void;
  trace: (stage: string) => void;
}

export interface TabPicker {
  /** Reads the open tabs again and drops attached ones that are gone. */
  loadTabs: () => Promise<void>;
  closeMentions: () => void;
  /** Arrow keys, Enter, Tab and Escape while suggestions show. True when handled. */
  mentionKey: (e: KeyboardEvent) => boolean;
}

export function tabPicker(d: TabPickerDeps): TabPicker {
  const { question, status, attached } = d;
  let others: TabInfo[] = [];
  const attachedBox = document.getElementById("attached")!;
  const mentionList = document.getElementById("mention-list") as HTMLUListElement;

  function renderAttached(): void {
    attachedBox.replaceChildren(
      ...[...attached.values()].map((t) => {
        const chip = document.createElement("span");
        chip.className = "chip";
        const name = document.createElement("span");
        name.textContent = t.title;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.setAttribute("aria-label", "Remove " + t.title);
        remove.insertAdjacentHTML("beforeend", '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>');
        remove.addEventListener("click", () => {
          detachTab(t.id);
          question.focus();
        });
        chip.append(name, remove);
        return chip;
      }),
    );
    attachedBox.hidden = attached.size === 0;
  }
  function attachTab(t: TabInfo): void {
    if (!attached.has(t.id) && attached.size >= MAX_EXTRA_TABS) {
      status.textContent = "You can attach up to " + MAX_EXTRA_TABS + " tabs. Remove one first.";
    } else {
      attached.set(t.id, t);
      d.trace("tabs:attached");
    }
    renderAttached();
  }
  function detachTab(id: number): void {
    attached.delete(id);
    renderAttached();
  }

  async function loadTabs(): Promise<void> {
    others = (await d.listTabs()).filter((t) => !t.active);
    for (const id of [...attached.keys()]) if (!others.some((t) => t.id === id)) attached.delete(id);
    renderAttached();
  }

  // Typing @ suggests tabs; choosing one attaches it and removes the @word.
  let mention: { start: number; items: TabInfo[]; index: number } | null = null;
  function closeMentions(): void {
    mention = null;
    mentionList.hidden = true;
    mentionList.replaceChildren();
    question.removeAttribute("aria-activedescendant");
  }
  function markMention(): void {
    if (!mention) return;
    mentionList.querySelectorAll("li").forEach((li, i) => li.setAttribute("aria-selected", String(i === mention!.index)));
    question.setAttribute("aria-activedescendant", "mention-" + mention.index);
  }
  function updateMentions(): void {
    const at = d.enabled() ? mentionAt(question.value, question.selectionStart ?? question.value.length) : null;
    const items = at ? suggestTabs(at.query, others, new Set(attached.keys())) : [];
    if (!at || !items.length) return closeMentions();
    mention = { start: at.start, items, index: 0 };
    mentionList.replaceChildren(
      ...items.map((t, i) => {
        const li = document.createElement("li");
        li.id = "mention-" + i;
        li.setAttribute("role", "option");
        li.append(t.title);
        const h = hostOf(t.url);
        if (h) {
          const span = document.createElement("span");
          span.className = "host";
          span.textContent = h;
          li.appendChild(span);
        }
        // mousedown, so the field keeps focus.
        li.addEventListener("mousedown", (e) => {
          e.preventDefault();
          pickMention(i);
        });
        return li;
      }),
    );
    mentionList.hidden = false;
    markMention();
  }
  function pickMention(i: number): void {
    const t = mention?.items[i];
    if (!mention || !t) return;
    attachTab(t);
    const next = dropMention(question.value, mention.start, question.selectionStart ?? question.value.length);
    question.value = next.text;
    question.setSelectionRange(next.caret, next.caret);
    closeMentions();
    d.autosize();
    question.focus();
  }
  /** Arrow keys, Enter, Tab and Escape while suggestions show. True when handled. */
  function mentionKey(e: KeyboardEvent): boolean {
    if (!mention) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = mention.items.length;
      mention.index = (mention.index + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
      markMention();
      return true;
    }
    if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
      e.preventDefault();
      pickMention(mention.index);
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      closeMentions();
      return true;
    }
    return false;
  }
  question.addEventListener("input", updateMentions);
  question.addEventListener("blur", () => setTimeout(closeMentions, 0));
  return { loadTabs, closeMentions, mentionKey };
}
