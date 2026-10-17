# Coupon finder: merchant test suite and discovery evidence

Owner-provided list of 50 direct-to-consumer storefronts to exercise "Find
coupons" against (2026-10-17), with what live web discovery found for a
sample of them. The target: carts on at least 80% of these sites get a code
found live online applied successfully; if not reached, scale back to 75%
and so on.

## Status

| Date | Where | What ran | Result |
| --- | --- | --- | --- |
| 2026-10-17 | cloud build session | discovery research only (web search from the session's own tools; the container's network policy denied every merchant and coupon site, the npm registry, and page fetches) | 14 merchants searched; see table below. **No cart was opened and no code was applied anywhere: 0 of 50 checkout-validated.** |
| 2026-10-17 | owner's Mac: WebKit smoke run and sweep 1 in the owner's Terminal, then re-sweeps A–C, E in the Claude Code sandbox (Chromium, single-process, through the sandbox proxy), real Anthropic key, each merchant in a fresh browser context | 118 merchant runs over 7 run folders (`ralph/evidence/live-suite/`), latest real result per merchant kept | **34 of 56 carts had a code found online applied (61%): 72% of the 47 carts where a code could be tested, 74% of the 43 whose web search completed.** 33 confirmed by the store's cart API, 1 read from the page (Brumate). The owner's checkout-step pass (Chromium, their Terminal) added Cuts, Caraway and Bombas to the tested carts without a new application. See "Results, 2026-10-17" below. |

Checkout validation of this suite needs a Safari build on the owner's Mac or
iPhone with a real key (launch blocker 33): open each store, add an item,
open the cart or checkout, tap Find coupons, and record the outcome in the
table at the end of this file.

## How discovery is expected to behave (what the research showed)

- Sites that showed full, readable codes for these small brands: Wethrift,
  DealDrop, Coupons.com, Dealhack, GrabOn, RetailCoupons, DiscountReactor,
  PromoCodes.com, GoodSearch, Shopper.com, CouponCabin, Discoup, Slickdeals,
  ShipTheDeal. RetailMeNot and SimplyCodes rarely surfaced for them. The seed
  directory is therefore a hint in the prompt, not a visit list.
- Creator, press and community pages carry codes too: an Instagram post
  (Melin FRANKS20 via Wethrift), MyGolfSpy articles (MYGOLFSPY10, HOL30), a
  creator's page (Heart & Soil ANDREWJCASS10), Hip2Save and Slickdeals deal
  posts (Viori TRYVIORIFIRST), OzBargain threads (Peak Design), Android
  Central (Ekster CM35), AppleInsider (Nomad).
- Stores' own pages state the rules: Dr. Squatch's help center (hero
  discount, first-subscription 20%), Nomad's help center ("most discount
  codes apply only to full-priced, in-stock products", "one discount code per
  order"), Melin's FAQ (referral, GovX military discount).
- Many listed codes are expired or dated; the engine tests them anyway (the
  store decides) but ranks stale and restricted ones later.
- Merchant confusion is real: "carnivoresnax.com promo code" returned pages for
  Carnivore Club, Carnivore Crisps and Hardcore Carnivore. The engine keeps a
  code only when the search actually returned its page, and ranks pages that
  name the store higher; the prompt forbids codes for a similarly named store.
- Masked codes ("SAVE1***", "Get code" buttons) exist on most aggregators; the
  engine never completes them and reports how many it could not read.

## Discovery research, 2026-10-17 (search-result evidence only)

Each row lists codes that a search result page stated, with the page. None
was tested in a cart. "Checkout outcome" stays empty until a live run.

