# Recon map: AssistAnt references — SafarAI + Comet assistant (Safari macOS + iOS)

Scope: toolbar AI assistant inside Safari: page Q&A, summaries, multi-tab
context, and an approval-gated browser agent, including a coupon finder at
checkout. Bring-your-own API key (Anthropic or OpenAI).
For: owner's own product (AssistAnt). Business details UNKNOWN.
Date: 2026-10-15

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | SafarAI README / DEVELOPMENT / manifest | https://github.com/andreapianidev/SafarAI | public, unlicensed: behavior only |
| 2 | Comet marketing page | https://www.perplexity.ai/comet | thin on UX detail |
| 3 | Owner-pasted Comet feature summary | chat, 2026-10-15 | secondhand, unverified |

## Core loop

On any page, open AssistAnt from the toolbar, ask or delegate, and get an
answer or a supervised multi-step action run.

## Screens

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Host app welcome (macOS) | launch app | explain + open Safari extension settings | steps list, button | not enabled, enabled |
| S02 | Host app welcome (iOS) | launch app | how to enable in Settings > Safari > Extensions | steps list | not enabled |
| S03 | Provider + API key | host app, or popup when no key | choose Anthropic/OpenAI, paste key, test it | segmented control, secure field, test button | empty, testing, valid, invalid, network error |
| S04 | Toolbar chat popup | toolbar icon (macOS) / page menu (iOS) | ask about page, summarize, start agent | message list, composer, quick actions, @tab picker | no key, empty, streaming, error, rate limited |
| S05 | Agent run view | from S04 when a task needs actions | show plan, live steps, Pause/Stop | step list, status chip, Pause, Stop | planning, running, paused, needs approval, done, failed |
| S06 | Approval sheet | agent hits a sensitive action | user approves or denies one action | action summary, Approve, Deny | pending |
| S07 | Coupon results | end of coupon run | tried codes, best saving, applied code | results table, totals | none found, some failed, best applied |
| S08 | Settings | gear in S04 / host app | provider, model, site access, history retention, delete all data, legal links | lists, toggles, destructive button + confirm | default |
| S09 | Legal + about | S08 | privacy policy, terms, version | text | — |

## Flows

```
F01 First-run setup
    S01|S02 -> Safari settings (enable) -> S03 -> S04
    happy path clicks: ~6 (Safari settings steps are Apple's)
    edge: extension disabled, site access denied, invalid key, no network

F02 Ask about this page
    S04 type question -> streamed answer
    happy path clicks: 2
    edge: page too large (truncate), restricted page (safari settings, PDFs), no key

F03 Summarize page
    S04 Summarize quick action
    happy path clicks: 2

F04 Ask across tabs (@tab)
    S04 @tab picker -> select tabs -> answer
    edge: tab without host permission, iOS tab access limits

F05 Delegate a task (agent)
    S04 "Control my browser: ..." -> S05 plan -> steps -> S06 on sensitive step -> done
    edge: page changes mid-run, element not found, CAPTCHA (stop, hand to user), prompt injection on page, user Stop

F06 Coupon finder at checkout
    S04 "find coupons" -> S05 (web search for codes -> try each code 1x1, read total) -> S07 best applied
    happy path clicks: 2 + approval to start trying codes
    edge: no codes found, site rate-limits/blocks, cart total unreadable, code removes other discount, site requires login
    rule: never places the order. User checks out.

F07 Delete all data
    S08 Delete all data -> confirm -> key removed from Keychain, history cleared
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Button | primary, secondary, ghost, danger | default, hover, focus, disabled, loading | all |
| Message bubble | user, assistant, system/error | streaming, done, error | S04 |
| Composer | text, with @tab chips | empty, typing, sending, disabled | S04 |
| Step row | read, click, type, navigate, search, apply-code | pending, running, done, failed, skipped | S05 |
| Approval sheet | — | pending | S06 |
| Secure key field | — | empty, filled (masked), invalid | S03 |
| Status chip | planning, running, paused, done, failed | — | S05 |
| Results table | — | empty, filled | S07 |

## Inferred data model (local only, no server)

```
ProviderConfig  provider (anthropic|openai), model, key_ref (Keychain item id)
                evidence: S03; confidence: high (own design)
Conversation    id, created_at, tab_url_origin, messages[] — local, user-clearable, retention setting
                confidence: high (own design)
AgentRun        id, task_text, status, steps[], started_at, ended_at, token_usage
ActionStep      tool, target_descriptor, input (redacted), requires_approval, approval (approved|denied), result
CouponAttempt   code, source_url, total_before, total_after, status (applied|rejected|error)
```

Relationships: Conversation 1-n AgentRun, AgentRun 1-n ActionStep, AgentRun 1-n CouponAttempt.

## Feature matrix

See `features.csv`. Must: 20, should: 7, could: 6, skip: 6 (12 rows marked could, 6 of them skip).

## Out of scope (cannot or should not be cloned)

- Perplexity's own search engine and citations index (use provider web-search tools instead).
- Comet's Chromium-only APIs (tab groups, side panel) where Safari lacks them.
- Account integrations (Gmail, Calendar, Notion) need OAuth + a backend; deferred, not MVP.
- Autonomous purchasing and login: intentionally excluded (see README intentional differences).

## Size

Screens 9, flows 7, entities 5. Hard parts: reliable DOM action layer across
arbitrary sites; prompt-injection resistance; iOS Safari extension limits
(non-persistent background, memory); coupon testing vs merchant bot detection.
Size: L.
