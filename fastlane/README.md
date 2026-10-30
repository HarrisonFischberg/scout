# fastlane (App Store)

Normally run through `./release.sh` (see [release/README.md](../release/README.md) for setup,
env vars and the steps Apple doesn't let us automate). Each lane does a dry run unless you add
`live:true`. Run from the repo root on the Mac.

| Lane | Command | What it does |
| --- | --- | --- |
| iPhone/iPad TestFlight | `fastlane ios beta live:true` | Next 0.N version, timestamp build, archive, upload to TestFlight |
| Mac TestFlight | `fastlane mac beta live:true` | Same for the Mac app |
| iPhone/iPad App Store | `fastlane ios release live:true` | Version 1.0: archive, upload, push listing text, age rating, review notes and screenshots from `store/apple/`, submit for review (manual release after approval) |
| Mac App Store | `fastlane mac release live:true` | Same for the Mac app |

Archiving and upload go through `scripts/archive-testflight.sh`, which also cleans up the
Release copies so Safari keeps using the dev build.