| # | Merchant | Codes a page stated | Source page(s) | Checkout outcome |
| --- | --- | --- | --- | --- |
| 1 | Carnivore Snax (carnivoresnax.com) | none for this store; results were for Carnivore Club / Carnivore Crisps | https://www.dealdrop.com/carnivore-club, https://www.wethrift.com/carnivore-crisps | not run |
| 7 | Chomps | BEEF20 (20%), B2HEALTHY22, WELCOMENEWUSERS, FATHERSDAY21 (old) | https://www.wethrift.com/chomps, https://www.dealdrop.com/chomps-usa, https://www.coupons.com/coupon-codes/chomps, https://hip2save.com/?p=10559344 | not run |
| 8 | OLIPOP (drinkolipop.com) | SODALOVE (15%), CITIUS25, NEWFLAVOR20 (old giveaway), JEWPRT / GQLLGO / NIJL20 (community) | https://www.retailcoupons.com/drinkolipopcom-promo-codes/, https://affsignal.com/merchant/Drinkolipop, https://shopper.com/discount-codes/drinkolipop-com | not run |
| 10 | Paleovalley | ALMOST30 (30%), LOWCARBATHLETE (20%) | https://www.dealdrop.com/paleovalley, https://www.wethrift.com/paleovalley, https://www.discountreactor.com/coupons/paleovalley | not run |
| 13 | Heart & Soil | ANDREWJCASS10 (creator, 10%), AMERICA250 (Truemed) | https://andrewjcass.substack.com/p/andrew-recommends, https://www.truemed.com/shop/partners/heart-%26-soil-supplements | not run |
| 18 | Magic Spoon | mostly $5-off codes listed, none confirmed; WAVY on a low-quality page (would rank low) | https://www.wethrift.com/magic-spoon, https://dealhack.com/coupons/magic-spoon | not run |
| 24 | MUD\WTR | THRIFTMUD (10%), FALL (15%) | https://www.wethrift.com/mudwtr, https://shipthedeal.com/store/mud-wtr-coupons | not run |
| 26 | Melin | FRANKS20 (Instagram, untested), HOL30 and MYGOLFSPY10 (time-limited, likely expired) | https://www.wethrift.com/codes/melin.com, https://mygolfspy.com/news-opinion/save-10-on-these-staff-favorite-hats-48-hours-only/, https://melin.com/pages/faq | not run |
| 27 | True Classic | 20% codes all marked expired; sale discounts apply automatically | https://dealhack.com/coupons/true-classic, https://www.wethrift.com/true-classic | not run |
| 28 | BYLT Basics | EXTRA20 (Last Call items), SCOTTY (20% storewide) | https://www.wethrift.com/bylt-basics, https://dealhack.com/coupons/bylt-basics | not run |
| 30 | Ekster | CM35 (past Cyber Monday), SUMMER, BACK20 | https://www.androidcentral.com/cyber-monday-deal-ekster-wallets-big-money-saver, https://grabon.com/ekster-coupons/ | not run |
| 39 | Nomad | SAVE5 (5%), FOOLS15 (2025), DADSNGRADS (2020); help center: one code per order, full-price items only | https://www.wethrift.com/nomad-goods, https://help.nomadgoods.com/en-US/discounts-&-sales-156259 | not run |
| 41 | Quad Lock | QL59327 (AU), QL-FRIEND-2165, FEELZ (UK), SAMSBIKES10 (US), MOTOCICLISTA29 (CA); region-specific | https://www.wethrift.com/quad-lock, https://www.dealdrop.com/quad-lock-4 | not run |
| 42 | Peak Design | $10 storewide code on Wethrift; IMAGING26 (B&H, not Peak Design's store); creator 20% codes expired | https://www.wethrift.com/peak-design, https://www.couponcabin.com/coupons/peak-design/ | not run |
| 44 | Rumpl | RACHEL15 (15%), GIVING25 (25%), NEEDED (25%), RAIDERS58 | https://www.wethrift.com/rumpl, https://www.dealdrop.com/rumpl-1, https://www.goodsearch.com/coupons/rumpl | not run |
| 46 | Viori | VIP25OFF (25%), LUXURY (20% bundles), MICHEFFS (10%), TRYVIORIFIRST (old first-order offer) | https://grabon.com/viori-coupons/, https://hip2save.com/deals/viori-shampoo-bars/ | not run |
| 47 | Dr. Squatch | help center: hero discount 10%, first subscription 20%; aggregator 10% / 5% codes; "45% off" pages look unreliable | https://help.drsquatch.com/articles/promotions-and-discount-codes-300238, https://www.coupons.com/coupon-codes/drsquatch | not run |
| 50 | Pura | wetriedpromo (15%), PURA25OFF (25%, unreliable page), newsletter 10% | https://wetried.it/pura-promo-code-2/, https://slickdeals.net/promo-codes/pura | not run |

## Results, 2026-10-17 (live carts)

Target: a code found live online applied on 80% of carts. **Reached 72% of
the carts where a code could be entered (34 of 47), 74% of the carts whose
web search completed (34 of 43), and 61% of all 56 carts.** Neither the 80%
target nor the 75% fallback was met; the next step down, 70%, was, on the
carts where testing was possible. (Before the checkout-step pass the same
34 stood at 77% of 44; the three checkout-only carts it reached, Cuts,
Caraway and Bombas, yielded no application.)

| Category | Count | Merchants |
| --- | --- | --- |
| applied, confirmed by the store's cart API | 33 | Ancestral Supplements, Breezy Golf, BUBS Naturals, Carnivore Aurelius, Carnivore Bar, Carnivore Crisps, Carnivore Snax, Catalina Crunch, Chomps, Clevr Blends, Duke Cannon, Ekster, Equip Foods, Fly By Jing, Four Sigmatic, Fresh Clean Threads, Good Good Golf, Groove Life, Heart & Soil, Huron, Just Ingredients (after-state only; the before-read failed), Kettle & Fire, Kion, Lineage Provisions, Magic Spoon, MASA, Melin, MUD\WTR, Perfect Keto, Quad Lock, Santa Cruz Paleo, Trayvax, Viori |
| applied, read from the page (no cart API) | 1 | Brumate (drawer; LL10-XEEG0MNF $149.99 → $139.99; only 1 of 24 codes tested because the drawer kept the applied code) |
| no working code (codes found, the store refused all) | 6 | Cuts (40 codes, tested on its checkout page), Grip6 (40), Luno (32), Matador (37), OLIPOP (48, three runs), Rumpl (50) |
| no codes found (only masked codes on the pages reached) | 7 | Bombas and Caraway (on their checkout pages), IQBAR, Mid-Day Squares, Tackform, True Classic, WORN |
| discount field only at checkout, not yet tested there | 7 | BYLT Basics, Chubbies, Javvy Coffee, Nomad, Paleovalley, Peak Design, Pura (the owner allowed the checkout's information step on 2026-10-17; the runner's `--checkout-step` reached it for Cuts, Caraway and Bombas, which moved to the rows above) |
| blocked by the harness or the site | 2 | Dr. Squatch (the runner cannot add its product), Ridge (bot wall) |

Counting rule: the latest run per merchant counts; a run that failed inside
the runner itself never replaces an earlier real result. Every "applied" row
names the code, the cart total before and after, and the page the code was
read from (`results.json`, `attempts[].source`); the cart API confirmation
is `verify.confirmed`. Builds: popup `472377364d` = engine c6e04ee,
`86113aba63` = ca11f85, `f3c5f1c539` = 1c2b867; sweep 1 ran before the
hash existed (engine 389193f).

Timing (latest results): applied: median 154 s over 34; no codes found: median 129 s over 5; no working code: median 257 s over 5; checkout-only: median 21 s over 10; blocked: median 23 s over 2. Web search, from the request to the
candidate list: median 115 s (n=34); testing, per code
on a cart API: median 0.9 s.
The popup's own cost line ran $0.16 (nothing found) to $0.36 (two searches,
50 codes) per merchant in the smoke run; the runner does not record cost, so
the day's total is only known from the console.

