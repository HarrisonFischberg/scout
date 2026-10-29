// One Find coupons run, start to finish, without any panel (S07, T031). The
// background worker runs it (src/server/coupon-host.ts), so it keeps going
// when the panel closes; iPhone users swipe the panel away to watch the
// pointer work (owner request 2026-10-19). Everything the panel shows comes
// out as events: chat lines, milestone steps, one row per tested code, the
// question after a search that saved nothing, and the summary. A reopened
// panel replays them. Diagnostics stages are stage names only, never content.
import type { Action, ActionResult } from "../actions/executor";
import type { AgentControl } from "../agent/control";
import { formatCostLineParts } from "../cost";
import { withLock } from "../settings/lock";
import type { Effort, ProviderClient, Usage } from "../providers/types";
import { browserFirstSites, countFetch, parseReaderHosts, READER_HOSTS_KEY } from "./reader-hosts";
import { browserTrace, type BrowserTarget, type PageBrowser } from "./browser-read";
import { mergeCandidates, rankCandidates, type CouponCandidate } from "./candidates";
import { couponSearchModel, passTrace, suggestCodes, type SuggestedCodes } from "./codes";
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
import { identifyMerchant, sellsLine } from "./merchant";
import { formatMoney } from "./money";
import { codesWithContext, MAX_STORE_CODES, type StoreCode } from "./store";
import { guessCodes } from "./guesses";
import { readOwnSite } from "./own-site";
import { countSites, noteRefused, parseRefused, parseSiteStats, rankPending, REFUSED_KEY, SITE_STATS_KEY } from "./priority";
import { parseWorked, rememberedCodes, updateWorked, WORKED_KEY } from "./memory";
import { mostlyExpired, type RejectKind } from "./reasons";
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
  | { kind: "ask"; prompt_id: string; tried: number; seconds?: number; best?: string }
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
  // The web search runs on a stronger model than Haiku (owner decision
  // 2026-10-19, "Sonnet for search"): Haiku found no code online on getbeefy.co.
  // Everything else (finding the coupon box) keeps the panel's model.
  const searchModel = couponSearchModel(client.id, model);
  let used: Usage = { inputTokens: 0, outputTokens: 0 };
  let usedByModel = new Map<string, Usage>();
  const addUsage = (more: { inputTokens: number; outputTokens: number; webSearches?: number }, by = model): void => {
    const sum = (a: Usage): Usage => {
      const searches = (a.webSearches ?? 0) + (more.webSearches ?? 0);
      return { inputTokens: a.inputTokens + more.inputTokens, outputTokens: a.outputTokens + more.outputTokens, ...(searches ? { webSearches: searches } : {}) };
    };
    used = sum(used);
    usedByModel = new Map(usedByModel).set(by, sum(usedByModel.get(by) ?? { inputTokens: 0, outputTokens: 0 }));
  };
  const costLine = (): string => formatCostLineParts([...usedByModel].map(([m, u]) => ({ model: m, usage: u })));
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
    // Links on the page too: on a hosted checkout (shop.app) one of them is the store's own site.
    const links = [...(meta?.links ?? []), ...snap.elements.flatMap((e) => (e.href ? [e.href] : []))];
    const merchant = identifyMerchant(snap.url, { ...(meta ?? {}), links });
    const sells = sellsLine(meta);
    const linked = merchant.domain !== identifyMerchant(snap.url, { ...(meta ?? {}), links: [] }).domain;
    trace("coupons:merchant " + (merchant.host === merchant.domain ? "store-host" : "other-host") + (linked ? " linked" : "") + (meta?.siteName ? " named" : "") + (sells ? " sells" : ""));
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
    // Codes that worked on this store before, kept on this device: tried first.
    const storage = deps.storage;
    const worked = parseWorked(storage ? (await storage.get(WORKED_KEY).catch(() => ({}) as Record<string, unknown>))[WORKED_KEY] : undefined);
    const remembered = rememberedCodes(worked, merchant.domain).filter((c) => !onSite.some((s) => s.code === c.code));
    trace("coupons:remembered " + remembered.length);
    onSite.unshift(...remembered);
    // What this device learned (src/coupons/priority.ts): which coupon sites' codes work, and what this store refused lately.
    const stored = async (key: string): Promise<unknown> => (storage ? (await storage.get(key).catch(() => ({}) as Record<string, unknown>))[key] : undefined);
    const siteStats = parseSiteStats(await stored(SITE_STATS_KEY));
    const refused = parseRefused(await stored(REFUSED_KEY))[merchant.domain] ?? {};
    trace("coupons:learned sites=" + Object.keys(siteStats).length + " refused=" + Object.keys(refused).length);
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
    // The store's own site (home page and its promotion pages), read quietly while the web search runs; its codes go first.
    const named = !/^(?:\d{1,3}\.){3}\d{1,3}$|^localhost$/.test(merchant.domain) && merchant.domain.includes(".");
    let ownDone = false;
    const held: CouponCandidate[][] = [];
    const toTest = (list: CouponCandidate[]): void => void (ownDone ? queue.push(list) : held.push(list));
    const ownSite = (named ? readOwnSite(deps.tabs, merchant.domain, { signal: ac.signal }) : Promise.resolve({ codes: [], pages: 0 }))
      .catch(() => ({ codes: [], pages: 0 }))
      .then((r) => {
        const fresh = r.codes.filter((c) => !storeFound.has(c.code)).map((c) => asStore(c, c.url));
        trace("coupons:own-site pages=" + r.pages + " codes=" + fresh.length);
        for (const c of fresh) storeFound.add(c.code);
        if (fresh.length && !run.isStopped) {
          discovery.store += fresh.length;
          queue.push(fresh);
          first.found(fresh.length);
        }
        // The search's codes wait for this read (OWN_SITE_MS at most), so the store's own codes are tested first.
        ownDone = true;
        for (const h of held.splice(0)) queue.push(h);
      });
    // A code the search found on the store's own domain is the store's own code.
    const onStoreSite = (url: string): boolean => {
      try {
        const h = new URL(url).hostname.toLowerCase();
        return h === merchant.domain || h.endsWith("." + merchant.domain);
      } catch {
        return false;
      }
    };
    trace("coupons:search");
    // Sites that refused the reader on this device go to a background tab first; each fetch is counted.
    let readerHosts = parseReaderHosts(storage ? (await storage.get(READER_HOSTS_KEY).catch(() => ({}) as Record<string, unknown>))[READER_HOSTS_KEY] : undefined);
    const browserPages = {
      tabs: deps.tabs,
      allow: deps.allowBrowser,
      onPage: (p: Parameters<typeof browserTrace>[0]) => trace(browserTrace(p)),
      firstHosts: browserFirstSites(readerHosts),
      onReader: (url: string, ok: boolean) => {
        readerHosts = countFetch(readerHosts, url, ok, Date.now());
        // Counted on what is saved now: a run in another tab may have counted too.
        if (storage) {
          void withLock(READER_HOSTS_KEY, async () => {
            const saved = parseReaderHosts((await storage.get(READER_HOSTS_KEY))[READER_HOSTS_KEY]);
            await storage.set({ [READER_HOSTS_KEY]: countFetch(saved, url, ok, Date.now()) });
          }).catch(() => undefined);
        }
      },
    };
    trace("coupons:browser-first " + browserPages.firstHosts.length);
    if (searchModel !== model) trace("coupons:search-model " + searchModel);
    const searching = suggestCodes(client, searchModel, merchant, ac.signal, {
          ...(sells ? { sells } : {}),
      browser: browserPages,
      onFound: (found) => {
        const fresh = found.map((c): CouponCandidate => (named && c.sourceUrl && onStoreSite(c.sourceUrl) && c.origin !== "store" ? { ...c, origin: "store" } : c));
        toTest(fresh);
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
    // Guesses (owner decision 2026-10-19): after every code the search found, never before.
    let guessed = 0;
    const known = new Set<string>(onSite.map((c) => c.code));
    const searched = searching
      .then(async (sug) => {
        await ownSite;
        addUsage(sug, searchModel);
        tally(sug);
        if (sug.error) trace("coupons:search-error " + sug.error.code);
        trace("coupons:pages listed=" + sug.pagesListed + " opened=" + sug.pagesOpened + (sug.pagesRead ? " read-first" : ""));
        for (const p of sug.pages) trace("coupons:page " + pageLabel(p.url) + " " + (p.ok ? "ok" : p.error ?? "error") + " " + (p.chars ?? 0));
        trace("coupons:candidates store=" + onSite.length + " verified=" + sug.verified + " reported=" + sug.reported + " dropped=" + sug.dropped + " masked=" + sug.masked + " ignored=" + sug.ignored + " read=" + sug.readFromPages);
        for (const p of sug.passes) trace(passTrace(p));
        trace("coupons:angles " + sug.angles + (sug.anglesFailed ? " failed=" + sug.anglesFailed : "") + " hints=" + sug.percents.length);
        for (const c of sug.codes) known.add(c.code);
        say(discoveryLine(discovery));
        if (sug.offers.length) {
          const list = sug.offers.slice(0, 3).join("; ");
          say("Code-free offers the pages mention (not tested): " + list + (/[.…!?]$/.test(list) ? "" : "."));
        }
        // A search the provider refused (key, credit) says so on its own; a timeout still leads to guesses.
        if (!run.isStopped && (!sug.error || sug.error.code === "timeout")) {
          const guesses = guessCodes({ merchant, percents: sug.percents, known });
          guessed = guesses.length;
          discovery.guesses = guessed;
          trace("coupons:guesses " + guessed);
          if (guesses.length) {
            say("Trying " + plural(guesses.length, "guessed code") + " too, built from the store's name and common codes. These are guesses, not codes seen online.");
            queue.push(guesses);
          }
        }
        first.done();
        return sug;
      })
      .finally(async () => {
        await ownSite;
        queue.close();
      });
    let best: number | null = null;
    const kinds: RejectKind[] = [];
    const outcome = await runCouponSearch({
      page: couponPage,
      tester: found,
      codes: onSite,
      incoming: queue,
      control: run,
      delayMs: 250,
      rank: (pending, attempts) => rankPending(pending, attempts, { merchant, sites: siteStats, refused }),
      askMore: (state) => {
        steps.end();
        return deps.askMore(state, run.signal);
      },
      checkpoint: (state) => {
        trace("coupons:checkpoint tried=" + state.tried + " s=" + (state.checkpoint?.seconds ?? 0) + (state.checkpoint?.best ? " best" : ""));
        steps.end();
        return deps.askMore(state, run.signal);
      },
      findMore: (already) => {
        trace("coupons:find-more known=" + already.length);
        say("Searching the web again for " + merchant.brand + " codes, in other places…");
        steps.post("Searching the web again for " + merchant.brand + " coupons, in other places…");
        triedBefore = tried;
        const again = progress(true);
        const more = new CodeQueue();
        // Mostly expired codes: this round looks for promotions running now first.
        const fresh = mostlyExpired(kinds);
        trace("coupons:find-more" + (fresh ? " fresh" : ""));
        void suggestCodes(client, searchModel, merchant, ac.signal, {
          ...(sells ? { sells } : {}),
          browser: browserPages,
          exclude: already,
          more: true,
          ...(fresh ? { fresh: true } : {}),
          onFound: (fresh) => {
            more.push(fresh);
            again.found(fresh.length);
          },
          ...(deps.effort ? { effort: deps.effort } : {}),
        })
          .then((f) => {
            addUsage(f, searchModel);
            tally(f);
            if (f.error) trace("coupons:search-error " + f.error.code);
            for (const p of f.passes) trace(passTrace(p));
            trace("coupons:candidates verified=" + f.verified + " reported=" + f.reported + " dropped=" + f.dropped + " masked=" + f.masked + " ignored=" + f.ignored);
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
        if (a.kind) kinds.push(a.kind);
        // Saved as each code is tested: a run Safari closes in the background still counts (owner's sproos log 2026-10-29).
        if (storage && !a.combo) {
          void withLock(REFUSED_KEY, async () => {
            const all = parseRefused((await storage.get(REFUSED_KEY))[REFUSED_KEY]);
            await storage.set({ [REFUSED_KEY]: noteRefused(all, merchant.domain, [a]) });
          }).catch(() => undefined);
          void withLock(SITE_STATS_KEY, async () => {
            const all = parseSiteStats((await storage.get(SITE_STATS_KEY))[SITE_STATS_KEY]);
            await storage.set({ [SITE_STATS_KEY]: countSites(all, [a]) });
          }).catch(() => undefined);
        }
        // Stage words only: the group of the store's reply (never its words) and where the code came from.
        trace("coupons:attempt " + index + (a.combo ? " combo" : "") + (a.accepted === false ? " rejected" : a.saving && a.saving > 0 ? " saving" : " none") + (a.kind ? " " + a.kind : "") + " from " + sourceLabel(a));
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
    // Remember what worked here (and count remembered codes the store refused), on this device.
    if (storage && outcome.baseline) {
      const base = outcome.baseline;
      const seen = {
        worked: outcome.attempts.filter((a) => !a.combo && a.accepted !== false && a.saving !== null && a.saving > 0).map((a) => ({ code: a.code, pct: ((a.saving ?? 0) / base) * 100 })),
        refused: outcome.attempts.filter((a) => !a.combo && a.origin === "remembered" && (a.accepted === false || !a.saving)).map((a) => a.code),
      };
      // Updated on what is saved now, not what this run read at its start: another tab's run may have saved since.
      void withLock(WORKED_KEY, async () => {
        const saved = parseWorked((await storage.get(WORKED_KEY))[WORKED_KEY]);
        const next = updateWorked(saved, merchant.domain, seen);
        if (JSON.stringify(next) !== JSON.stringify(saved)) await storage.set({ [WORKED_KEY]: next });
      }).catch(() => undefined);
    }
    trace("coupons:status " + outcome.status + (outcome.best ? " best" : " none") + (outcome.applied ? " applied" : "") + (outcome.reapplied ? " reapply=" + outcome.reapplied : ""));
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
        status_text: costLine(),
      });
    }
    return finish({
      status: outcome.status,
      message: outcome.message,
      outcome: outcome.status === "stopped" ? "stopped" : outcome.status === "done" ? "done" : "error",
      summary: couponSummary(outcome, discovery),
      tone: outcome.status === "no_form" || outcome.status === "error" ? "error" : "assistant",
      status_text: costLine(),
    });
  } catch {
    const summary = "Could not finish the coupon search. Nothing was ordered.";
    return finish({ status: "error", message: summary, outcome: "error", summary, tone: "error", status_text: couponStatusText("error") });
  }
}

/** Where a tested code came from, for the run trace: the site's host only (no path or query). */
export function sourceLabel(a: { origin: string; sourceUrl?: string }): string {
  if (a.sourceUrl) {
    try {
      return new URL(a.sourceUrl).hostname.replace(/^www\./, "");
    } catch {
      // Falls through to the origin.
    }
  }
  return a.origin;
}
