# Activity

The build log is kept in the owner's private repository, not here.

Ask the owner for it, and record new entries there.

## 2026-11-22: Find coupons always applies the best code (PR #171)

- Actual (owner, iPhone, CARRY the FIRE checkout): WELCOME20 was best of 11 codes ($166.90 to $139.17) but the run said "I couldn't re-apply it", after an earlier code's remove control did nothing.
- Expected: the best code is always on the order at the end, unless none worked.
- Cause: the final apply reused the testing step, which stops when an earlier code will not come off, so the winner was never typed.
- Fix: `putOn` in `src/coupons/finder.ts` (page path): press the stuck code off again, type the winner over what is left, reload the page once as a last resort (not after Stop). "Applied" only when the winner's line or its tested total shows. Review findings fixed: a second remove press only while the code's line still shows, so the shopper's own coupon is never pressed off.
- Evidence: `tests/unit/coupon-pages.test.ts` "always applies the best code at the end" (6 tests); `npm test` 876 pass, typecheck and lint pass. Not yet checked on the device.