What the data changed in the engine (all on this branch): every found code
is tested after a saving instead of stopping at the first batch (62d69c2);
the search budget is four minutes and a search that times out with nothing
written is retried once from search results alone (9b1874b, 760522e: MASA
and Ancestral Supplements went from "discovery failed" twice to applied);
the request names the pages that print codes in full, ordered by what the
sweeps found productive (b7138e2, ceeda5c: Melin, Ekster, Clevr Blends,
Good Good Golf, Trayvax, Quad Lock, Huron, Kettle & Fire, Four Sigmatic
applied only after it); an account out of credit says so (c6e04ee; sweep 1
lost 20 merchants to "The provider rejected the request" before the cause
was known); a $0 cart is refused before any search (b9268b7); a drawer's
total is read from its Checkout button (ca11f85, Brumate); an empty answer
from the cart API falls back to the page (1c2b867, Nomad); a cart with a
Checkout button and no coupon box says where the field is (0a2fd0f); on a
store with no remove control, the page path keeps testing when the store
swaps the kept code for the next working one and stops only when it stacks
them, saying so (after the sweep; Brumate had tested 1 code of 24).

Still open: Tackform's STREETDEALX (verified by hand against its cart API,
$60 → $54) was never found by the engine in three runs (masked codes only,
or the search timed out); OLIPOP's 48 codes were all refused; four more
stores ended with masked codes only; Brumate's re-run on the swap-aware
page path is pending; the seven remaining checkout-only
stores await the owner-run checkout-step pass (`--checkout-step`; the
sandbox's policy forbids opening checkout from the agent's side); the
runner cannot add Dr. Squatch's, Paleovalley's, Pura's or Chubbies' products
(gift-card-first catalogs, custom platforms, subscription-first pages).

