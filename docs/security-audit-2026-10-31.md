# Security hardening audit, 2026-10-31

Scope: this repo (`main` at 91937c0) and the site repo `HarrisonFischberg/studio-site`
(rarecreatures.app). Branch `security-hardening` here, branch `security-headers` on the site.

## Stack summary

Scout is a Manifest V3 browser extension (TypeScript bundled with esbuild, no framework) for
Safari on macOS and iOS, Chrome and Firefox, wrapped in a SwiftUI setup app. There is **no
backend, no database, no accounts, no auth provider, no payments and no SMS/email**. The user
brings their own Anthropic or OpenAI key: Safari keeps it in the Keychain through a native
messaging bridge (`apple/Extension/KeychainStore.swift`), Chrome/Firefox keep it in
`storage.local`. LLM features: chat, page summaries, web search, a tool-using agent ("Scout
mode") that clicks and fills pages, and Find coupons (downloads coupon pages from the worker).
Store releases run locally (`release.sh`, fastlane, web-ext, chrome-webstore-upload-cli).
The site is static hand-written HTML on Cloudflare Pages.

Attack surface: extension messages (sender-checked in `src/bridge/messages.ts`), page content
entering prompts, model tool calls (`src/tools/host.ts`, `src/actions/executor.ts`), outbound
fetches to the two AI providers and to coupon sites (`src/coupons/quiet-read.ts`), links built
from model and page output, the native Keychain/Apple-model bridge, release scripts.

Environment variables (all local, none reach a bundle): `ASC_KEY_ID`, `ASC_ISSUER_ID`,
`ASC_KEY_PATH` (fastlane), `CWS_CLIENT_ID/SECRET/REFRESH_TOKEN/EXTENSION_ID/PUBLISHER_ID`,
`AMO_JWT_ISSUER/SECRET` (release.sh), `SCOUT_LIVE_KEY`, `SCOUT_REVIEW_TEST_KEY`,
`SCOUT_REVIEW_PHONE` (live tests and review notes), and build/test switches (`SCOUT_TARGET`,
`SCOUT_BUILD`, `SCOUT_TEAM`, `E2E_PORT`, `MOCK_PORT` ...). No secret is reachable from client
code: the built bundles contain only the `sk-ant-`/`sk-` prefixes used to check key format.

## Results

| # | Vector | Status | Severity | What I found | What I did / what you need to do |
|---|--------|--------|----------|--------------|----------------------------------|
| 1 | Next.js middleware bypass | ➖ N/A | – | No Next.js anywhere; extension is esbuild, site is static HTML. | – |
| 2 | Exposed .git / dotfiles | 🔧 Fixed + ⚠️ | Low | Package builds copied every file in `src/icons` and zipped every file, so a `.DS_Store` would ship. Git history of both repos: no real secrets (only synthetic fixtures in `tests/unit/context.test.ts`). Site: Cloudflare Pages serves the repo root, so `README.md`, `docs/` and possibly `.claude/launch.json` are public (nothing sensitive in them). | Build skips dotfiles in the icons copy and the store zips. You: open rarecreatures.app/.claude/launch.json and /.git/config once and confirm 404 (the container cannot reach the site). |
| 3 | Supabase storage | ➖ N/A | – | No Supabase or any storage bucket. | – |
| 4 | Trusted price from browser | ➖ N/A | – | No server or checkout; apps are free. Coupon savings are display-only and come from the merchant's own cart. | – |
| 5 | Credential stuffing | ➖ N/A | – | No accounts or login. | – |
| 6 | Open database | ➖ N/A | – | No database. The local mock and fixture servers bind to 127.0.0.1 only and the mock switch is compiled out of release builds (`npm run check:release`). | – |
| 7 | Compromised third-party scripts | ✅ Already safe | – | No CDN or remote scripts in the extension or the site; MV3 forbids remote code. `npm audit`: 0 vulnerabilities. Release tools are pinned (`web-ext@10.8.0`, `chrome-webstore-upload-cli@4.0.2`). | – |
| 8 | SMS pumping | ➖ N/A | – | No SMS. | – |
| 9 | Prompt injection | 🔧 Fixed (part) / ✅ | Medium | Already strong: page text is fenced as untrusted and fence tags are stripped; Markdown renders with `textContent` only; secrets are redacted from page text; opening/closing tabs, payments, logins, account changes and deletes need the user's confirmation; leaving the start site asks. Gap: source chips, the sources list and coupon source links used provider or page URLs as `href` without a scheme check. | `linkHref()` in `src/chat/sources.ts` makes only http(s) links clickable (test in `tests/unit/sources.test.ts`). Cost is bounded by `max_tokens` per request and the user's own key. |
| 10 | Weak JWT secret | ➖ N/A | – | Scout issues and verifies no JWTs. The only JWT credential is the AMO signing secret, used by web-ext. | Moved it off the command line (see "Anything else"). |
| 11 | Race conditions | ✅ Already safe | Low | No balances, credits or redemptions. Storage read-modify-writes already run under `withLock` (PRs #93, #116). | Two leftovers from the 2026-10-27 code audit (items 3 and 4) are listed below. |
| 12 | Account pre-hijacking | ➖ N/A | – | No accounts or OAuth. | – |
| 13 | Subdomain takeover | ⚠️ Needs you | Low | No CNAME file or host config in either repo. Domains referenced: `rarecreatures.app` (Cloudflare Pages project `studio-site`), `studio-site-8o6.pages.dev` previews, `harrisonfischberg.github.io`. | DNS checklist below. |
| 14 | SSRF | 🔧 Fixed | Medium | Find coupons downloads coupon pages from the worker with Scout's site access. A search result or coupon page could point it at `192.168.1.1`, `localhost`, `169.254.169.254` or a `.local` host, and follow redirects there. | `isPublicWebUrl()` in `src/coupons/quiet-read.ts` refuses non-http(s), loopback, private, link-local, CGNAT, IPv6 local, single-label and local-suffix hosts, before the request and after redirects (tests in `tests/unit/coupon-quiet.test.ts`). Scout mode navigation and Open tab already need confirmation and allow only http(s). |
| 15 | Path traversal | ➖ N/A | – | No file upload or download built from user input; scripts write only to fixed or timestamped folders. | – |
| 16 | Password reset poisoning | ➖ N/A | – | No reset, magic-link or invite emails. | – |
| 17 | Source maps / secrets in bundle | ✅ Already safe | – | esbuild emits no source maps; release builds are minified; no `.map` files in any output; no keys or private endpoints in the bundles. | – |
| 18 | Clickjacking | 🔧 Fixed (site) / ✅ (extension) | Low | Extension pages are not web-accessible, so no website can frame them. The site sent only `nosniff`: no `frame-ancestors`, `X-Frame-Options`, HSTS or referrer policy. | Added `_headers` to studio-site (PR on branch `security-headers`): `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, HSTS (1 year, no subdomains/preload), `Permissions-Policy`. The CSP leaves `script-src` alone so inline scripts keep working. |
| 19 | Open redirect | ✅ Already safe | – | No redirect parameters. Model-chosen navigation is http(s)-only and asks before leaving the site; Markdown links require http(s). The site's `_redirects` are fixed paths. | – |
| 20 | User enumeration | ➖ N/A | – | No accounts or lookup endpoints. | – |

## 1. Secrets to rotate

None found. Both repos' full git history was searched for Anthropic, OpenAI, AWS, GitHub and
Google keys, private keys and `.env`/`.p8`/`.pem` files; the only hits are synthetic fixtures.

## 2. Manual steps for you, in priority order

1. Merge the studio-site headers PR, then check the live headers once (for example on securityheaders.com) and that the pages still look right.
2. Cloudflare DNS for rarecreatures.app: list every record and delete any CNAME that points at a service you no longer use (old Pages projects, GitHub Pages, Netlify, Vercel, Heroku, S3).
3. GitHub Pages: if `harrisonfischberg.github.io` ever had a custom domain, verify that domain under GitHub Settings → Pages → Verified domains so nobody else can claim it.
4. Turn on two-factor sign-in for every account that can publish Scout: Apple Developer, Chrome Web Store (Google), Firefox Add-ons, GitHub and Cloudflare.
5. GitHub: turn on secret scanning and push protection for both repos (Settings → Code security).
6. Confirm rarecreatures.app/.claude/launch.json and /.git/config return 404 (item 2).

## 3. Anything else concerning

- **Firefox signing secret on the command line (fixed).** `release.sh` passed the AMO key and secret as arguments, visible to any local process. They now go in through web-ext's own `WEB_EXT_API_KEY`/`WEB_EXT_API_SECRET`.
- **Keychain accessibility (not changed, your call).** The Safari API key is stored with `kSecAttrAccessibleAfterFirstUnlock`, so it travels in encrypted device backups and migrations. `...ThisDeviceOnly` would keep it on one device, but people restoring a new phone would have to enter their key again.
- **Firefox source upload sends the whole repo.** `release.sh` uploads `git archive HEAD` to Mozilla reviewers: docs, `activity.md`, live-suite evidence and store notes included. Not public, but more than reviewers need. A `.gitattributes` `export-ignore` list could trim it.
- **API key at rest on Chrome/Firefox.** Those browsers have no Keychain, so the key sits in `storage.local`. That is normal for bring-your-own-key extensions; worth one line in the privacy policy.
- **Debug log in release builds** (your 2026-10-24 decision). Revisit before the public App Store release.
- **Open items from the 2026-10-27 code audit:** diagnostics are written whole by each panel (two panels erase each other, and the log can come back after Delete all data); coupon memory saves are not awaited, so Delete all data can be undone by a save landing afterwards.
- **No explicit extension CSP.** The MV3 default (`script-src 'self'`) already blocks remote and inline code. Adding `object-src 'none'; base-uri 'none'` would be belt-and-braces, but needs a Safari device check first.

## Verification

- Unit tests: 718/718 pass (`npm test`), including the new link and public-web tests.
- `npm run typecheck`, `npm run lint`, `npm run build`, `npm run check:release`: all pass.
- e2e: WebKit is not installed in the cloud container, so the suite ran on Chromium for the chat, coupons and actions specs: 35 passed, 1 failed (`coupons.spec.ts:212`), which fails the same way on `main` (known Chromium e2e failures). The WebKit run belongs in the next device check.
- Dotfiles: built the Firefox package with a planted `src/icons/.DS_Store`; neither the folder nor the zip contained it.
- Attack checks (as unit tests): a coupon link to `http://192.168.1.1/` is never downloaded even with access to every site; a public page that redirects to `127.0.0.1` is dropped with no codes read; `javascript:`, `data:` and extension URLs never become links.
