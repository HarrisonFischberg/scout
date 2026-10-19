// One Find coupons run, start to finish, without any panel (S07, T031). The
// background worker runs it (src/server/coupon-host.ts), so it keeps going
// when the panel closes; iPhone users swipe the panel away to watch the
// pointer work (owner request 2026-10-19). Everything the panel shows comes
// out as events: chat lines, milestone steps, one row per tested code, the
// question after a search that saved nothing, and the summary. A reopened
// panel replays them. Diagnostics stages are stage names only, never content.
import type { Action, ActionResult } from "../actions/executor";
import type { AgentControl } from "../agent/control";
import { formatCostLine } from "../cost";
import type { Effort, ProviderClient, Usage } from "../providers/types";
import { browserFirstSites, countFetch, parseReaderHosts, READER_HOSTS_KEY } from "./reader-hosts";
import { browserTrace, type BrowserTarget, type PageBrowser } from "./browser-read";
import { mergeCandidates, rankCandidates, type CouponCandidate } from "./candidates";
import { suggestCodes, type SuggestedCodes } from "./codes";
import {
  CodeQueue,
  checkoutTarget,
  couponStatusText,
  couponSummary,
  discoveryLine,
  goToCheckout,
  openCouponTester,
  percentOff,
  plural,
  runCouponSearch,
  type BatchState,
  type CouponAttempt,
  type DiscoveryInfo,
} from "./finder";
import { locateForm } from "./locate";
import { identifyMerchant } from "./merchant";
import { formatMoney } from "./money";
import { codesWithContext, MAX_STORE_CODES, type StoreCode } from "./store";
import type { CouponPage } from "./tab-page";
import type { Snapshot } from "../snapshot/snapshot";

/** Checkout summaries sit late in big pages: read more of them than the agent does. */
export const COUPON_SNAPSHOT = { maxElements: 600, maxTextChars: 100_000 };
/** A find this soon after the last "Found" line adds to it instead of posting another. */
export const FOUND_EVERY_MS = 8000;

export type CouponEvent =
  /** A line in the Working card. */
  | { kind: "say"; text: string }
  /** A milestone in the chat: a new one, or new words for one already shown (same `step`). */
  | { kind: "step"; step: number; text: string }
  /** The newest milestone is settled (no moving indicator). */
  | { kind: "steps-end" }
  | { kind: "attempt"; attempt: CouponAttempt; currency?: string }
  /** The question after a search whose codes saved nothing; answered with `answered`. */
  | { kind: "ask"; prompt_id: string; tried: number }
  | { kind: "answered"; prompt_id: string }
  /** Diagnostics: a stage name, and the page the run is on. */
  | { kind: "trace"; stage: string }
  | { kind: "page"; url: string }
  | {
      kind: "done";
      /** For the diagnostics run: the finder's status and message. */
      status: string;
      message: string;
      /** "done", "stopped" or "error": the Working card's last word. */
      outcome: "done" | "stopped" | "error";
      summary: string;
      tone: "assistant" | "error";
      /** The line under the conversation (cost, or what went wrong). */
      status_text: string;
      usage: Usage;
    };

export interface CouponJobDeps {
  page: CouponPage;
  provider: ProviderClient;
  model: string;
  effort?: Effort;
  control: AgentControl;
  /** Background tabs for coupon pages the reader could not load. */
  tabs: PageBrowser;
  allowBrowser(pages: BrowserTarget[]): Promise<boolean>;
  storage?: { get(key: string): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void> };
  /** Asks the person whether to search again; false when stopped. */
  askMore(state: BatchState, signal: AbortSignal): Promise<boolean>;
  emit(e: CouponEvent): void;
}

