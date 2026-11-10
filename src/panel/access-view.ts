// Settings > page access (Part 2, spec 10a; Part 3, spec 10): sharing the
// current page, tab search, Scout mode, "always allow" and screenshot answers
// per site, blocked sites, the organization's list, and what each saved
// conversation shared. The rules are in permissions/gate.ts; this draws them
// and saves changes. Moved out of the panel's main() (audit 2026-11-10).
import { nativeSend } from "../keychain";
import { loadPageAccess, normalizeSite, parsePolicy, savePageAccess, withoutAlwaysAllow, type PageAccess } from "../permissions/gate";
import { TARGET } from "../platform";
import { KIND_LABEL, type SensitiveKind } from "../safety/classifier";
import { clearShared, loadHistory, summarizeShared, type Retention, type StorageArea } from "../settings/settings";
import { sharedLabel } from "./attach";

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

export interface AccessViewDeps {
  storage: StorageArea | undefined;
  /** The site of the page Scout is open on, for "Block this site". */
  currentHost: string | null;
  retention: () => Retention;
  /** The open conversation's id, to label its row "This conversation". */
  conv: () => string;
  trace: (stage: string) => void;
}

export function accessView(d: AccessViewDeps): { renderAccess: () => Promise<void>; renderShared: () => Promise<void> } {
  const accessRead = el<HTMLInputElement>("access-read");
  const accessSearch = el<HTMLInputElement>("access-search");
  const accessScout = el<HTMLSelectElement>("access-scout");
  const allowList = el("allow-list");
  const sharedList = el("shared-list");
  const sharedStatus = el("shared-status");
  const shotList = el("shot-list");
  const blockForm = el<HTMLFormElement>("block-form");
  const blockInput = el<HTMLInputElement>("block-input");
  const blockCurrent = el<HTMLButtonElement>("block-current");
  const blockList = el("block-list");
  const blockStatus = el("block-status");
  const { storage, currentHost } = d;

  function listRow(text: string, button?: { label: string; aria: string; onClick: () => void }): HTMLLIElement {
    const li = document.createElement("li");
    li.append(text + (button ? " " : ""));
    if (button) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn";
      b.textContent = button.label;
      b.setAttribute("aria-label", button.aria);
      b.addEventListener("click", button.onClick);
      li.appendChild(b);
    }
    return li;
  }

  async function updateAccess(change: (a: PageAccess) => PageAccess, message: string): Promise<void> {
    try {
      if (!storage) throw new Error("no storage");
      await savePageAccess(storage, change(await loadPageAccess(storage)));
      blockStatus.textContent = message;
    } catch {
      blockStatus.textContent = "Could not save the change. Try again.";
    }
    await renderAccess();
  }

  async function renderAccess(): Promise<void> {
    const a = await loadPageAccess(storage);
    accessRead.checked = a.readCurrent;
    accessSearch.checked = a.searchTabs;
    el("access-search-help").textContent =
      "Off until you turn it on. On: when a question needs it, Scout can list the titles and addresses of your open tabs" +
      (browser.history
        ? " and search your history."
        : TARGET === "safari"
          ? ". Safari does not let extensions search history or recently closed tabs, so only open tabs are searched."
          : ". Only open tabs are searched, not history or recently closed tabs.");
    accessScout.value = a.scoutMode;
    const allows = Object.entries(a.alwaysAllow);
    allowList.replaceChildren(
      ...(allows.length
        ? allows.map(([host, kinds]) =>
            listRow(host + ": " + kinds.map((k) => KIND_LABEL[k as SensitiveKind] ?? k).join(", "), {
              label: "Revoke",
              aria: "Ask again before sensitive actions on " + host,
              onClick: () => void updateAccess((x) => withoutAlwaysAllow(x, host), "Scout will ask again on " + host + "."),
            }),
          )
        : [listRow("No sites always allowed.")]),
    );
    const shots = Object.entries(a.screenshots);
    shotList.replaceChildren(
      ...(shots.length
        ? shots.map(([host, choice]) =>
            listRow(host + ": " + (choice === "always" ? "always allowed" : "never"), {
              label: "Ask again",
              aria: "Ask again before screenshots of " + host,
              onClick: () => {
                const next = { ...a.screenshots };
                delete next[host];
                void updateAccess((x) => ({ ...x, screenshots: next }), "Scout will ask before screenshots of " + host + ".");
              },
            }),
          )
        : [listRow("No sites chosen yet.")]),
    );
    blockList.replaceChildren(
      ...(a.blocked.length
        ? a.blocked.map((host) =>
            listRow(host, {
              label: "Unblock",
              aria: "Unblock " + host,
              onClick: () => void updateAccess((x) => ({ ...x, blocked: x.blocked.filter((b) => b !== host) }), "Unblocked " + host + "."),
            }),
          )
        : [listRow("No sites blocked.")]),
    );
    blockCurrent.hidden = !currentHost || a.blocked.includes(currentHost);
    if (currentHost) blockCurrent.textContent = "Block " + currentHost;
    const org = parsePolicy(await nativeSend({ type: "policy.get" }).catch(() => null));
    el("admin-box").hidden = org.length === 0;
    el("admin-list").replaceChildren(...org.map((h) => listRow(h)));
  }

  function blockSite(raw: string): void {
    const host = normalizeSite(raw);
    if (!host) {
      blockInput.setAttribute("aria-invalid", "true");
      blockStatus.textContent = "Enter a site like example.com.";
      blockInput.focus();
      return;
    }
    blockInput.removeAttribute("aria-invalid");
    blockInput.value = "";
    void updateAccess(
      (a) => ({ ...a, blocked: [...new Set([...a.blocked, host])] }),
      "Blocked " + host + ". Scout will not read or screenshot it.",
    );
    d.trace("access:blocked");
  }

  accessRead.addEventListener("change", () => {
    const on = accessRead.checked;
    void updateAccess((a) => ({ ...a, readCurrent: on }), on ? "The current page is shared with each question." : "Only tabs you attach are shared.");
  });
  accessSearch.addEventListener("change", () => {
    const on = accessSearch.checked;
    void updateAccess((a) => ({ ...a, searchTabs: on }), on ? "Scout may search your open tabs." : "Tab and history search is off.");
  });
  accessScout.addEventListener("change", () => {
    const choice = accessScout.value === "off" ? "off" : "on";
    void updateAccess((a) => ({ ...a, scoutMode: choice }), choice === "off" ? "Scout mode is off." : "Scout mode starts as soon as you send a task.");
    d.trace("access:scout " + choice);
  });

  // Spec 10: what each conversation shared, and clearing it.
  async function renderShared(): Promise<void> {
    const entries = storage ? await loadHistory(storage, d.retention(), Date.now()).catch(() => []) : [];
    const groups = summarizeShared(entries);
    sharedList.replaceChildren(
      ...(groups.length
        ? groups.map((g) => {
            const when = new Date(g.at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
            const label = (g.conv === d.conv() ? "This conversation" : "Conversation of " + when) + ": " + g.items.map(sharedLabel).join(" · ");
            return listRow(label, {
              label: "Clear",
              aria: "Clear what the conversation of " + when + " shared",
              onClick: () => {
                if (!storage) return;
                void clearShared(storage, g.conv).then(async () => {
                  sharedStatus.textContent = "Cleared.";
                  await renderShared();
                });
              },
            });
          })
        : [listRow("Nothing shared in saved conversations.")]),
    );
  }
  el("shared-clear-all").addEventListener("click", () => {
    if (!storage) return;
    void clearShared(storage).then(async () => {
      sharedStatus.textContent = "Cleared every shared record.";
      await renderShared();
    });
  });
  blockForm.addEventListener("submit", (e) => {
    e.preventDefault();
    blockSite(blockInput.value);
  });
  blockCurrent.addEventListener("click", () => {
    if (currentHost) blockSite(currentHost);
  });

  return { renderAccess, renderShared };
}
