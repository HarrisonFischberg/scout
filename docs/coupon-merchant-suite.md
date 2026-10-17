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

## Running the live suite

On a Mac with network access and the owner's key in the shell (never in chat
or in a file):

```
npm ci && npm run build
ANTHROPIC_API_KEY=... node scripts/live-suite.mjs            # all merchants, WebKit
node scripts/live-suite.mjs --only "Chomps,Rumpl" --headed   # a few, visibly
node scripts/live-suite.mjs --browser chromium --limit 10
```

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

## Live run log (fill in on a device)

| Date | Merchant | Cart / checkout page | Method (cart API / page) | Codes found (store / verified / reported / masked / dropped) | Best code, saving | Outcome (applied / no working code / no codes found / discovery failed / no coupon box / blocked: captcha, rate limit, unreadable total) |
| --- | --- | --- | --- | --- | --- | --- |