export async function runCouponJob(deps: CouponJobDeps): Promise<Extract<CouponEvent, { kind: "done" }>> {
  const { page, provider: client, model, control: run, emit } = deps;
  const trace = (stage: string): void => emit({ kind: "trace", stage });
  const say = (text: string): void => emit({ kind: "say", text });
  let stepCount = 0;
  let latestStep = 0;
  const steps = {
    post(text: string): number {
      latestStep = ++stepCount;
      emit({ kind: "step", step: latestStep, text });
      return latestStep;
    },
    edit: (step: number, text: string): void => emit({ kind: "step", step, text }),
    latest: (): number => latestStep,
    end: (): void => emit({ kind: "steps-end" }),
  };
  let used: Usage = { inputTokens: 0, outputTokens: 0 };
  const addUsage = (more: { inputTokens: number; outputTokens: number; webSearches?: number }): void => {
    const searches = (used.webSearches ?? 0) + (more.webSearches ?? 0);
    used = {
      inputTokens: used.inputTokens + more.inputTokens,
      outputTokens: used.outputTokens + more.outputTokens,
      ...(searches ? { webSearches: searches } : {}),
    };
  };
  const finish = (d: Omit<Extract<CouponEvent, { kind: "done" }>, "kind" | "usage">): Extract<CouponEvent, { kind: "done" }> => {
    steps.end();
    const done = { kind: "done" as const, ...d, usage: used };
    emit(done);
    return done;
  };
  try {
    const snap = await page.snapshot();
    // The merchant: the tab's host, less checkout-only subdomains, and the
    // name the page gives itself. All page data, used only as search words.
    const meta = await page.meta().catch(() => null);
    const merchant = identifyMerchant(snap.url, meta ?? {});
    trace("coupons:merchant " + (merchant.host === merchant.domain ? "store-host" : "other-host") + (meta?.siteName ? " named" : ""));
    const ac = new AbortController();
    run.signal.addEventListener("abort", () => ac.abort(), { once: true });
    // Waits run here, not in the page, so they outlast a page that reloads.
    const couponPage = {
      ...page,
      snapshot: () => page.snapshot(COUPON_SNAPSHOT),
      act: (a: Action) =>
        a.type === "wait"
          ? new Promise<ActionResult>((r) => setTimeout(() => r({ ok: true, action: "wait", message: "Waited." }), Math.min(Math.max(a.ms, 0), 10_000)))
          : page.act(a),
    };
    const locate = async (view: Snapshot) => {
      trace("coupons:locate");
      const r = await locateForm(client, model, view, ac.signal, deps.effort);
      addUsage(r.usage);
      trace("coupons:locate " + (r.hints ? Object.keys(r.hints).join(",") : "none"));
      return r.hints;
    };
    // 1. A way to test codes, before any search: the store's cart API or its
    //    coupon box. A page with neither stops here, in seconds.
    say("Looking for the coupon box on this page…");
    let tester = await openCouponTester(couponPage, { locate });
    // No box on the cart: many stores take codes only at checkout. Scout presses the store's own
    // Checkout button and works on the checkout page (owner's choice 2026-10-17); nothing is typed.
    let atCheckout = false;
    if ("error" in tester && tester.error === "no_form" && !run.isStopped) {
      const here = await couponPage.snapshot().catch(() => null);
      if (here && checkoutTarget(here)) {
        say("This store takes codes at checkout. Opening checkout (nothing is bought, and none of your details are filled in)…");
        trace("coupons:checkout press");
        const step = await goToCheckout(couponPage, here);
        trace("coupons:checkout " + (step.ok ? "opened" : step.why));
        if (step.ok) {
          atCheckout = true;
          emit({ kind: "page", url: step.url });
          tester = await openCouponTester(couponPage, { locate });
        } else tester = { error: step.why === "captcha" ? "captcha" : "no_form", message: step.message };
      }
    }
    if ("error" in tester) {
      trace("coupons:method none status " + tester.error);
      return finish({
        status: tester.error,
        message: tester.message,
        outcome: tester.error === "stopped" ? "stopped" : "error",
        summary: tester.message + (tester.error === "no_form" ? " No codes were searched for or tested." : ""),
        tone: "error",
        status_text: couponStatusText(tester.error),
      });
    }
    const found = tester;
    trace("coupons:method " + found.method);
    say((found.method === "page" ? "Found the coupon box." : "Reached the store's cart.") + " Searching the web for " + merchant.brand + " codes…");
    steps.post("Searching for coupons for " + merchant.brand + "…");
    // 2. Codes the store advertises itself (banner, announcement bar): this
    //    page and its home page, read on the device. Then the web search,
    //    whose codes are tested as it finds them.
    const storeUrl = new URL("/", snap.url).toString();
    const asStore = (c: StoreCode, sourceUrl: string): CouponCandidate => ({ code: c.code, origin: "store", sourceUrl, context: c.context });
    const onSite = rankCandidates(
      mergeCandidates(
        codesWithContext(snap.text).map((c) => asStore(c, snap.url)),
        (await page.storeCodes().catch((): StoreCode[] => [])).map((c) => asStore(c, storeUrl)),
      ).slice(0, MAX_STORE_CODES),
      merchant,
    );
    trace("coupons:store-codes " + onSite.length);
    // Milestones for one search: "Found 5 coupons…", then "Found 10 more…"
    // at most every few seconds (a quicker find adds to the last line).
    let tried = 0;
    let over = false;
    let triedBefore = 0;
    const progress = (again: boolean) => {
      let count = 0;
      let line = 0;
      let lineCount = 0;
      let lineAt = 0;
      let lineFirst = false;
      return {
        found(n: number): void {
          if (n <= 0) return;
          const firstFind = count === 0;
          count += n;
          if (line && steps.latest() === line && Date.now() - lineAt < FOUND_EVERY_MS) lineCount += n;
          else {
            line = 0;
            lineCount = n;
            lineAt = Date.now();
            lineFirst = firstFind;
          }
          const text = lineFirst
            ? "Found " + plural(lineCount, again ? "new coupon" : "coupon") + ". Applying them to your cart while I keep searching."
            : "Found " + lineCount + " more, continuing to search.";
          if (line) steps.edit(line, text);
          else line = steps.post(text);
        },
        done(): void {
          if (count === 0 || over || run.isStopped) return;
          const left = count - (tried - (again ? triedBefore : 0));
          steps.post("Found all relevant coupons, " + count + " in all." + (left > 0 ? " Applying the rest now." : ""));
        },
      };
    };
    const first = progress(false);
    if (onSite.length) first.found(onSite.length);
    const queue = new CodeQueue();
    const storeFound = new Set(onSite.map((c) => c.code));
    trace("coupons:search");
    // Sites that refused the reader on this device go to a background tab first; each fetch is counted.
    const storage = deps.storage;
    let readerHosts = parseReaderHosts(storage ? (await storage.get(READER_HOSTS_KEY).catch(() => ({}) as Record<string, unknown>))[READER_HOSTS_KEY] : undefined);
    const browserPages = {
      tabs: deps.tabs,
      allow: deps.allowBrowser,
      onPage: (p: Parameters<typeof browserTrace>[0]) => trace(browserTrace(p)),
      firstHosts: browserFirstSites(readerHosts),
      onReader: (url: string, ok: boolean) => {
        readerHosts = countFetch(readerHosts, url, ok, Date.now());
        if (storage) void storage.set({ [READER_HOSTS_KEY]: readerHosts }).catch(() => undefined);
      },
    };
    trace("coupons:browser-first " + browserPages.firstHosts.length);
    const searching = suggestCodes(client, model, merchant, ac.signal, {
      browser: browserPages,
      onFound: (fresh) => {
        queue.push(fresh);
        first.found(fresh.filter((c) => !storeFound.has(c.code)).length);
      },
      ...(deps.effort ? { effort: deps.effort } : {}),
    });
    const discovery: DiscoveryInfo = {
      brand: merchant.brand,
      searched: true,
      store: onSite.length,
      verified: 0,
      reported: 0,
      masked: 0,
      dropped: 0,
      offers: [],
      ...(atCheckout ? { atCheckout: true } : {}),
    };
    const tally = (more: SuggestedCodes): void => {
      discovery.searched = discovery.searched && more.searched;
      discovery.verified += more.verified;
      discovery.reported += more.reported;
      discovery.masked += more.masked;
      discovery.dropped += more.dropped;
      discovery.offers = [...(discovery.offers ?? []), ...more.offers];
      if (more.error && !discovery.error) discovery.error = more.error;
      if (more.browserPages.length) {
        discovery.browserOpened = (discovery.browserOpened ?? 0) + more.browserPages.length;
        discovery.browserCodes = (discovery.browserCodes ?? 0) + more.browserCodes;
      }
      if (more.browserSkipped?.why === "declined") discovery.browserDeclined = (discovery.browserDeclined ?? 0) + more.browserSkipped.count;
      if (more.browserSkipped) trace("coupons:browser-skipped " + more.browserSkipped.why + " " + more.browserSkipped.count);
    };
    // Host and path only, for the run trace (no query strings).
    const pageLabel = (url: string): string => {
      try {
        const u = new URL(url);
        return u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/+$/, "");
      } catch {
        return "?";
      }
    };
    const searched = searching
      .then((sug) => {
        addUsage(sug);
        tally(sug);
        if (sug.error) trace("coupons:search-error " + sug.error.code);
        trace("coupons:pages listed=" + sug.pagesListed + " opened=" + sug.pagesOpened + (sug.pagesRead ? " read-first" : ""));
        for (const p of sug.pages) trace("coupons:page " + pageLabel(p.url) + " " + (p.ok ? "ok" : p.error ?? "error") + " " + (p.chars ?? 0));
        trace("coupons:candidates store=" + onSite.length + " verified=" + sug.verified + " reported=" + sug.reported + " dropped=" + sug.dropped + " masked=" + sug.masked + " ignored=" + sug.ignored + " read=" + sug.readFromPages);
        say(discoveryLine(discovery));
        if (sug.offers.length) say("Code-free offers the pages mention (not tested): " + sug.offers.slice(0, 3).join("; ") + ".");
        first.done();
        return sug;
      })
      .finally(() => queue.close());
    let best: number | null = null;
    const outcome = await runCouponSearch({
      page: couponPage,
      tester: found,
      codes: onSite,
      incoming: queue,
      control: run,
      delayMs: 250,
      askMore: (state) => {
        steps.end();
        return deps.askMore(state, run.signal);
      },
      findMore: (known) => {
        trace("coupons:find-more known=" + known.length);
        say("Searching the web again for " + merchant.brand + " codes, in other places…");
        steps.post("Searching the web again for " + merchant.brand + " coupons, in other places…");
        triedBefore = tried;
        const again = progress(true);
        const more = new CodeQueue();
        void suggestCodes(client, model, merchant, ac.signal, {
          browser: browserPages,
          exclude: known,
          more: true,
          onFound: (fresh) => {
            more.push(fresh);
            again.found(fresh.length);
          },
          ...(deps.effort ? { effort: deps.effort } : {}),
        })
          .then((f) => {
            addUsage(f);
            tally(f);
            if (f.error) trace("coupons:search-error " + f.error.code);
            trace("coupons:candidates verified=" + f.verified + " reported=" + f.reported + " dropped=" + f.dropped + " masked=" + f.masked);
            say(f.codes.length > 0 ? "Found " + plural(f.codes.length, "more code") + " to try." : "No more codes found.");
            again.done();
          })
          .catch(() => undefined)
          .finally(() => more.close());
        return more;
      },
      onTry: () => {
        tried++;
      },
      onAttempt: (a, index, _total, currency) => {
        trace("coupons:attempt " + index + (a.combo ? " combo" : "") + (a.accepted === false ? " rejected" : a.saving && a.saving > 0 ? " saving" : " none"));
        emit({ kind: "attempt", attempt: a, ...(currency ? { currency } : {}) });
        // A new best: say so in the chat.
        if (a.accepted !== false && a.saving !== null && a.saving > 0 && a.total !== null && (best === null || a.saving > best)) {
          best = a.saving;
          const off = formatMoney(a.saving, currency) + " (" + percentOff(found.baseline, a.total) + ")";
          steps.post(
            a.combo ? a.combo.join(" + ") + " together save " + off + "." : "Found code " + a.code + ", saves " + off + ". Continuing to apply for better savings.",
          );
        }
      },
    });
    // A run that ended early (CAPTCHA, the store asked to slow down) needs no more codes.
    over = true;
    ac.abort();
    await searched.catch(() => undefined);
    trace("coupons:status " + outcome.status + (outcome.best ? " best" : " none") + (outcome.applied ? " applied" : ""));
    if (outcome.status === "no_codes") {
      // Nothing to test: say so plainly; the cart stays as it was.
      const stopped = discovery.error?.code === "stopped" || run.isStopped;
      const failed = !stopped && !!discovery.error;
      outcome.status = stopped ? "stopped" : failed ? "search_failed" : "no_codes";
      outcome.message = "Nothing was tested, and your cart is unchanged.";
      return finish({
        status: outcome.status,
        message: outcome.message,
        outcome: stopped ? "stopped" : failed ? "error" : "done",
        summary: couponSummary(outcome, discovery),
        tone: failed ? "error" : "assistant",
        status_text: formatCostLine(model, used),
      });
    }
    return finish({
      status: outcome.status,
      message: outcome.message,
      outcome: outcome.status === "stopped" ? "stopped" : outcome.status === "done" ? "done" : "error",
      summary: couponSummary(outcome, discovery),
      tone: outcome.status === "no_form" || outcome.status === "error" ? "error" : "assistant",
      status_text: formatCostLine(model, used),
    });
  } catch {
    const summary = "Could not finish the coupon search. Nothing was ordered.";
    return finish({ status: "error", message: summary, outcome: "error", summary, tone: "error", status_text: couponStatusText("error") });
  }
}