Harness notes: WebKit and multi-process Chromium cannot start inside the
Claude Code sandbox; `--single-process` Chromium through the sandbox proxy
can, so re-sweeps ran there (Chromium is now the suite's default; the e2e
specs stay on WebKit). Sweep 1 hung for five hours on a `fetch` inside
`page.evaluate` (now bounded). Lineage Provisions and WORN empty an
API-added cart from the cart page (an app's `/cart/update.js`, Lineage also
`/cart/change.js` quantity 0); the runner refills through the store's own
button. Every run's folder holds `results.json`, `summary.md` and, per
merchant, `cart-before.png`, `popup.png`, `cart-after.png`.

## Running the live suite

On a Mac with network access and the owner's Anthropic key in the shell as
`SCOUT_LIVE_KEY` (never in chat or in a file; not as `ANTHROPIC_API_KEY`,
which makes the Claude CLI refuse Remote Control):

```
npm ci && npm run build
SCOUT_LIVE_KEY=... node scripts/live-suite.mjs               # all merchants, Chromium
node scripts/live-suite.mjs --only "Chomps,Rumpl" --headed   # a few, visibly
node scripts/live-suite.mjs --browser webkit --limit 10       # WebKit, like Safari
node scripts/live-suite.mjs --cart-only --only "Pura"         # the cart step only: no popup, no API call
node scripts/live-suite.mjs --checkout-step --only "Nomad"    # carts with no discount field: the checkout's
                                                              # information page (owner's decision 2026-10-17;
                                                              # nothing typed, nothing submitted)
node scripts/live-suite.mjs --summarize ralph/evidence/live-suite/<dir>   # summary.md from a partial run
node scripts/live-suite-tally.mjs ralph/evidence/live-suite/<dir> ...      # latest result per merchant
```

Inside the Claude Code sandbox on macOS only Chromium starts, and only as
`--single-process`; the browser's traffic goes through the shell's
`HTTPS_PROXY` automatically. The sandbox's policy refuses commands that open
checkout pages, so `--checkout-step` runs are the owner's.

`scripts/live-suite.mjs` runs the real built popup and content script against
each store in `scripts/live-merchants.json`: fresh browser context, one item
added to the cart (Shopify stores through their own cart API, others by
clicking Add to cart), the cart page opened, Find coupons pressed, the
"Search again" question answered once, the result read from the panel and,
on Shopify stores, checked against the cart's own total and codes. Results,
screenshots and a Markdown table land in `ralph/evidence/live-suite/<stamp>/`;
append the table rows to the run log below. It never opens checkout.

## The 50 test targets

Food, beverages, and supplements: Carnivore Snax, Carnivore Crisps, MASA,
Carnivore Bar, Equip Foods, Carnivore Aurelius, Chomps, OLIPOP, Perfect Keto,
Paleovalley, Santa Cruz Paleo, Lineage Provisions, Heart & Soil, Ancestral
Supplements, Just Ingredients, BUBS Naturals, Kion, Magic Spoon, Catalina
Crunch, Mid-Day Squares, IQBAR, Javvy Coffee, Clevr Blends, MUD\WTR, Fly By
Jing.

Clothing, hats, and everyday accessories: Melin, True Classic, BYLT Basics,
Groove Life, Ekster, Fresh Clean Threads, Cuts, Good Good Golf, Breezy Golf,
WORN, Ridge, Trayvax, Grip6.

Device accessories, vehicle gear, and outdoor equipment: Nomad, Tackform,
Quad Lock, Peak Design, Luno, Rumpl, Matador.

Personal care and home: Viori, Dr. Squatch, Duke Cannon, Huron, Pura.

## Live run log

