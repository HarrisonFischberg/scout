# Activity

The build log is kept in the owner's private repository, not here.

Ask the owner for it, and record new entries there.

## 2026-11-22: Find coupons always applies the best code (PR #171)

- Actual (owner, iPhone, CARRY the FIRE checkout): WELCOME20 was best of 11 codes ($166.90 to $139.17) but the run said "I couldn't re-apply it", after an earlier code's remove control did nothing.
- Expected: the best code is always on the order at the end, unless none worked.
- Cause: the final apply reused the testing step, which stops when an earlier code will not come off, so the winner was never typed.
- Fix: `putOn` in `src/coupons/finder.ts` (page path): press the stuck code off again, type the winner over what is left, reload the page once as a last resort (not after Stop). "Applied" only when the winner's line or its tested total shows. Review findings fixed: a second remove press only while the code's line still shows, so the shopper's own coupon is never pressed off.
- Evidence: `tests/unit/coupon-pages.test.ts` "always applies the best code at the end" (6 tests); `npm test` 876 pass, typecheck and lint pass. Not yet checked on the device.

## 2026-11-22: Find coupons reports the store's own discount line

- Actual (owner, iPhone, CARRY the FIRE, 1.3): "$173.96 to $149.50 (you save $24.46, 14% off)" while the store's discount line read "− $34.79" (20%, WELCOME20).
- Expected: the saving and percent match the store's discount.
- Cause: the saving was only ever the drop in the page's total; here the total fell $10.33 less than the discount (the store changed another charge with the code, most likely shipping; not confirmed on the device).
- Fix: `readDiscount` (src/coupons/money.ts) reads the discount line that names the code; attempts carry it; when it differs from the drop in the total, the summary and the "Found code" note give the store's figure and say the total moved by another amount. The winner is still chosen by the lowest total.
- Evidence: tests in `tests/unit/coupon-pages.test.ts`; `npm test` 878 pass, typecheck and lint pass. Not yet checked on the device.
