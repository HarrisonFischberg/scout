// Phone-sized touch screens (owner design 2026-10-17). The panel used to
// frost the page above its sheet on iPhone; owner decision 2026-10-18 removed
// it, because Safari tells a panel that was never tapped that it has closed
// only about half a second after its sheet has gone, so the blur outlived the
// sheet. The coupon search overlay still uses its lighter phone wash.

/** A phone-sized touch screen: not a Mac, not an iPad. */
export function isPhoneScreen(coarsePointer: boolean, screenWidth: number): boolean {
  return coarsePointer && screenWidth < 600;
}