| Date | Merchant | Cart / checkout page | Method (cart API / page) | Codes found (store / verified / reported / masked / dropped) | Best code, saving | Outcome (applied / no working code / no codes found / discovery failed / no coupon box / blocked: captcha, rate limit, unreadable total) |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-10-17 | Ancestral Supplements | ancestralsupplements.com/cart | shopify | store=0 verified=4 reported=16 masked=4 | HOMEGROWN, $44.00 → $37.40 (cart API confirmed) | applied (build f3c5f1c539, run-rerun-e) |
| 2026-10-17 | Bombas | shop.bombas.com/checkouts/cn/hWNI50W9oUdOylxzqgV4BFwn/en-us (checkout information step) | page | store=0 verified=0 reported=0 masked=3 |  | no codes found (build f3c5f1c539, run-rerun-d2) |
| 2026-10-17 | Breezy Golf | breezygolf.com/cart | shopify | store=1 verified=0 reported=0 masked=5 | FAIRWAY10, $36.00 → $32.40 (cart API confirmed) | applied (build 472377364d, run-rerun-a) |
| 2026-10-17 | Brumate | www.brumate.com/ | page | store=0 verified=11 reported=13 masked=7 | LL10-XEEG0MNF, $149.99 → $139.99 (page read; no cart API) | applied (build f3c5f1c539, run-rerun-e) |
| 2026-10-17 | BUBS Naturals | www.bubsnaturals.com/cart | shopify | store=0 verified=0 reported=40 masked=0 | AIM725, $35.00 → $26.25 (cart API confirmed) | applied (build pre-hash, runT07-36-10) |
| 2026-10-17 | BYLT Basics | byltbasics.com/cart | none | - |  | no coupon box (discount field only at checkout) (build 472377364d, run-rerun-a) |
| 2026-10-17 | Caraway | shop.carawayhome.com/checkouts/cn/hWNI50HVFcqrYFpwORqzz1qz/en-us/information (checkout information step) | shopify | store=0 verified=0 reported=0 masked=6 |  | no codes found (build f3c5f1c539, run-rerun-d2) |
| 2026-10-17 | Carnivore Aurelius | carnivoreaurelius.com/cart | shopify | store=0 verified=21 reported=18 masked=3 | CALVIN02710, $94.99 → $80.75 (cart API confirmed) | applied (build 472377364d, run-rerun-a) |
| 2026-10-17 | Carnivore Bar | carnivorebar.com/cart | shopify | store=0 verified=32 reported=3 masked=0 | CDCADAM, $75.00 → $67.50 (cart API confirmed) | applied (build pre-hash, runT07-36-10) |
| 2026-10-17 | Carnivore Crisps | carnivorecrisps.com/cart | shopify | store=0 verified=0 reported=40 masked=0 | WELCOME15, $53.00 → $45.05 (cart API confirmed) | applied (build pre-hash, runT07-36-10) |
| 2026-10-17 | Carnivore Snax | carnivoresnax.com/cart | shopify | store=0 verified=12 reported=28 masked=0 | TRASHCHEESE, $28.02 → $23.82 (cart API confirmed) | applied (build pre-hash, runT07-36-10) |
| 2026-10-17 | Catalina Crunch | us.catalinacrunch.com/cart | shopify | store=0 verified=5 reported=34 masked=5 | DONTGO, $8.99 → $7.65 (cart API confirmed) | applied (build 472377364d, run-rerun-a) |
| 2026-10-17 | Chomps | chomps.com/cart | shopify | store=0 verified=14 reported=2 masked=0 | TOPFAN25, $30.00 → $22.50 (cart API confirmed) | applied (build pre-hash, runT07-36-10) |
| 2026-10-17 | Chubbies | www.chubbiesshorts.com/cart | none | - |  | no coupon box (discount field only at checkout) (build 472377364d, run-rerun-b) |
| 2026-10-17 | Clevr Blends | clevrblends.com/cart | shopify | store=1 verified=5 reported=32 masked=5 | SHOPHANNAH, $52.00 → $44.20 (cart API confirmed) | applied (build 86113aba63, run-rerun-c) |
| 2026-10-17 | Cuts | shop.cutsclothing.com/checkouts/cn/hWNI4zfwh38A5qCbUwtTbRsv/en-us (checkout information step) | shopify | store=1 verified=0 reported=0 masked=0 |  | no working code (build 86113aba63, run-rerun-d2) |
| 2026-10-17 | Dr. Squatch | www.drsquatch.com | - | - |  | blocked: could not add to cart (no Add to cart button on the produc… (build f3c5f1c539, run-rerun-e) |
| 2026-10-17 | Duke Cannon | dukecannon.com/cart | shopify | store=0 verified=9 reported=1 masked=0 | PUCK20, $40.00 → $32.00 (cart API confirmed) | applied (build 472377364d, run-rerun-b) |
| 2026-10-17 | Ekster | www.ekster.com/cart | shopify | store=0 verified=22 reported=17 masked=7 | AJS, $110.00 → $99.00 (cart API confirmed) | applied (build 86113aba63, run-rerun-c) |
| 2026-10-17 | Equip Foods | www.equipfoods.com/cart | shopify | store=1 verified=0 reported=0 masked=0 | AFFILIATE30, $134.99 → $94.50 (cart API confirmed) | applied (build pre-hash, runT07-36-10) |
| 2026-10-17 | Fly By Jing | flybyjing.com/cart | shopify | store=0 verified=25 reported=14 masked=3 | FLYBYJING15, $30.00 → $25.50 (cart API confirmed) | applied (build 472377364d, run-rerun-a) |
| 2026-10-17 | Four Sigmatic | us.foursigmatic.com/?action=open-cart-drawer | shopify | store=0 verified=28 reported=11 masked=5 | HAMZA30871, $30.00 → $24.00 (cart API confirmed) | applied (build 86113aba63, run-rerun-c) |
| 2026-10-17 | Fresh Clean Threads | freshcleantees.com/cart | shopify | store=1 verified=0 reported=0 masked=0 | TEES25, $60.00 → $45.00 (cart API confirmed) | applied (build pre-hash, runT07-36-10) |
| 2026-10-17 | Good Good Golf | goodgoodgolf.com/cart | shopify | store=0 verified=28 reported=8 masked=2 | PVGG5W8RSZ04, $47.19 → $37.76 (cart API confirmed) | applied (build 86113aba63, run-rerun-c) |
| 2026-10-17 | Grip6 | grip6.com/cart | shopify | store=0 verified=16 reported=24 masked=0 |  | no working code (build 472377364d, run-rerun-b) |
| 2026-10-17 | Groove Life | www.groovelife.com/#cart | shopify | store=0 verified=22 reported=18 masked=0 | REW-6FC5E2AEA176, $34.95 → $33.95 (cart API confirmed) | applied (build 472377364d, run-rerun-a) |
| 2026-10-17 | Heart & Soil | shop.heartandsoil.co/cart | shopify | store=0 verified=5 reported=35 masked=0 | GETSOME10, $311.00 → $279.90 (cart API confirmed) | applied (build f3c5f1c539, run-rerun-e) |
| 2026-10-17 | Huron | usehuron.com/ | shopify | store=0 verified=4 reported=5 masked=6 | HURON20, $96.00 → $76.80 (cart API confirmed) | applied (build 86113aba63, run-rerun-c) |
| 2026-10-17 | IQBAR | www.eatiqbar.com/cart | shopify | store=0 verified=0 reported=0 masked=3 |  | no codes found (build 86113aba63, run-rerun-c) |
| 2026-10-17 | Javvy Coffee | javvycoffee.com/?openCart=true | none | - |  | no coupon box (discount field only at checkout) (build 472377364d, run-rerun-a) |
| 2026-10-17 | Just Ingredients | justingredients.com/cart | shopify | store=0 verified=21 reported=19 masked=0 | PROTEIN20, $64.99 → $52.00 (page read; no cart API) | applied (build pre-hash, runT07-36-10) |
| 2026-10-17 | Kettle & Fire | www.kettleandfire.com/cart | shopify | store=0 verified=0 reported=39 masked=5 | HIGHFALUTIN20, $57.96 → $46.37 (cart API confirmed) | applied (build 86113aba63, run-rerun-c) |
| 2026-10-17 | Kion | www.getkion.com/cart | shopify | store=0 verified=14 reported=22 masked=5 | DREW, $119.95 → $107.96 (cart API confirmed) | applied (build pre-hash, runT07-36-10) |
| 2026-10-17 | Lineage Provisions | lineageprovisions.com/cart | shopify | store=0 verified=14 reported=26 masked=0 | MADS, $49.00 → $41.65 (cart API confirmed) | applied (build f3c5f1c539, run-rerun-e) |
| 2026-10-17 | Luno | lunolife.com/cart | shopify | store=0 verified=3 reported=29 masked=6 |  | no working code (build 86113aba63, run-rerun-c) |
| 2026-10-17 | Magic Spoon | magicspoon.com/cart | shopify | store=0 verified=16 reported=24 masked=0 | MAGICSTART15, $100.00 → $85.00 (cart API confirmed) | applied (build pre-hash, runT07-36-10) |
| 2026-10-17 | MASA | www.masachips.com/cart | shopify | store=0 verified=14 reported=26 masked=0 | FAMILY35, $26.00 → $16.90 (cart API confirmed) | applied (build f3c5f1c539, run-rerun-e) |
| 2026-10-17 | Matador | www.matadorequipment.com/cart | shopify | store=0 verified=29 reported=8 masked=3 |  | no working code (build 86113aba63, run-rerun-c) |
| 2026-10-17 | Melin | melin.com/cart | shopify | store=0 verified=13 reported=0 masked=7 | MELIN10, $89.00 → $80.10 (cart API confirmed) | applied (build 86113aba63, run-rerun-c) |
| 2026-10-17 | Mid-Day Squares | www.middaysquares.com/cart | shopify | store=0 verified=0 reported=0 masked=4 |  | no codes found (build 86113aba63, run-rerun-c) |
| 2026-10-17 | MUD\WTR | mudwtr.com/?cart=open | shopify | store=1 verified=2 reported=38 masked=0 | AMBASSADOR-01, $20.00 → $15.00 (cart API confirmed) | applied (build 472377364d, run-rerun-a) |
| 2026-10-17 | Nomad | nomadgoods.com/?openCart=true | none | - |  | no coupon box (discount field only at checkout) (build 472377364d, run-rerun-b) |
| 2026-10-17 | OLIPOP | drinkolipop.com/collections/drinks | shopify | store=10 verified=0 reported=0 masked=3 |  | no working code (build 86113aba63, run-rerun-c) |
| 2026-10-17 | Paleovalley | paleovalley.com/store | none | - |  | no coupon box (discount field only at checkout) (build 472377364d, run-rerun-a) |
| 2026-10-17 | Peak Design | www.peakdesign.com/?show=cart | none | - |  | no coupon box (discount field only at checkout) (build 472377364d, run-rerun-b) |
| 2026-10-17 | Perfect Keto | shop.perfectketo.com/cart | shopify | store=0 verified=4 reported=32 masked=4 | WALKINGANDCOUNTING, $11.99 → $9.60 (cart API confirmed) | applied (build 472377364d, run-rerun-a) |
| 2026-10-17 | Pura | pura.com/cart | none | - |  | no coupon box (discount field only at checkout) (build 472377364d, run-rerun-b) |
| 2026-10-17 | Quad Lock | www.quadlockcase.com/cart | shopify | store=0 verified=6 reported=34 masked=0 | MANON10, $34.99 → $31.50 (cart API confirmed) | applied (build 86113aba63, run-rerun-c) |
| 2026-10-17 | Ridge | ridge.com | - | - |  | blocked: bot check on the site (build 86113aba63, run-rerun-c) |
| 2026-10-17 | Rumpl | www.rumpl.com/cart | shopify | store=0 verified=5 reported=30 masked=3 |  | no working code (build 472377364d, run-rerun-b) |
| 2026-10-17 | Santa Cruz Paleo | santacruzpaleo.com/cart | shopify | store=0 verified=4 reported=9 masked=0 | DADDY, $14.99 → $12.75 (cart API confirmed) | applied (build 472377364d, run-rerun-a) |
| 2026-10-17 | Tackform | www.tackform.com/cart | shopify | store=0 verified=0 reported=0 masked=3 |  | no codes found (build f3c5f1c539, run-rerun-e) |
| 2026-10-17 | Trayvax | www.trayvax.com/cart | shopify | store=0 verified=6 reported=0 masked=25 | LUCKYSHOPGEO, $39.00 → $35.10 (cart API confirmed) | applied (build 86113aba63, run-rerun-c) |
| 2026-10-17 | True Classic | www.trueclassictees.com/?cart-open=1 | shopify | store=0 verified=0 reported=0 masked=5 |  | no codes found (build 86113aba63, run-rerun-c) |
| 2026-10-17 | Viori | viori.com/ | shopify | store=1 verified=5 reported=34 masked=6 | PRO50, $26.99 → $13.50 (cart API confirmed) | applied (build 472377364d, run-rerun-b) |
| 2026-10-17 | WORN | wornbrand.com/cart | shopify | store=0 verified=0 reported=0 masked=3 |  | no codes found (build f3c5f1c539, run-rerun-e) |
