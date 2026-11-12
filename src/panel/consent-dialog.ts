// The consent dialog (App Store Review Guideline 5.1.2(i)): asked once per
// provider before anything is sent. A modal dialog: focus starts on its
// heading so neither button is preselected; Escape is Not now; focus returns
// to the control that opened it. Moved out of the panel's main() (audit 2026-11-10).
import type { Provider } from "../keychain";
import { consentText } from "../settings/consent";

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

export interface ConsentDialogDeps {
  trace: (stage: string) => void;
  /** Where focus goes when the control that opened the dialog is gone. */
  fallbackFocus: () => HTMLElement;
}

/** Returns the question itself: shows the dialog for `p`, resolves true on Allow. One dialog at a time. */
export function consentDialog(d: ConsentDialogDeps): (p: Provider) => Promise<boolean> {
  const consentDialog = el<HTMLDialogElement>("consent");
  const consentTitle = el("consent-title");
  const consentAllow = el<HTMLButtonElement>("consent-allow");
  const consentDeny = el<HTMLButtonElement>("consent-deny");
  let consentPending: Promise<boolean> | null = null;

  return function askConsent(p: Provider): Promise<boolean> {
    if (consentPending) return consentPending;
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const t = consentText(p);
    consentTitle.textContent = t.title;
    el("consent-intro").textContent = t.intro;
    el("consent-items").replaceChildren(
      ...t.items.map((item) => {
        const li = document.createElement("li");
        li.textContent = item;
        return li;
      }),
    );
    const policy = el<HTMLAnchorElement>("consent-policy");
    policy.href = t.policyUrl;
    policy.textContent = t.policyLabel;
    const terms = el<HTMLAnchorElement>("consent-terms");
    terms.href = t.termsUrl;
    terms.textContent = t.termsLabel;
    el("consent-after").textContent = t.after;
    consentDialog.showModal();
    consentTitle.focus();
    d.trace("consent:asked " + p);
    consentPending = new Promise((resolve) => {
      const done = (ok: boolean): void => {
        if (!consentPending) return;
        consentPending = null;
        consentAllow.removeEventListener("click", onAllow);
        consentDeny.removeEventListener("click", onDeny);
        consentDialog.removeEventListener("cancel", onCancel);
        consentDialog.removeEventListener("close", onClose);
        if (consentDialog.open) consentDialog.close();
        d.trace("consent:" + (ok ? "allowed " : "declined ") + p);
        // The opener, unless it was hidden meanwhile (the + menu closes first).
        const back = returnTo && returnTo.isConnected && returnTo.offsetParent !== null ? returnTo : null;
        (back ?? d.fallbackFocus()).focus();
        resolve(ok);
      };
      const onAllow = (): void => done(true);
      const onDeny = (): void => done(false);
      const onCancel = (e: Event): void => {
        e.preventDefault();
        done(false);
      };
      const onClose = (): void => done(false);
      consentAllow.addEventListener("click", onAllow);
      consentDeny.addEventListener("click", onDeny);
      consentDialog.addEventListener("cancel", onCancel);
      consentDialog.addEventListener("close", onClose);
    });
    return consentPending;
  };
}
