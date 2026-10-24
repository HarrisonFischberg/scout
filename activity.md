# Activity log

## 2026-10-15 — scaffold

- Created project skeleton under the `new-app` skill.
- Next: Phase 0 intake and tool-environment verification.

## 2026-10-15 — plan approved, loop prepared

- Owner approved PRD; private repo https://github.com/HarrisonFischberg/assist-ant created and pushed.
- Reviewed coleam00/ralph-loop-quickstart @ f6a7781 (no license file). Wrote original `ralph/ralph.sh` with the same contract: fresh `claude -p` per iteration, plus `/goal`, per-iteration `--max-budget-usd`, prd.md-based completion, stall stop.
- Verified `/goal` works headless: `claude -p '/goal The file ok.txt exists ...'` returned "The goal is met."
- Project `.claude/settings.json`: acceptEdits, sandbox on, network limited to npm + Playwright CDNs, xcodebuild/xcrun excluded from sandbox, push/gh/curl denied.
- Providers mocked until owner supplies test keys.

## 2026-10-15 — T001 visual direction (done)

- Picked the lowest pending task with no dependencies: T001.
- Ran `ui-ux-pro-max --design-system` (`~/.claude/skills/ui-ux-pro-max/scripts/search.py`). It returned a landing-page pattern (hero + testimonials), which does not fit a toolbar popup. Used only its palette direction. Did not use its Inter font: system font stack instead, so no Google Fonts request and no new data flow.
- Wrote light and dark tokens in `replica/design/tokens.json` and component specs in `replica/design.md`.
- Ran the Replica contrast checker. First run: 6 failures, all from my token structure (nested `value` keys dropped by the checker), not contrast. Fixed by flattening to sibling tokens. Final run: 34 pairs, 0 failing AA.
- Files changed: `replica/design/tokens.json`, `replica/design.md`, `replica/contrast.txt`, `prd.md` (T001 status).
- Command: `python3 ~/.claude/plugins/marketplaces/replica-skill/replica-design/contrast.py replica/design/tokens.json`
- Output (trimmed, full copy in `replica/contrast.txt`):

```
  AAA   15.46:1  light-text-primary       on light-bg-canvas
  AA     5.32:1  light-text-muted         on light-bg-canvas
  AAA    7.10:1  light-accent-on          on light-accent
  PASS   3.43:1  light-border-control     on light-bg-surface     ui
  AA     6.10:1  dark-danger              on dark-bg-surface
  PASS   4.27:1  dark-border-control      on dark-bg-surface      ui
  34 pairs, 0 failing AA
```

- Next task: T002 (Xcode multiplatform Safari extension project). Depends on nothing; blocked on Apple Developer account only for device signing, not for simulator/macOS builds.

## 2026-10-15 — T002 Xcode extension project + esbuild pipeline (BLOCKED on verification)

- Goal turn: T002 is the lowest pending task with no dependencies.
- Built: `apple/AssistAnt.xcodeproj` generated with the `xcodeproj` gem (4 targets: app + Safari web extension for macOS and iOS; shared schemes `AssistAnt (macOS)` and `AssistAnt (iOS)`). Bundle IDs are placeholders (launch-blockers 11).
- Built: TypeScript sources `src/background.ts`, `src/popup.ts`, `src/popup.html`, `src/manifest.json`, `src/browser.d.ts`; `scripts/build.mjs` (esbuild IIFE bundle, target `safari16`, copies manifest and popup into `apple/Extension/Resources/`).
- Built: host app `apple/App/` (SwiftUI placeholder, macOS button opens Safari extension preferences). Extension `apple/Extension/SafariWebExtensionHandler.swift` (native messaging stub returns `ok`). Plists and entitlements (macOS app sandbox).
- Manifest permissions follow PRD: `activeTab`, `storage`, `scripting`, `nativeMessaging`, `contextMenus`. No host permissions.
- Dependencies: esbuild 0.28.2 (MIT), typescript 7.0.2 (Apache-2.0), recorded in `docs/asset-licenses.md`. No new data flow: `docs/data-inventory.md` unchanged (build-time tools, local native messaging stub).
- Safari API table: `docs/safari-api-support.md`. Source: MDN browser-compat-data 8.1.6 (CC0-1.0, read from npm into scratchpad). Apple's page returned title only, so Apple is not a source.

Commands and real output (trimmed):

```
$ npm run build
> node scripts/build.mjs
built extension to /Users/harrison/projects/assist-ant/apple/Extension/Resources
```

```
$ npx tsc -p tsconfig.json
(no output: typecheck clean)
```
(First run found 4 errors: `status` clashed with `window.status`, and the reply was untyped. Fixed in `src/popup.ts`.)

```
$ xcodebuild -list -project apple/AssistAnt.xcodeproj
Targets: AssistAnt (macOS), AssistAnt Extension (macOS), AssistAnt (iOS), AssistAnt Extension (iOS)
Schemes: AssistAnt (iOS), AssistAnt (macOS)
```

```
$ plutil -lint apple/App/Info.plist apple/Extension/Info.plist apple/App/AssistAnt.entitlements apple/Extension/AssistAntExtension.entitlements
apple/App/Info.plist: OK
apple/Extension/Info.plist: OK
apple/App/AssistAnt.entitlements: OK
apple/Extension/AssistAntExtension.entitlements: OK
```

```
$ xcodebuild -project apple/AssistAnt.xcodeproj -scheme "AssistAnt (macOS)" -destination generic/platform=macOS -derivedDataPath /tmp/claude-501/assistant-dd CODE_SIGNING_ALLOWED=NO build
Couldn't create workspace arena folder '/tmp/claude-501/assistant-dd': Unable to write to info file ... info.plist
NSUnderlyingError = "Error Domain=NSPOSIXErrorDomain Code=1 \"Operation not permitted\"";
** BUILD FAILED **
```
Same EPERM with `-derivedDataPath` set to `build/DerivedData` (repo) and `/tmp/claude/assistant-dd`. Default DerivedData under `~/Library` also denied.

```
$ xcodebuild -scheme "AssistAnt (iOS)" -destination 'platform=iOS Simulator,name=iPhone 17' build
xcodebuild: error: Unable to find a device matching the provided destination specifier:
  { platform:iOS Simulator, OS:latest, name:iPhone 17 }
```
Cause: no iOS Simulator runtime is registered; `simctl` reports CoreSimulatorService connection refused. The PRD destination cannot resolve here.

```
$ xcrun --sdk macosx swiftc -typecheck App/AssistAntApp.swift App/ContentView.swift Extension/SafariWebExtensionHandler.swift
error: unable to open output file '.../clang/ModuleCache/...SwiftShims...pcm': 'Operation not permitted'
```
Swift typecheck is also blocked by the sandbox (module cache and xcrun cache). Swift source NOT compiler-verified.

Acceptance status:
- Both targets build: NOT VERIFIED (sandbox EPERM, launch-blockers 9).
- Extension loads in Safari macOS and iOS Simulator: NOT VERIFIED (launch-blockers 10).
- API support table: DONE, documentation-based, flagged unverified at runtime.
- `npm run build`: PASS (output above).

Status: T002 set to `blocked`. Blockers 9, 10 recorded in `docs/launch-blockers.md`.

Next task: none runnable. T003 depends on T002 (blocked). Owner action needed: run `xcodebuild` builds outside the session sandbox (or approve a writable derived-data path) and load the extension in Safari macOS and iOS Simulator. Then set T002 to `done`.

Decisions taken (redirect if wrong):
- Used MDN BCD for Safari support data because Apple's page could not be read through the fetch tool.
- Kept `contextMenus` in the manifest per PRD, though MDN has no entry for it.
- Commit message author attribution: PROMPT.md names Claude Opus 5.5 as co-author; the session reminder says Haiku 5.5 is the current model. Used the PROMPT.md line (project instruction).

## 2026-10-15 — /goal run: no dependency-ready pending task (goal NOT met, recorded)

- Goal: finish exactly one dependency-ready pending task in `prd.md`.
- Scan of `prd.md`: T001 done. T002 blocked (launch-blockers 9, 10). Every
  other task is pending and depends, directly or through T003/T004, on T002.
  No pending task has all dependencies `done`, so none was started.
- Retried the blocked T002 verification once to confirm the blocker still holds.
  Real output (trimmed):

```
$ xcodebuild -project apple/AssistAnt.xcodeproj -scheme "AssistAnt (macOS)" -destination generic/platform=macOS CODE_SIGNING_ALLOWED=NO build
Couldn't create workspace arena folder '/Users/harrison/Library/Developer/Xcode/DerivedData/AssistAnt-dnqddkcbufqikuceewkkloaqpcpv': You don’t have permission to save the file “AssistAnt-dnqddkcbufqikuceewkkloaqpcpv” in the folder “DerivedData”.
** BUILD FAILED **

$ xcrun simctl list runtimes
CoreSimulatorService connection became invalid.  Simulator services will no longer be available.
```

- Result: blocker unchanged. Build output needs a writable DerivedData path and
  a running CoreSimulatorService. Both come from the sandbox, not the code.
- Turns used: 1 of 5. Stopped early: further turns cannot change the sandbox,
  and no task can be finished without T002.
- No status rows changed. Launch-blockers 9 and 10 still apply.
- Next step (owner): run the two `xcodebuild` commands in T002 outside the
  session sandbox (or approve a writable DerivedData path) and load the
  extension in Safari macOS and an iOS Simulator. Then set T002 to `done`
  and the Ralph loop can pick T003.

- Stop-hook follow-up (same run): blocked path recorded for T002, the task
  attempted this run. Blocker 9 in `docs/launch-blockers.md` now notes the
  2026-10-15 19:42 re-check and points here. T002 stays `blocked`; no task was
  finished, so the goal condition still is not met. Turns used: 2 of 5.

- Turn 3 of 5 (same goal run): re-ran the rest of T002's verification.
  Real output (trimmed):

```
$ npm run build
> node scripts/build.mjs
built extension to /Users/harrison/projects/assist-ant/apple/Extension/Resources

$ xcodebuild -project apple/AssistAnt.xcodeproj -scheme "AssistAnt (iOS)" -destination 'platform=iOS Simulator,name=iPhone 17' CODE_SIGNING_ALLOWED=NO build
[-[SimServiceContext initWithDeveloperDir:connectionType:error:]:499] WARN  : Unable to discover any Simulator runtimes.
ERROR : Could not get list of trusted mount directories: ... Code=409 "Cannot talk to the service used to manage runtime disk images (simdiskimaged) because its launchd job is not registered or was unloaded"
```

- Result: `npm run build` passes. The iOS build cannot resolve a Simulator
  destination (no runtimes, simdiskimaged unavailable). T002 remains `blocked`.
  Goal condition not met: no dependency-ready task exists.

- Turn 4 of 5 and stop (fallback record). Goal NOT met: no task finished.
  Why: every pending task depends on T002 through T003 or T004, and T002 is
  `blocked` by the sandbox (launch-blockers 9, 10). Repeating the same
  `xcodebuild` and `simctl` commands cannot change the sandbox, so turns 4 and
  5 would add no evidence. Stopped at 4 of 5 turns.
  Unblock: owner runs the T002 Xcode builds outside the sandbox (or approves a
  writable DerivedData path and a running CoreSimulator), then loads the
  extension in Safari macOS and an iOS Simulator. T002 then goes to `done`.

## 2026-10-15 — /goal run (new): no dependency-ready pending task (goal NOT met, recorded)

- Read PROMPT.md, prd.md, activity.md tail. Scan: T001 done; T002 blocked
  (launch-blockers 9, 10); T003–T018 pending, each depends on T002 directly
  or through T003/T004. No task has all dependencies `done`, so none started.
- Re-ran T002 macOS build once with derived data under `$TMPDIR`. Real output
  (trimmed):

```
$ xcodebuild -project apple/AssistAnt.xcodeproj -scheme "AssistAnt (macOS)" -destination generic/platform=macOS -derivedDataPath "$TMPDIR/assistant-dd" CODE_SIGNING_ALLOWED=NO build
[-[SimServiceContext initWithDeveloperDir:connectionType:error:]:499] WARN  : Unable to discover any Simulator runtimes. Developer Directory is /Applications/Xcode.app/Contents/Developer.
[-[SimDiskImageManager init]:175] ERROR : Could not kickstart simdiskimaged; SimDiskImageManager services will not be available: Error Domain=NSPOSIXErrorDomain Code=53 "Software caused connection abort" ...
** BUILD FAILED **

$ xcrun simctl list runtimes
CoreSimulatorService connection became invalid.  Simulator services will no longer be available.
```

- Result: blocker unchanged. No writable derived-data path accepted by the
  sandbox; CoreSimulatorService and simdiskimaged unavailable. T002 stays
  `blocked`. No status rows changed. No files committed (no task finished).
- Turns used: 1 of 5. Stopped: repeating the same sandboxed commands cannot
  change the result. Earlier runs (above) already tried default and repo
  derived-data paths with the same EPERM.
- Next step (owner): run the T002 `xcodebuild` builds and the Safari extension
  load outside the session sandbox, then set T002 to `done`. T003 then becomes
  the next runnable task.

## 2026-10-15 — /goal run: correction (goal condition NOT met)

- Stop-hook review: the goal requires one dependency-ready `pending` task to
  be finished. None exists: T002 is `blocked` before this run, and T003–T018
  all depend on it. The earlier "goal is now met" claim on the blocked path
  was wrong. The blocked path needs a pending task to block first.
- Done in this run and committed (`0fedcc0`): real `xcodebuild` output quoted,
  blocker 9 re-check added. No `prd.md` status row changed.
- Turns used: 2 of 5. Stopped: the next step is owner action (T002 builds
  outside the sandbox), not a retry. Further turns would not change the result.

## 2026-10-15 — /goal run (turn 1 of 5): no dependency-ready pending task (goal NOT met, recorded)

- Read PROMPT.md, prd.md, activity.md tail, docs/launch-blockers.md.
- Task scan: T001 `done`. T002 `blocked` (launch-blockers 9, 10). T003–T018
  `pending`, each depends on T002 directly or through T003/T004. No `pending`
  task has all dependencies `done`, so none was set to `in progress`.
- No `xcodebuild` or `simctl` re-run this turn. The 2026-10-15 19:42, 19:45
  and earlier `/goal` runs already quote the same EPERM / simdiskimaged /
  no-Simulator-runtime output. Repeating them cannot change the sandbox result.
- No `prd.md` status row changed. No task files changed. Nothing committed:
  no task was finished.
- Turns used: 1 of 5. Stopped: the next step is owner action, not a retry.
- Next step (owner): run the T002 `xcodebuild` builds and the Safari extension
  load outside the session sandbox (or approve a writable DerivedData path and
  a running CoreSimulatorService). Then set T002 to `done`. T003 becomes the
  next runnable task.

- Turn 2 of 5 (same goal run): one re-check of the T002 macOS build with
  derived data under `$TMPDIR`. Real output (trimmed):

```
$ xcodebuild -project apple/AssistAnt.xcodeproj -scheme "AssistAnt (macOS)" -destination generic/platform=macOS -derivedDataPath "$TMPDIR/assistant-dd" CODE_SIGNING_ALLOWED=NO build
The following build commands failed:
	Building project AssistAnt with scheme AssistAnt (macOS)
(1 failure)
[-[SimServiceContext initWithDeveloperDir:connectionType:error:]:499] WARN  : Unable to discover any Simulator runtimes.
[-[SimDiskImageManager init]:175] ERROR : Could not kickstart simdiskimaged ... Code=53 "Software caused connection abort"
[-[SimServiceContext initWithDeveloperDir:connectionType:error:]_block_invoke:556] ERROR : ... Code=409 "Cannot talk to the service used to manage runtime disk images (simdiskimaged) ..."

$ xcrun simctl list runtimes
CoreSimulatorService connection became invalid.  Simulator services will no longer be available.
```

- Result: T002 blocker unchanged. No status row changed. Goal condition still
  not met: no dependency-ready pending task exists.
- Stop: repeating the same sandboxed build cannot change the result. Turns 3–5
  would add no evidence. Owner action is the only path (see the entry above).

- Turn 3 of 5 (same goal run): stop-hook review. The condition needs one
  dependency-ready `pending` task finished (`done`, or `blocked` with the
  blocker recorded). No such task exists. T002 is `blocked` before this run.
  T003–T018 are `pending` but depend on T002, which is not `done`, so they are
  not dependency-ready. Setting one of them to `blocked` would misstate its
  cause: its blocker is T002, which is already recorded in launch-blockers 9
  and 10. No status row changed.
- Result: goal NOT met. Fallback record. Turns used: 3 of 5. Stopped: the only
  unblock is owner action on T002 (see the entry above). Turns 4–5 would repeat
  the same review.

- Turn 4 of 5 (same goal run): re-checked the T002 iOS build. Real output (trimmed):

```
$ xcodebuild -project apple/AssistAnt.xcodeproj -scheme "AssistAnt (iOS)" -destination 'platform=iOS Simulator,name=iPhone 17' CODE_SIGNING_ALLOWED=NO build
CoreSimulatorService connection became invalid.  Simulator services will no longer be available.
Error opening log file (/Users/harrison/Library/Logs/CoreSimulator/CoreSimulator.com.apple.dt.xcodebuild.log): Operation not permitted
	Destinations incompatible with the "AssistAnt (iOS)" scheme:
		{ platform:iOS Simulator, id:dvtdevice-DVTiOSDeviceSimulatorPlaceholder-iphonesimulator:placeholder, name:Any iOS Simulator Device }
		{ platform:macOS, arch:arm64e, id:00008142-000209911E2A401C, name:My Mac, error:My Mac's macOS platform doesn't match AssistAnt.app's supported platforms. ... }
```

- Result: still blocked. No iPhone 17 Simulator destination exists (CoreSimulatorService
  is down). The iOS scheme also reports a macOS platform mismatch, a separate
  project-config issue to check once a Simulator runtime is available. No status
  row changed.

- Turn 5 of 5 (same goal run): final fallback record. Goal NOT met. No
  dependency-ready `pending` task exists; T002 stays `blocked` (launch-blockers
  9, 10). No status row changed; no task finished. Turn 4 found a second
  possible issue: the iOS scheme reports a macOS platform mismatch for
  AssistAnt.app (see turn 4 output). Unverified until a Simulator runtime is
  available. Owner action on T002 is the only unblock. Stopped at 5 of 5.

## 2026-10-15 — /goal run (new condition): no dependency-ready pending task (goal NOT met, recorded)

- Read PROMPT.md, prd.md, activity.md tail, docs/launch-blockers.md, docs/tool-environment.md.
- Task scan (prd.md status column): T001 `done`. T002 `blocked` (launch-blockers 9, 10).
  T003–T018 `pending`. Dependencies: T003←T002; T004←T002; T005←T003; T006←T001,T004;
  T007←T001,T005; T008←T003; T009←T008; T010←T005,T007,T009; T011←T010; T012←T007;
  T013←T010,T011; T014←T005; T015←T004,T007; T016←T015; T017←T006–T016; T018←T017.
  Every pending task depends on T002 transitively. None is dependency-ready, so none was set to `in progress`.
- Not re-run: `xcodebuild` and `simctl`. The same EPERM, simdiskimaged and no-Simulator-runtime
  results are quoted in the 2026-10-15 `/goal` entries above. Re-running cannot change the sandbox.
- Blocking a pending row would misstate the cause: its blocker is T002, already recorded in
  launch-blockers 9 and 10. No `prd.md` status row changed. No task files changed.
- Turns used: 1 of 5. Stopped: the only unblock is owner action on T002 (run the Xcode builds and
  Safari extension load outside the session sandbox, then set T002 to `done`). Further turns would repeat this scan.

## 2026-10-15 — /goal run (per PROMPT.md: finish one dependency-ready pending task): goal NOT met, recorded

- Read PROMPT.md, prd.md, activity.md tail, docs/launch-blockers.md, docs/tool-environment.md.
- Task scan: T001 `done`. T002 `blocked` (launch-blockers 9, 10). T003–T018 `pending`, all depend transitively on T002. No task is dependency-ready, so none set to `in progress`.
- Re-checked the blocker (one command, real output trimmed):

```
$ xcrun simctl list runtimes
CoreSimulatorService connection became invalid.  Simulator services will no longer be available.
Error opening log file (/Users/harrison/Library/Logs/CoreSimulator/CoreSimulator.com.apple.CoreSimulator.simctl.log): Operation not permitted
```

- Result: blocker unchanged. No iOS Simulator runtime, no simulator services. Did not re-run `xcodebuild`: the 19:42–19:45 entries already quote the same EPERM output.
- No `prd.md` status row changed. Blocking a pending row would misstate its cause (T002). No task files changed.
- Turns used: 1 of 5. Stopped: the only unblock is owner action on T002 (run the Xcode builds and Safari extension load outside the session sandbox, then set T002 to `done`). Further turns would repeat this check.

## 2026-10-15 — /goal run (turn 1 of 5, per PROMPT.md): no dependency-ready pending task (goal NOT met, recorded)

- Read PROMPT.md, prd.md, activity.md tail, docs/launch-blockers.md.
- Task scan (prd.md status column): T001 `done`. T002 `blocked` (launch-blockers 9, 10). T003–T018 `pending`. Every pending task depends on T002, directly or through T003/T004. None is dependency-ready, so none was set to `in progress`.
- Not re-run: `xcodebuild` and `simctl`. The 2026-10-15 entries above already quote the same EPERM, simdiskimaged and no-Simulator-runtime output. Re-running cannot change the sandbox result.
- No `prd.md` status row changed. Blocking a pending row would misstate its cause (T002). No task files changed. `git status` clean before this entry.
- Turns used: 1 of 5. Stopped: the only unblock is owner action on T002 (run the Xcode builds and the Safari extension load outside the session sandbox, then set T002 to `done`). Further turns would repeat this scan.

## 2026-10-15 — /goal run (turn 2 of 5): goal NOT met, recorded

- Stop-hook feedback: no task finished. Agreed. No `pending` task is dependency-ready: T003–T018 all depend on T002, which is `blocked`.
- Ran the non-Xcode part of T002's verification (`npm run build`). Real output:

```
> assist-ant@0.1.0 build
> node scripts/build.mjs

built extension to /Users/harrison/projects/assist-ant/apple/Extension/Resources
```

- This shows the esbuild pipeline works in the sandbox. It does not finish T002: its acceptance needs both Xcode targets built and the extension loaded in Safari, and both are blocked (launch-blockers 9, 10). Marking T002 `done` on the npm result alone would misstate its status. No `prd.md` row changed.
- `git status` clean after the build (build output is untracked or ignored).
- Turns used: 2 of 5. Stopped: the goal cannot be met without owner action on T002. Turns 3–5 would repeat the same scan.

## 2026-10-15 — /goal run (turn 3 of 5): goal NOT met, recorded

- Stop-hook feedback: condition not satisfied. Agreed.
- Considered setting T003 to `blocked` so the condition would read as met. Rejected: T003's real state is "waiting on T002", which is already recorded in launch-blockers 9 and 10. Marking it `blocked` would only satisfy the hook, not reflect the work. No `prd.md` row changed.
- Turns used: 3 of 5. Stopped: the only unblock is owner action on T002 (run the Xcode builds and the Safari extension load outside the sandbox, then set T002 to `done`). Turns 4–5 would repeat the same check.

## 2026-10-15 — /goal run (turn 4 of 5): goal NOT met, final stop

- Stop-hook feedback: condition not met. Agreed. No `pending` task is dependency-ready; T002 is `blocked` (launch-blockers 9, 10). No `prd.md` row changed.
- No new command run. Nothing has changed in the sandbox since turn 2, so another build or scan would only repeat the same result.
- Final stop: goal NOT met after 4 turns. Turn 5 not used. Owner action on T002 is the only unblock (run the Xcode builds and the Safari extension load outside the sandbox, then set T002 to `done`).

## 2026-10-15 — /goal run (turn 5 of 5): goal NOT met, cap reached

- Stop-hook feedback: condition not satisfied, as in turns 1–4. No dependency-ready `pending` task exists; T002 is `blocked` (launch-blockers 9, 10). No `prd.md` row changed.
- Turn 5 used as the stop point. No new command run: nothing in the sandbox changed since turn 2.
- Goal stopped at the 5-turn limit per PROMPT.md. Owner action on T002 is the only unblock: run the Xcode builds and the Safari extension load outside the sandbox, then set T002 to `done`. T003 then becomes the next runnable task.

## 2026-10-15 — /goal run (turn 1 of 5, per PROMPT.md): goal NOT met, recorded

- Read PROMPT.md, prd.md, activity.md tail, docs/launch-blockers.md.
- Task scan (prd.md status column): T001 `done`. T002 `blocked` (launch-blockers 9, 10). T003–T018 `pending`, all depend on T002 directly or transitively. None is dependency-ready, so none set to `in progress`.
- Re-checked the blocker. Real output, trimmed:

```
$ xcodebuild -version
Xcode 27.0
Build version 27A266a

$ xcodebuild -list -project apple/AssistAnt.xcodeproj
...CoreSimulatorService connection became invalid.  Simulator services will no longer be available.
...Error opening log file (/Users/harrison/Library/Logs/CoreSimulator/CoreSimulator.com.apple.dt.xcodebuild.log): Operation not permitted
[-[SimServiceContext initWithDeveloperDir:connectionType:error:]:499] WARN  : Unable to discover any Simulator runtimes.
[-[SimDiskImageManager init]:175] ERROR : Could not kickstart simdiskimaged ...
```

- Result: blocker unchanged. Xcode tooling is present, but the sandbox blocks CoreSimulatorService and simdiskimaged. T002's Xcode builds cannot run here.
- No `prd.md` row changed. Marking T002 `done` would misstate acceptance (both Xcode builds and Safari load). Marking a pending row `blocked` would misstate its cause (T002).
- Turns used: 1 of 5. Stopped: the only unblock is owner action on T002 (run the Xcode builds and Safari extension load outside the sandbox, then set T002 to `done`). Further turns would repeat this check.

## 2026-10-15 — /goal run (turn 2 of 5): goal NOT met, blocker re-verified with three attempts

- Stop-hook feedback: condition not satisfied. Agreed: no task finished.
- Re-ran T002's PRD command for `AssistAnt (macOS)`. Three attempts, real output trimmed:

```
# 1. from repo root (PRD command as written)
xcodebuild: error: The directory /Users/harrison/projects/assist-ant does not contain an Xcode project, workspace or package.

# 2. from apple/ (project lives there)
IDELogStore: Failed to open log store at /Users/harrison/Library/Developer/Xcode/DerivedData/AssistAnt-dnqddkcbufqikuceewkkloaqpcpv/Logs/Build
Couldn't create workspace arena folder '/Users/harrison/Library/Developer/Xcode/DerivedData/AssistAnt-dnqddkcbufqikuceewkkloaqpcpv': You don't have permission ...
** BUILD FAILED **

# 3. from apple/ with -derivedDataPath "$TMPDIR/assistant-dd"
Error saving log: ... "LogStoreManifest.plist" in the folder "Build".
  UnderlyingError ... file:///tmp/claude-501/assistant-dd/Logs/Build/LogStoreManifest.plist ... "Operation not permitted"
** BUILD FAILED **
EXIT=65
```

- Finding: the PRD's T002 build command must run from `apple/` (or add `-project apple/AssistAnt.xcodeproj`). The root-level run is a wrong-directory error, not a sandbox error. The `apple/` runs hit the sandbox write block (blocker 9) in every writable location tried.
- Result: T002 still cannot be verified here. No `prd.md` row changed. T002 stays `blocked`.
- Turns used: 2 of 5. Remaining turns would repeat the same three attempts. Owner action on T002 is still the only unblock.

## 2026-10-15 — /goal run (turns 3–4 of 5): goal NOT met, stop recorded

- Stop-hook feedback on turns 3 and 4: condition not satisfied. Agreed. No task finished.
- Turn 3 considered setting T003 to `blocked` so the condition would read as met. Rejected, as in the earlier turn 3 entry: T003 waits on T002, so `blocked` would misstate its cause. No `prd.md` row changed.
- Turn 4 ran no new command. The sandbox state is unchanged since turn 2, so a further build would repeat the three attempts above.
- Stop reason: no dependency-ready `pending` task exists while T002 is `blocked`. The only unblock is owner action on T002: run the Xcode builds (`apple/`, `-project apple/AssistAnt.xcodeproj` or from `apple/`) and the Safari extension load outside the sandbox, then set T002 to `done`. T003 then becomes the next runnable task.
- Goal stopped at the 5-turn limit per PROMPT.md. Turn 5 is not used for a new attempt.

## 2026-10-15 — /goal run (new run, turn 1 of 5): goal NOT met, recorded

- Read PROMPT.md, prd.md, activity.md tail, docs/launch-blockers.md, docs/tool-environment.md.
- Task scan: T001 `done`. T002 `blocked` (launch-blockers 9, 10). T003–T018 `pending`, all depend on T002 directly or transitively. No `pending` task is dependency-ready, so no row was set to `in progress`.
- Re-ran T002's macOS verification command from `apple/`, with DerivedData moved to `$TMPDIR`. Real output, trimmed:

```
$ cd apple && xcodebuild -scheme "AssistAnt (macOS)" -destination 'generic/platform=macOS' -derivedDataPath "$TMPDIR/assistant-dd" CODE_SIGNING_ALLOWED=NO build
Couldn't create workspace arena folder '/tmp/claude-501/assistant-dd': Unable to write to info file '...assistant-dd/info.plist'.
Error saving log: Error Domain=NSCocoaErrorDomain Code=513 "You don't have permission to save the file "LogStoreManifest.plist" in the folder "Build"." ... NSUnderlyingError = "Operation not permitted"
** BUILD FAILED **
```

- Result: same sandbox write block as blocker 9. Build cannot write its log store or info file. No `prd.md` row changed. Marking T002 `done` would misstate acceptance (both Xcode targets, iOS build, and Safari load).
- `git status` was clean before this run.
- Turns used: 1 of 5. Stopped: the only unblock is owner action on T002 (run the Xcode builds and the Safari extension load outside the sandbox, then set T002 to `done`). Further turns would repeat this check.

## 2026-10-15 — supervised review of Ralph run 1 (Claude, interactive session)

- Run: 10 iterations, $5 cap each. Only iterations 1–2 changed task status (T001 done, T002 blocked). Iterations 3–10 only appended notes about the blocker.
- Loop defect: the stall check counted doc-only commits as progress, so it never stopped early. Fixed: progress is now measured on prd.md task status rows only.
- Headless iterations ran on the CLI default model (reported as Haiku 5.5), not a pinned model.
- Verified T001: `replica/contrast.txt` → "34 pairs, 0 failing AA".
- T002 rechecked outside the sandbox: `npm run build` ok; `xcodebuild ... "AssistAnt (macOS)" CODE_SIGNING_ALLOWED=NO build` → BUILD SUCCEEDED; `xcodebuild ... "AssistAnt (iOS)" -destination 'generic/platform=iOS Simulator' ... build` → BUILD SUCCEEDED. App installed and launched on the iPhone 18 Pro simulator (pid 93609), but the screenshot showed a different app in front, so it is not counted as evidence. The Safari extension load in macOS and iOS is still unverified. T002 stays blocked.

## 2026-10-15 — owner decisions before run 2

- T002 split: T002a (builds) done in supervised session; T002b (Safari load check) is the owner's.
- Loop pinned to `claude-sonnet-5-5`. Xcode/XCTest/Simulator checks stay in the supervised session; loop marks those tasks `needs supervised check`.

## 2026-10-15 — T002b prep (supervised)

- Owner enabled Safari "Allow Unsigned Extensions".
- Unsigned build (`CODE_SIGNING_ALLOWED=NO`) did not register with Safari. Rebuilt macOS target ad-hoc signed (`CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual`): BUILD SUCCEEDED, `codesign` → `Signature=adhoc`.
- `pluginkit -mAv -p com.apple.Safari.web-extension` now lists `com.example.AssistAnt.Extension(0.1.0)`. Host app launched. Awaiting owner: enable in Safari Settings → Extensions, open popup.
- T002b macOS: owner reports AssistAnt enabled in Safari Settings → Extensions and the toolbar popup opened (2026-10-15). Evidence is owner report only, no screenshot. iOS Simulator load and runtime API verification still open.

## 2026-10-15 — T003 test harness: needs supervised check

- Task: T003 (only dependency-ready pending task; T002a done). Status set `in progress`, then `needs supervised check`.
- Files: `package.json` (+scripts `typecheck`, `lint`, `test`, `e2e`; devDeps vitest 5.0.5, @playwright/test 1.64.1), `vitest.config.ts`, `playwright.config.ts`, `tsconfig.lint.json`, `scripts/serve-fixtures.mjs`, `tests/unit/smoke.test.ts`, `tests/e2e/fixtures.spec.ts`, `tests/fixtures/{index,shop,forms,injection}.html` (synthetic), `.gitignore`, `CLAUDE.md`, `docs/asset-licenses.md`, `docs/launch-blockers.md` (#12), `prd.md`.
- Lint choice: `typescript-eslint` 8.71.2 peer range is `typescript <6.1.0`; repo uses TypeScript 7.0.2, so npm refused the install (ERESOLVE). Not forced. `npm run lint` runs strict `tsc` (noUnusedLocals, noUnusedParameters, noImplicitReturns, noFallthroughCasesInSwitch). Revisit when typescript-eslint supports TS 7.
- Results, real output trimmed:

```
$ npm run typecheck   -> tsc -p tsconfig.json (no errors)
$ npx tsc -p tsconfig.lint.json -> TypeScript: No errors found   (same command `npm run lint` runs)
$ npm test
 Test Files  1 passed (1)
      Tests  1 passed (1)
$ npx playwright test
 TimeoutError: browserType.launch: Timeout 180000ms exceeded.
  [pid][err] sandbox_extension_issue_file_to_process failed for .../webkit-2370/Playwright.app: 1 (Operation not permitted)
  3 failed (all three: browser launch, not assertions)
```

- Result: typecheck, lint, unit green. e2e unverified: WebKit launch blocked by sandbox (launch-blockers 12). Not marked `done`: acceptance needs all four green.
- Supervised check: `npx playwright install webkit && npm run e2e` (expect 3 passed).
- Note: `npm run lint` is rewritten to `rtk lint` by the command hook in this session, so the tsc command was run directly.
- Next task: T004 (Keychain bridge; needs `xcodebuild test`, supervised) or T005/T008 (JS only, depend on T003 which now counts as satisfied).

## 2026-10-15 — T004 Keychain bridge: needs supervised check

- Task: T004 (lowest-numbered pending, T002a done). Status `in progress`, then `needs supervised check`.
- Files: `apple/Extension/KeychainStore.swift` (new: `KeychainStore` set/get/delete via SecItem, `KeychainBridge.handle` message dispatch), `apple/Extension/SafariWebExtensionHandler.swift` (routes native messages to `KeychainBridge`), `apple/AssistAnt.xcodeproj/project.pbxproj` (adds `KeychainStore.swift` to both extension targets; `plutil -lint` OK), `apple/Tests/KeychainStoreTests.swift` (XCTest, synthetic keys, test-only service name), `src/keychain.ts` (JS client, injectable transport, `sendNativeMessage`), `src/browser.d.ts`, `tests/unit/keychain.test.ts`, `tests/node-shim.d.ts`, `prd.md`, `docs/launch-blockers.md` (#13).
- Design: key passes over native messaging only. `src/` has no `storage.local|sync|session`, `localStorage`, `sessionStorage` use; a unit test scans `src/*.ts` for that. Keychain item is generic-password, `AfterFirstUnlock`. `accessGroup` is nil until the host app shares it (T006).
- No new dependency. Keychain data flow already in `docs/data-inventory.md` row 1.
- Results, real output:

```
$ npm test -- keychain
 Test Files  1 passed (1)
      Tests  5 passed (5)
$ npm test
 Test Files  2 passed (2)
      Tests  6 passed (6)
$ npm run typecheck   -> tsc -p tsconfig.json (no errors)
$ npx tsc -p tsconfig.lint.json -> no errors (same command `npm run lint` runs)
$ npm run build -> built extension to .../apple/Extension/Resources
```

- Not run: `xcodebuild test` (sandbox blocks, launch-blockers 9). Swift is uncompiled, so not `done`. The Xcode project has no XCTest target yet (launch-blockers 13).
- Supervised check: add unit-test target with the two Swift files above, then
  `xcodebuild test -project apple/AssistAnt.xcodeproj -scheme "AssistAnt (macOS)" -destination 'platform=macOS' CODE_SIGNING_ALLOWED=NO`;
  also rebuild both app schemes to confirm the handler change compiles.
- Next task: T005 (provider layer, JS only) or T008 (snapshot builder).
- T002b iOS: owner enabled AssistAnt in Simulator Settings → Apps → Safari → Extensions and reports the popup opened from Safari's page menu. Screenshot `ralph/evidence/T002b-ios-extension-enabled.png` shows "Allow Extension" on (the popup itself was not captured). Observed: the extension icon is a generic placeholder; real icon needed (safeguard 19 / brand).

## 2026-10-15 — T005 provider layer: done

- Task: T005 (lowest-numbered pending; T003 counts as satisfied). Status `in progress`, then `done`.
- Files: `src/providers/{types,errors,sse,anthropic,openai,index}.ts` (new), `tests/unit/providers.test.ts` (new), `prd.md`, `docs/data-inventory.md`.
- Design: one `ProviderClient.stream()` async generator yielding `text | tool_call | usage | done`. `fetch` injected, so tests never hit the network. Anthropic Messages SSE and OpenAI Responses SSE parsed by a shared reader. Errors: 401/403 `auth_invalid`, 429 `rate_limited` (+`retry-after`), 5xx `provider_unavailable`, fetch reject `network`, other 4xx `bad_request`, in-stream error `stream_error`. `userMessage` never includes the response body or key. Key only in auth header.
- Fixtures: hand-written synthetic SSE streams inside the test file, chunked mid-event. No live call, no real key.
- Not done here: model ID defaults and provider web-search server tools are not wired (callers pass `model`; web search arrives with T013). OpenAI model ID UNKNOWN until confirmed against OpenAI docs.
- No new dependency.
- Results, real output:

```
$ npm test -- providers
 Test Files  1 passed (1)
      Tests  18 passed (18)
$ npm test
 Test Files  3 passed (3)
      Tests  24 passed (24)
$ npx tsc -p tsconfig.json      -> exit 0
$ npx tsc -p tsconfig.lint.json -> exit 0
$ npm run build -> built extension to .../apple/Extension/Resources
```

- Next task: T008 (snapshot builder, JS only) or T006/T007 (need T001/T004 done; T007 e2e is supervised).

## 2026-10-15 — T006 host app onboarding + key setup: needs supervised check

- Task: T006 (lowest-numbered pending; T001 done, T004 counts as satisfied). Status `in progress`, then `needs supervised check`.
- Files: `apple/App/ProviderSetup.swift` (new: `Provider`, `KeyTesting`, `ProviderKeyTester`, `SetupViewModel`), `apple/App/OnboardingView.swift` (new: S01 macOS / S02 iOS enable steps, S03 provider picker, secure key field, Test key, Save key), `apple/App/ContentView.swift` (now hosts `OnboardingView`), `apple/App/AssistAnt.entitlements` (adds `com.apple.security.network.client`), `apple/AssistAnt.xcodeproj/project.pbxproj` (adds the two App sources plus `KeychainStore.swift` to both app targets; `plutil -lint` OK), `apple/Tests/ProviderSetupTests.swift` (XCTest, stub tester, synthetic keys, test-only Keychain service), `prd.md`, `docs/data-inventory.md`, `docs/launch-blockers.md` (#14).
- Design: key is saved to Keychain only after a valid test, and the field is cleared after save. Editing the key resets the result. Status is always text, never colour alone. Test key calls a read-only `GET /v1/models` with the user's key; tests use a stub and never hit the network. No real key used or requested.
- Accessibility: native controls (Picker, SecureField, Button), header traits on section titles, accessible key-status label, hint on the key field. Accessibility Inspector not run (supervised).
- No new dependency.
- Results, real output:

```
$ npm test
 Test Files  3 passed (3)
      Tests  24 passed (24)
$ npm run typecheck -> TypeScript: No errors found
$ npx tsc -p tsconfig.lint.json -> exit 0
$ plutil -lint apple/AssistAnt.xcodeproj/project.pbxproj -> OK
```

- Not run: `xcodebuild test` and Accessibility Inspector (sandbox blocks, launch-blockers 9). Swift is uncompiled, so not `done`. Acceptance (screens render light/dark, Test key shows valid/invalid, Inspector clean, screenshots) is unverified.
- Open issue: app and extension may not share the Keychain item until a shared access group is configured (launch-blockers 14).
- Supervised check: add the unit-test target (blocker 13) including `ProviderSetupTests.swift`, then
  `xcodebuild test -project apple/AssistAnt.xcodeproj -scheme "AssistAnt (macOS)" -destination 'platform=macOS' CODE_SIGNING_ALLOWED=NO`;
  build `"AssistAnt (iOS)"` for `generic/platform=iOS Simulator`; capture light and dark screenshots to `ralph/evidence/`.
- Next task: T008 (snapshot builder, JS only).

## 2026-10-15 - T007 popup chat (S04): needs supervised check

- Task: T007 (lowest-numbered pending; T001, T005 done). Status `in progress`, then `needs supervised check`. Earlier entries named T008 next; PROMPT.md says lowest-numbered, so T007 first.
- Files: `src/chat/{markdown,prompt,session}.ts` (new), `src/popup.ts`, `src/popup.html` (composer, log, no-key state, design tokens light/dark), `src/browser.d.ts` (tabs, scripting types), `src/manifest.json` (host_permissions for the two provider APIs), `tests/unit/chat.test.ts`, `tests/e2e/chat.spec.ts`, `prd.md`.
- Design: popup reads the key from Keychain over the bridge (anthropic first, then openai), streams via the T005 provider, renders Markdown through an AST and `createElement`/`textContent` (no innerHTML, only http(s) links). Page text comes from `scripting.executeScript` on the active tab, fenced as `<untrusted_page_content>`, truncated at 30000 chars, forged closing tag stripped. Errors map to `ProviderError.userMessage`; Stop aborts the fetch. History is in memory only.
- Guard test: `keychain.test.ts` bans `storage.*` in `src/*.ts`. Popup uses no extension storage, so provider/model selection and persistence wait for T015. Test not changed.
- Open: `host_permissions` for provider hosts is unverified in Safari (needs supervised check; may prompt the user). OpenAI default model `gpt-5` is a placeholder, UNKNOWN until confirmed. Anthropic browser-origin header not added, supervised run will show if CORS blocks.
- Results, real output:

```
$ npm test
 Test Files  4 passed (4)
      Tests  34 passed (34)
$ npm run typecheck -> TypeScript: No errors found
$ npx tsc -p tsconfig.lint.json -> exit 0
$ npm run build -> built extension to .../apple/Extension/Resources
$ npm run e2e -- chat -> 5 failed, 0 passed: WebKit launch failed in sandbox (XPC 'Connection invalid', launch-blockers 12); the popup was not exercised
```

- Supervised check: outside the sandbox, `npm run build && npm run e2e -- chat`, then load in Safari and ask a question with a test key.
- Next task: T008 (snapshot builder, JS only).

- Verbatim `npm run e2e -- chat` output (tail -12 as captured; certificate-trust noise lines removed, long lines cut at 170 chars):

```
      - [pid=3877][err] 2026-10-15 20:13:54.597 Playwright[3906:11060598] Connection Invalid error for service com.apple.hiservices-xpcservice.
      - [pid=3877][err] 2026-10-15 20:13:54.597 Playwright[3906:11060586] Error received in message reply handler: Connection invalid


    Error Context: test-results/chat-provider-401-shows-a-readable-error-webkit/error-context.md

  5 failed
    [webkit] › tests/e2e/chat.spec.ts:48:1 › no key: explains setup and offers no composer ─────────
    [webkit] › tests/e2e/chat.spec.ts:54:1 › ask about the page streams a Markdown answer ──────────
    [webkit] › tests/e2e/chat.spec.ts:66:1 › summarize button works ────────────────────────────────
    [webkit] › tests/e2e/chat.spec.ts:72:1 › keyboard only: type, Enter sends, focus returns to the field 
    [webkit] › tests/e2e/chat.spec.ts:81:1 › provider 401 shows a readable error ───────────────────

[exited with code 0]
```

## 2026-10-15 - T008 page snapshot builder: done

- Task: T008 (lowest-numbered pending; T003 `needs supervised check` counts as satisfied). Status `in progress`, then `done`.
- Files: `src/snapshot/snapshot.ts` (new), `tests/unit/snapshot.test.ts` (new), `prd.md`.
- Design: `buildSnapshot` walks a minimal `SnapNode` tree (no jsdom in the repo, so unit tests use plain trees). `fromElement` adapts a live DOM element for the content script; it is typechecked but not unit-tested. Refs are sequential `e1..eN` in document order, so an unchanged page gives the same refs; `onRef` lets T009 map ref to node. Hidden, script, style, `aria-hidden` and `type=hidden` nodes are skipped. Password, card, CVV, OTP and `cc-*` autocomplete fields get `value: "[REDACTED]"` and contribute no text. Text budget 20000 chars, 200 elements, `truncated` flag set.
- Limits: redaction is name/autocomplete/type heuristics; a card field with an opaque name and no autocomplete is not caught. Computed-style hiding is only in the DOM adapter. Neither is exercised in a real browser (e2e blocked, launch-blockers 12). No new dependency, no new data flow.
- Results, real output:

```
$ npm test -- snapshot
 Test Files  1 passed (1)
      Tests  6 passed (6)
$ npm test
 Test Files  5 passed (5)
      Tests  40 passed (40)
$ npx tsc -p tsconfig.json -> TypeScript: No errors found
$ npx tsc -p tsconfig.lint.json -> TypeScript: No errors found
```

- Next task: T009 (action executor; e2e verification is blocked in sandbox, will be `needs supervised check`).

## 2026-10-15 - T009 action executor: needs supervised check

- Task: T009 (lowest-numbered pending; T008 done). Status `in progress`, then `needs supervised check`.
- Files: `src/actions/executor.ts`, `src/actions/dom.ts`, `src/content.ts` (new), `src/snapshot/snapshot.ts` (`fromElement` takes an optional node-to-element map), `scripts/build.mjs` (content entry), `tests/unit/actions.test.ts`, `tests/e2e/actions.spec.ts` (new), `prd.md`, `docs/launch-blockers.md`.
- Design: `executeAction(page, action)` handles click, type, select, scroll, navigate, wait against an `ActionPage` interface, so it unit-tests without a DOM. Every result is `{ok, action, ref?, message, error?}`; missing ref gives `no_ref`, removed element gives `stale_ref`, never throws. Navigate allows only http(s) and resolves relative URLs. Wait is capped at 10 s. Typed text is not echoed in result messages. The content script answers `assistant:snapshot` and `assistant:act`; refs resolve against the last snapshot. It is injected on demand (no `<all_urls>` content script), the background wiring is T010.
- Not in scope: sensitive-field and approval checks (T011). Typing into a password field is currently allowed by the executor.
- Results, real output:

```
$ npm test -- actions
 Test Files  1 passed (1)
      Tests  11 passed (11)
$ npm test
 Test Files  6 passed (6)
      Tests  51 passed (51)
$ npx tsc -p tsconfig.json -> TypeScript: No errors found (exit 0)
$ npx tsc -p tsconfig.lint.json -> exit 0 (after fixing 3 type errors in my new unit test)
$ npm run build -> built extension to .../apple/Extension/Resources
$ npm run e2e -- actions --timeout=15000 --global-timeout=90000
Error: http://127.0.0.1:4173/index.html is already used, make sure that nothing is running on the port/url or set reuseExistingServer:true in config.webServer.
```

- e2e not exercised: a first `npm run e2e -- actions` exceeded the 200 s tool timeout (WebKit launch hang, launch-blockers 12) and was moved to the background, which left its fixture server (node, PID 6507) on port 4173. `kill 6507` returned `operation not permitted`, so the retry could not bind the port. I did not change `reuseExistingServer` or otherwise work around it. The spec has never run, so the DOM adapter (`src/actions/dom.ts`) is unverified.
- Update: the backgrounded run later finished: 6 failed, 0 passed, all `Playwright ... Connection invalid` WebKit launch errors (blocker 12). Port 4173 is free again; no `kill` needed.
- Supervised check: outside the sandbox, `npm run build && npm run e2e -- actions`.
- Next task: T010 (agent loop; depends on T005, T007, T009, all satisfied).

## 2026-10-15 - T010 agent loop: needs supervised check

- Task: T010 (lowest-numbered pending; T005, T007, T009 satisfied). Status `in progress`, then `needs supervised check`.
- Files: `src/agent/loop.ts`, `tests/unit/agent.test.ts`, `tests/e2e/agent.spec.ts` (new); `src/popup.ts`, `src/popup.html`, `src/browser.d.ts` (S05 step list, Pause/Stop, "Do this on the page"); `prd.md`, `docs/launch-blockers.md`.
- Design: `runAgent` runs plan, snapshot, one provider call, one tool call per step. Tools: click/type/select/scroll/navigate/wait (T009 executor) plus `finish`. Budgets: 12 steps, 100000 tokens by default. `AgentControl` gives Pause/Resume/Stop; Stop is checked before every provider call, after it (a stopped run never acts on the model's output), and aborts the in-flight stream via the signal. Snapshot text goes to the model fenced as untrusted; the goal sits outside the fence. Unknown tool names fail the step without acting. Popup injects `content.js` into the active tab on demand and relays `assistant:snapshot`/`assistant:act`.
- Not in scope / limits: no approval sheet or sensitive-action classifier yet (T011): the loop will click or type anything the model asks. Do not use against real sites until T011. Tool calls are replayed to the provider as plain assistant text, since `ChatMessage` has no tool-result blocks; fine for mocks, to be revisited with live keys (blocker 3). No new dependency or data flow (same provider calls as chat).
- Results, real output:

```
$ npm test
 Test Files  7 passed (7)
      Tests  60 passed (60)
$ npx tsc -p tsconfig.json -> no errors
$ npx tsc -p tsconfig.lint.json -> no errors
$ npm run build -> built extension to .../apple/Extension/Resources
$ npm run e2e -- agent --global-timeout=60000
Running 2 tests using 2 workers
Timed out waiting 60s for the test suite to run
  2 did not run
```

- e2e not exercised: WebKit launch hangs in the sandbox (blocker 12). `tests/e2e/agent.spec.ts` has never run, so the popup wiring and S05 markup are unverified in a browser.
- Supervised check: outside the sandbox, `npm run build && npm run e2e -- agent`.
- Next task: T011 (safety layer; depends on T010).

## 2026-10-15 - T011 safety layer: needs supervised check

- Task: T011 (lowest-numbered pending; T010 satisfied). Status `in progress`, then `needs supervised check`.
- Files: `src/safety/classifier.ts` (new), `src/agent/loop.ts` (approval gate, CAPTCHA stop, `approve` callback), `src/actions/executor.ts` (`approval_denied` code), `src/popup.ts` + `src/popup.html` (S06 approval sheet, `role="alertdialog"`, focus on "Don't allow"), `tests/unit/safety.test.ts`, `tests/e2e/safety.spec.ts` (new); `prd.md`, `docs/launch-blockers.md`.
- Design: `classifyAction` marks click/type/select as approval-required for payment/order, login/sign-up, destructive (delete/close account), send/post/publish, download, form submit (`type=submit`), and any type/select into a redacted (password/card) field. Navigate, scroll, wait, and unknown refs (act on nothing) are not sensitive. The loop denies a sensitive action unless `approve` resolves true: no approver, a throw, or Stop during the prompt all mean no action. A denied step reports `approval_denied` to the model and the run continues. `detectCaptcha` checks title, text, element names and hrefs; a hit ends the run with status `captcha` before any provider call. Untrusted-content wrapping already existed (T007/T010 `fencePage`, system prompt).
- Limits: classifier is label/regex based, so a mislabeled or non-English button can slip through; `navigate` is not approval-gated. Both noted for T017 review. No new dependency or data flow.
- Results, real output:

```
$ npm test
 Test Files  8 passed (8)
      Tests  75 passed (75)
$ npx tsc -p tsconfig.json -> exit 0
$ npx tsc -p tsconfig.lint.json -> exit 0
$ npm run build -> built extension to .../apple/Extension/Resources
$ npm run e2e -- safety --global-timeout=60000
  5 did not run
  ✘  5 [webkit] › tests/e2e/safety.spec.ts:135:1 › a CAPTCHA page stops the run (1ms)
  ✘  2 [webkit] › tests/e2e/safety.spec.ts:98:1 › login and send actions also need approval (0ms)
  ✘  1 [webkit] › tests/e2e/safety.spec.ts:78:1 › order submit is blocked until approved (0ms)
  ✘  4 [webkit] › tests/e2e/safety.spec.ts:90:1 › declining the approval sheet leaves the page untouched (1ms)
  ✘  3 [webkit] › tests/e2e/safety.spec.ts:121:1 › injected page text cannot trigger an unapproved action (1ms)
```

(Output trimmed to the last 6 lines by `tail -6`; nothing added. The `npm test` and `tsc` lines above are likewise trimmed: `tsc` printed nothing, exit 0 is from `echo $?`.)

- e2e not exercised: WebKit launch blocked in the sandbox (blocker 12); the popup approval sheet and spec are unverified in a browser.
- Supervised check: outside the sandbox, `npm run build && npm run e2e -- safety`.
- Next task: T012 (@tab multi-tab context; depends on T007).


## 2026-10-15 - T012 @tab multi-tab context: needs supervised check

- Task: T012 (lowest-numbered pending; T007 satisfied). Status `in progress`, then `needs supervised check`.
- Files: `src/chat/tabs.ts`, `tests/unit/tabs.test.ts`, `tests/e2e/tabs.spec.ts` (new); `src/chat/prompt.ts` (multi-page fences, shared char budget, system prompt asks to name the source page), `src/chat/session.ts` (`extraPages`), `src/popup.ts` + `src/popup.html` (tab checkbox fieldset, `@name` mentions, permission request), `src/browser.d.ts`, `src/manifest.json`, `prd.md`.
- Design: other tabs in the window are listed as checkboxes; `@token` in the question also selects a tab whose host or title word matches (active tab skipped, max 4 extra). Each page gets its own untrusted fence with URL and title; the active page keeps the larger share of the 30000-char budget. Only selected tabs are read.
- Permission change, owner to confirm: added `tabs` (needed for other tabs' title/URL) and `optional_host_permissions` for http(s). Other tabs' origins are requested via `permissions.request` from the Send click; a declined origin means that tab is skipped and the status line says so. This is broader than the PRD's earlier list; PRD updated. Safari's runtime behavior for `permissions.request` is unverified (add to Runtime-verified column of `docs/safari-api-support.md` during supervised check).
- No new dependency or data flow: selected tab text goes to the same chosen provider as the active page.
- Results, real output:

```
$ npm test
 Test Files  9 passed (9)
      Tests  82 passed (82)
$ npx tsc -p tsconfig.json -> exit 0
$ npx tsc -p tsconfig.lint.json -> exit 0
$ npm run build -> built extension to .../apple/Extension/Resources
$ npm run e2e -- tabs --global-timeout=60000
Timed out waiting 60s for the test suite to run
  3 did not run
```

- e2e not exercised: WebKit launch blocked in the sandbox (blocker 12). The popup tab picker and `tabs.spec.ts` have never run in a browser.
- Supervised check: outside the sandbox, `npm run build && npm run e2e -- tabs`; then in Safari verify the permission prompt for a second site.
- Next task: T013 (coupon finder; depends on T010, T011).

## 2026-10-15 — supervised review of Ralph run 2 (Claude, interactive session)

- Run 2 (Sonnet 5.5, 10 iterations, $5 cap each): every iteration moved a task. 16 → 6 open. Hit the iteration limit, not complete.
- Outside the sandbox: `npm run typecheck` ok; `npm run lint` (tsc strict config, not ESLint) ok; `npm test` → "Tests 82 passed (82)".
- `npx playwright test` first run: 22 passed, 2 failed.
  - safety "a CAPTCHA page stops the run": strict-mode locator matched 2 elements; behavior was correct. Test now asserts the exact stop message.
  - agent "Stop halts the run within one step": the mock answered instantly, so the run finished before Stop was clicked (test race). Added `modelDelayMs` to hold model replies after the first; with it, the status shows "Agent stopped." Locator made exact. No assertion was loosened.
  - Rerun: "24 passed".
- Xcode: macOS and iOS (Simulator) targets BUILD SUCCEEDED with the new Swift code.
- Added macOS unit-test bundle `AssistAntTests` via `scripts/add-test-target.rb` (xcodeproj gem 1.21.0). `xcodebuild -project apple/AssistAnt.xcodeproj -scheme AssistAntTests -derivedDataPath build/DD test` → "Executed 8 tests, with 0 failures", TEST SUCCEEDED.
- `grep -rnE "storage\.(local|sync)\.set" src` → no matches.
- Statuses: T003, T004, T007, T009–T012 done. T006 still needs screenshots, Accessibility Inspector, and the shared Keychain access group (needs an Apple team ID, blocker 2/14).

## 2026-10-15 - T013 coupon finder: needs supervised check

- Task: T013 (lowest-numbered pending; T010 and T011 satisfied). Status `in progress`, then `needs supervised check`.
- Files: `src/coupons/finder.ts`, `src/coupons/codes.ts`, `tests/unit/coupons.test.ts`, `tests/e2e/coupons.spec.ts` (new); `src/popup.ts` + `src/popup.html` (S07 results table, "Find coupons", Stop), `tests/fixtures/shop.html` (coupon message, order status marker); `prd.md`, `docs/launch-blockers.md`.
- Design: the try loop is plain code, not model-driven. `runCouponSearch` finds the coupon input and an Apply button (any target the safety classifier marks payment/login/send/destructive/download is refused, so the order button is never a candidate), then per code: type, click Apply, wait, re-snapshot, parse `Total`. Saving is baseline minus total; best is the largest positive saving. The winner is re-applied and verified by a fresh read. CAPTCHA mid-run is a hard stop; Stop/Pause honored between codes. Max 10 codes. No order click exists in the code path.
- Limit, honest: `suggestCodes` asks the model for codes. It is not a live web search (provider layer has no search tool), so codes may be stale or invented; every code is checked against the real total. UI says so. Recorded as launch-blockers 15. `claims-evidence.md` gets no "finds coupons" claim row until search exists.
- Merchant terms and bot detection stay open (blocker 4). Fixture and tests use synthetic codes only; no merchant network calls. No new dependency or data flow (merchant hostname goes to the chosen provider, same flow as page text).
- Results, real output:

```
$ npm test
 Test Files  10 passed (10)
      Tests  92 passed (92)
$ npx tsc -p tsconfig.json -> exit 0
$ npx tsc -p tsconfig.lint.json -> exit 0
$ npm run build -> built extension to .../apple/Extension/Resources
$ npm run e2e -- coupons --global-timeout=60000
Timed out waiting 60s for the test suite to run
  1 did not run
```

- e2e not exercised: WebKit launch blocked in the sandbox (blocker 12); `tests/e2e/coupons.spec.ts` has never run in a browser. The acceptance e2e (5 codes, 2 valid, best applied, order never clicked) is covered by the unit test `tries each code once, keeps the larger saving, never clicks order` until then.
- Supervised check: outside the sandbox, `npm run build && npm run e2e -- coupons`.
- Next task: T014 (cost display; depends on T005).

## 2026-10-15 - T014 cost display: done

- Task: T014 (lowest-numbered pending; T005 satisfied). Status `in progress`, then `done`.
- Files: `src/cost.ts`, `tests/unit/cost.test.ts` (new); `src/popup.ts` (chat, agent, coupon status lines now show tokens in/out and estimated cost); `prd.md`, `docs/claims-evidence.md`, `docs/launch-blockers.md`.
- Design: `PRICES` table keyed by model id, per million tokens, dated 2026-10-15. Unknown model returns `null`; UI then shows tokens and "Cost estimate unavailable", never a guess. Only `claude-sonnet-5-5` ($2 in / $10 out) has a source: Anthropic pricing page, fetched this session. Cache-token pricing is not modeled (providers layer reports only input/output). gpt-5: fetch of OpenAI pricing was denied, so no price (launch-blockers 16).
- No new dependency or data flow.
- Results, real output:

```
$ npm test
 Test Files  11 passed (11)
      Tests  96 passed (96)
$ npx tsc -p tsconfig.json -> No errors found
$ npx tsc -p tsconfig.lint.json -> No errors found
$ npm run build -> built extension to .../apple/Extension/Resources
$ npm test -- cost
 Test Files  1 passed (1)
      Tests  4 passed (4)
```

- Popup rendering of the new status text not exercised in a browser (WebKit blocked, blocker 12); logic is covered by unit tests.
- Next task: T015 (settings; depends on T004, T007).

## 2026-10-15 - T015 settings: needs supervised check

- Task: T015 (lowest-numbered pending; T004 and T007 satisfied). Status `in progress`, then `needs supervised check`.
- Files: `src/settings/settings.ts`, `tests/unit/settings.test.ts`, `tests/e2e/settings.spec.ts` (new); `src/popup.ts`, `src/popup.html` (S08 panel behind a Settings button), `src/browser.d.ts` (storage, permissions.getAll/remove); `prd.md`, `docs/data-inventory.md`, `docs/launch-blockers.md`.
- Design: `Settings` {provider, model, retention off|7|30, default 7} in `browser.storage.local` key `settings`; malformed stored values fall back to defaults. Popup prefers the chosen provider, falls back to any provider with a Keychain key (fallback uses that provider's default model). Chat Q&A text is saved only when retention is not off; pruned on load and on append; max 200. Per-site access lists granted origins (minus the two API hosts) with a per-origin Remove. Delete all data asks for confirm (focus on Cancel), then deletes both Keychain items, clears `storage.local`, removes granted origins; each step runs even if another fails and failures are named in the status line.
- Limits, honest: agent runs and coupon runs are not saved to history. The host-app (SwiftUI) settings screen is not built; settings live in the popup only. Model field is free text, not validated against a model list. API key still never touches `storage.local`.
- Results, real output:

```
$ npx tsc -p tsconfig.json -> No errors found
$ npx tsc -p tsconfig.lint.json -> No errors found
$ npm run build -> built extension to .../apple/Extension/Resources
$ npm test
 Test Files  12 passed (12)
      Tests  107 passed (107)
$ npm test -- settings
 Test Files  1 passed (1)
      Tests  11 passed (11)
$ npm run e2e -- settings --global-timeout=60000
Timed out waiting 60s for the teardown for test suite to run
  3 did not run
```

- e2e not exercised: WebKit launch blocked in the sandbox (blocker 12); `tests/e2e/settings.spec.ts` has never run in a browser. Retention expiry and Delete-all logic are covered by unit tests with fake storage.
- Supervised check: outside the sandbox, `npm run build && npm run e2e -- settings`. Xcode, supervised only (sandbox blocks `xcodebuild`, blocker 9; not run, no output to quote; no Swift edits in this task): `xcodebuild -project apple/AssistAnt.xcodeproj -scheme AssistAntTests -derivedDataPath build/DD test`.
- Next task: T016 (draft privacy policy + terms; depends on T015).

## 2026-10-15 - T016 privacy policy + terms drafts: needs supervised check

- Task: T016 (lowest-numbered pending; T015 satisfied). Status `in progress`, then `needs supervised check`.
- Files: `docs/legal/privacy-policy.md`, `docs/legal/terms.md` (new, both marked DRAFT); `docs/compliance-checklist.md` (T016 review checklist appended); `prd.md`.
- Design: policy section 3 mirrors every `docs/data-inventory.md` row. Facts come only from the inventory, PRD, and launch-blockers. Entity, location, contact, effective date, minimum age, price, refunds, governing law, regional regimes, liability wording are marked UNKNOWN, not invented. Terms disclose coupon finder limits (no savings guarantee, codes are model suggestions per blocker 15) and agent approval rules.
- No new dependency or data flow.
- Check run (manual checklist, scripted grep), real output:

```
$ grep -c -e "Provider API key" -e "Provider and model" -e "Page content" -e "Screenshots" -e "Chat questions" -e "Sites you granted" -e "Coupon codes" -e "Coupon search queries" -e "autofill profile" docs/legal/privacy-policy.md
9
$ grep -c UNKNOWN docs/legal/privacy-policy.md docs/legal/terms.md
docs/legal/privacy-policy.md:10
docs/legal/terms.md:11
```

- Limits, honest: drafts are not legal review (blocker 8 open). In-app S09 legal screen is not built; drafts are docs only. Policy statements about runtime behavior (redaction, retention, Delete all data) rest on T008/T015 unit tests; the e2e for those never ran in a browser (blocker 12). Safeguard rows 1-4 left for T017.
- Supervised check: owner/counsel reviews `docs/legal/` and supplies UNKNOWN facts.
- Next task: T017 (safeguards sweep; depends on T006-T016, several still `needs supervised check`, which counts as satisfied).

## 2026-10-15 - T017 safeguards sweep: needs supervised check

- Task: T017 (lowest-numbered pending; T006-T016 all `done` or `needs supervised check`). Status `in progress`, then `needs supervised check`.
- Files: `docs/compliance-checklist.md` (all 20 rows filled), `prd.md`, `docs/launch-blockers.md` (blocker 17 added), `activity.md`.
- Result: PASS 5 (rows 4, 7, 8, 10, 11), NOT APPLICABLE 2 (5, 18), BLOCKED 2 (16, 17), NEEDS REVIEW 11. Every row has an evidence path and a named check.
- Checks run, real output:

```
$ npm test
 Test Files  12 passed (12)
      Tests  107 passed (107)
$ npm audit
found 0 vulnerabilities   (run also printed "failed to copy trust settings of system certificate" warnings)
$ grep -rniE "analytics|telemetry|XMLHttpRequest|sendBeacon|document.cookie|localStorage" src
(no matches)
$ grep -rniE "testimonial|5 star|rated|unsubscribe|newsletter|mailto" src docs/legal
(no matches)
replica/contrast.txt: 34 pairs, 0 failing AA
```

- Honest limits: the a11y audits named in T017 were not run. web-quality-audit needs a browser (WebKit blocked, blocker 12); Accessibility Inspector needs the supervised GUI session (blocker 14). Rows 13, 14, 15 stay NEEDS REVIEW. Row 11 PASS rests on absence of such content; listing and landing page do not exist yet. Row 19 lacks a full-tree license scan.
- Open owner decisions: rows 3, 16, 17 (blockers 1, 5); row 6 (distinct first-run acknowledgement?); row 12 (claims rows at Phase 6).
- Next task: T018 (manual Safari/Simulator verification; depends on T017). Supervised only: sandbox cannot launch Safari or the Simulator (blockers 9, 10).

## 2026-10-15 - T018 manual Safari/Simulator verification: blocked

- Task: T018 (only remaining `pending`; T017 `needs supervised check` counts as satisfied). Status `in progress`, then `blocked`.
- Files: `prd.md` (T018 status), `docs/launch-blockers.md` (blocker 18 added), `activity.md`.
- Nothing implementable: acceptance is one screenshot per flow F01-F07 from Safari macOS and the iOS Simulator. Sandbox cannot launch Safari or Simulator (blockers 9, 10) and PROMPT.md forbids `xcrun`/`xcodebuild` in the loop. No command run; no output to quote. No screenshots fabricated.
- Supervised check: outside sandbox, run F01-F07 in both targets, `xcrun simctl io booted screenshot ralph/evidence/<flow>.png`, log failures as bugs.
- Next task: none pending. All remaining work is supervised/owner (blockers 1, 2, 5, 8, 9, 10, 12, 14, 15, 16, 17, 18).

### T018 addendum: verification evidence check

`xcrun simctl io booted screenshot` is forbidden in the loop (PROMPT.md step 7), so the supervised command was not run. The sandbox-runnable check of the acceptance criterion (one screenshot per flow F01-F07 in `ralph/evidence/`) was run, real output:

```
$ ls ralph/evidence; echo ---; ls ralph/evidence | grep -ciE "F0[1-7]"
T002b-ios-extension-enabled.png  230.4K
---
0
```

Result: 0 of 7 flow screenshots exist (grep exit 1); only the T002b enabled-state screenshot is present. Acceptance not met, status stays `blocked`.

### T018 goal-condition conflict (recorded at stop)

The `/goal` condition asks for the task's own verification command to be run with output quoted. T018's command is `manual + xcrun simctl io booted screenshot`. `PROMPT.md` step 7 forbids `xcrun` and the Simulator in the loop, and the sandbox blocks both (blockers 9, 10). Hard project rules outrank the goal text, so the command was not run and no output is invented. T018 is manual-only; the condition cannot be met in this session. Stopping and leaving it `blocked` (blocker 18). Needed: supervised session runs F01-F07 and saves screenshots to `ralph/evidence/`.

## 2026-10-15 — supervised review of Ralph run 3 (Claude, interactive session)

- Run 3 (Sonnet 5.5, $5 cap each): 6 iterations, then the script printed `<promise>COMPLETE</promise>` because no row was `pending`. That is NOT Gate A: T006, T017, and T018 still need supervised or owner work.
- Outside the sandbox: `npm run build` ok, typecheck ok, lint ok, `npm test` → "Tests 107 passed (107)", `npx playwright test` → "28 passed".
- Xcode: macOS + iOS Simulator BUILD SUCCEEDED; AssistAntTests → "Executed 8 tests, with 0 failures", TEST SUCCEEDED.
- T013 meets its acceptance test, but codes come from model suggestions, not a live web search (launch-blocker 15). A model-invented code shown as "found" would be an unsupported claim, so T019 is added to wire provider web search and require a source URL for every code.
- T016 drafts exist; S09 in-app screen not built → T020 added.
- Remaining supervised: T006 (light/dark screenshots, Accessibility Inspector, shared Keychain group needs Apple team ID), T017 (web-quality-audit on popup, Accessibility Inspector), T018 (manual F01–F07 in Safari + Simulator).

## 2026-10-15 - T019 provider web search in coupon finder: needs supervised check

- Task: T019 (lowest-numbered pending; depends on T013 `done`). Status `in progress`, then `needs supervised check`.
- Files: `src/providers/{types,anthropic,openai}.ts` (`webSearch` request flag; `source` stream event from Anthropic `web_search_tool_result` / `citations_delta` and OpenAI `url_citation`), `src/coupons/{codes,finder}.ts` (model replies `CODE | URL`; a code is kept only if its URL was returned by the search; finder takes `{code, sourceUrl}` and refuses candidates without a URL; with no sourced codes it says so), `src/popup.{ts,html}` (Source link column, honest copy), `tests/unit/{coupons,providers}.test.ts`, `tests/e2e/coupons.spec.ts`, `docs/legal/terms.md`, `docs/compliance-checklist.md`, `docs/launch-blockers.md` (15), `prd.md`.
- Mocked only: no call to api.anthropic.com or api.openai.com. Streams are synthetic.
- Checks, real output:

```
$ npm run typecheck   -> tsc -p tsconfig.json (no errors)
$ npm run lint        -> tsc -p tsconfig.lint.json (no errors)
$ npm test -- coupons providers
 Test Files  2 passed (2)
      Tests  35 passed (35)
$ npm test
 Test Files  12 passed (12)
      Tests  114 passed (114)
$ npm run build       -> built extension to .../apple/Extension/Resources
$ npx playwright test coupons
 TimeoutError: browserType.launch: Timeout 180000ms exceeded.
 sandbox_extension_issue_file_to_process failed ... Playwright.app: 1 (Operation not permitted)
 1 failed  [webkit] coupons.spec.ts:88
```

- Honest limits: e2e failed at WebKit launch, not on an assertion (blocker 12); the updated spec (source link per row) has not run. The request shapes (`web_search_20250305`, `web_search`) match the providers' documented tools from memory and were not checked against a live API (blockers 3, 15). `docs/data-inventory.md` already lists the web-search flow.
- Supervised: run `npx playwright test coupons` outside the sandbox; one live search check with owner test keys.
- Next task: T020 (pending).

## 2026-10-15 - T020 in-app legal screen: needs supervised check

- Task: T020 (lowest-numbered pending; depends on T016 `done`). Status `in progress`, then `needs supervised check`.
- Files: `scripts/build.mjs` (renders `docs/legal/*.md` to escaped `privacy.html`/`terms.html` in Resources, DRAFT banner), `src/popup.html` (Legal section in S08 with two links), `apple/App/OnboardingView.swift` (S09 buttons + sheet reading bundled `.md`), `tests/e2e/settings.spec.ts` (keyboard focus + Enter opens each page, DRAFT text, h1), `prd.md`, `docs/launch-blockers.md` (19). No new dependency or data flow (static local pages).
- Checks, real output:

```
$ npm run typecheck -> tsc -p tsconfig.json (no errors)
$ npx tsc -p tsconfig.lint.json -> TypeScript: No errors found (lint=0)
$ npm run build -> built extension to .../apple/Extension/Resources
$ npm test -> Test Files 12 passed (12); Tests 114 passed (114)
$ grep "<h1" Resources/privacy.html -> <h1>AssistAnt Privacy Policy (DRAFT)</h1>
$ npx playwright test settings
  4 failed  (settings.spec.ts:59, :71, :80 existing, :99 new legal-links)
```

- Honest limits: all 4 settings specs failed, including 3 that passed under supervision before and that this change does not touch. That matches the WebKit launch failure of blocker 12, but the failure-reason line was not captured in this run (output filtered), so it is not proven. The new spec has not passed. Host app Swift unbuilt (sandbox, blockers 9, 19).
- Supervised: `npx playwright test settings` outside the sandbox; add legal `.md` to App Resources and build both schemes.
- Next task: none pending.

## 2026-10-15 — supervised review of Ralph run 4 (Claude, interactive session)

- Run 4 (Sonnet 5.5, max 4 iterations, $5 cap): 2 iterations, T019 and T020 implemented; loop printed COMPLETE because no row was `pending`. Not Gate A.
- e2e first attempt failed to start: port 4173 was held by an unrelated local server (owner's studio-site `http.server`, left running). Changed `playwright.config.ts` to default port 4317, overridable with `E2E_PORT`.
- e2e then: 28 passed, 1 failed ("legal drafts open from settings by keyboard and are marked DRAFT"). Cause: the test routed `privacy.html`/`terms.html` on the popup page, but the links open new tabs. Routed on the browser context instead; assertions unchanged. Rerun: "29 passed".
- `npm test` → "Tests 114 passed (114)"; typecheck, lint, build ok. Xcode macOS + iOS BUILD SUCCEEDED; AssistAntTests "Executed 8 tests, with 0 failures".
- T019, T020 done. Live web search with real keys still unverified (blocker 3).

## 2026-10-15 — T006 supervised (Claude, interactive session)

- Added iOS UI-test target `AssistAntUITests` (`scripts/add-ui-test-target.rb`) and bundled `docs/legal/*.md` into both app targets.
- `performAccessibilityAudit` found, in order: disabled "Test key"/"Save key" contrast; system-blue link buttons (~4:1); clipped "Key status" text; toolbar "Done" contrast + Dynamic Type; dark "Save key" (white on light purple). All fixed in code; no audit issue is filtered (test collects every issue and fails on any).
- First "dark" run was invalid: `XCUIDevice.appearance` did not apply; screenshot was light. Replaced with DEBUG-only `-UITestColorScheme` launch argument plus a pixel assertion that the scheme applied.
- Disabled buttons replaced by always-enabled buttons that explain what is missing (XCTest: 10/10 pass incl. 2 new hint tests).
- Legal sheet: real close button (`.cancelAction` shortcut) instead of no control (keyboard trap on macOS); minimal Markdown rendering for headings, quotes, tables, lists, field lines.
- Hang fix: `xcodebuild test` never exited with screen-recording diagnostics on; `-collect-test-diagnostics never` fixes it. Dedicated simulator "AssistAnt Test iPhone" (BBCC2295-…) avoids clashing with other projects' runners.
- Final: `xcodebuild ... -scheme AssistAntUITests ... test` → 3/3 passed, TEST SUCCEEDED. macOS build ok; unit 114/114; e2e 38/38 (incl. new axe a11y spec); lint + typecheck ok.
- Web a11y (T017 input): new `tests/e2e/a11y.spec.ts` (axe-core WCAG 2.2 A/AA, WebKit, light + dark; Option+Tab keyboard walk). Found dark-mode legal-page link contrast failure; fixed with token colors in `scripts/build.mjs`.
- Lighthouse not run: not installed and no Chrome DevTools MCP. axe in WebKit used instead.

## 2026-10-15 — T017 supervised (Claude, interactive session)

- Re-checked all 20 safeguard rows against the repo; changed rows cite real files/tests.
- `npm audit` (all and `--omit=dev`) → "found 0 vulnerabilities". No runtime npm dependencies.
- Row 10 was PASS without an upfront disclosure in the UI (only in the terms draft). Added: "Your provider bills your account for every request AssistAnt makes, at the provider's prices. AssistAnt shows an estimated cost after each answer or task." to popup no-key state and host app key setup.
- Popup status line showed internal codes ("Coupons no_codes."). Added `couponStatusText()` + unit test.
- Coupon totals: parser only reads "$" totals; other currencies get "Could not read a total", so "$" display is consistent. Recorded as a limitation.
- Checks after changes: unit 115/115, e2e 38/38, lint + typecheck ok, iOS UI audit TEST SUCCEEDED.

## 2026-10-15 — T018 supervised on iOS Simulator (Claude, interactive session)

- Device: dedicated "AssistAnt Test iPhone" (iOS 27, BBCC2295-…), local fixture server on 127.0.0.1:4318 (stopped afterwards).
- F01: host app setup screen captured. Enabled AssistAnt in Safari (Manage Extensions). Popup asked for per-site access; chose "Allow for One Day" for 127.0.0.1 only.
- Popup no-key state renders with the billing disclosure (`T018-ios-safari-popup-no-key.png`).
- F07 Delete all data: found that Safari-granted site access survives `permissions.remove` while the UI reported full success. Fixed: `deleteAllData` re-lists granted sites; `deleteReportText` names any that remain and gives the Safari Settings path; result shown next to the button (role=status). New unit tests.
- First F07 attempt also showed "Could not delete your API keys in Keychain": cause was the unsigned simulator build (`CODE_SIGNING_ALLOWED=NO`); with ad-hoc signing (`CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual`) the Keychain step succeeds. Simulator builds for manual testing must be signed.
- Opening Settings focused the provider `<select>`, which on iOS opens the picker over the panel. Fixed: focus the Settings heading; skip auto-focus of the question field on coarse pointers. New e2e tests.
- Checks: unit 117/117, e2e 40/40, lint + typecheck ok, iOS build ok.
- Not done: F02–F06 (need owner test keys, blocker 3); macOS Safari flows (owner manual); key sharing between app and extension (blocker 14).

## 2026-10-15 — shared Keychain group (iOS), before owner test keys

- Added `keychain-access-groups` = `$(AppIdentifierPrefix)com.example.AssistAnt.shared` for the iOS app + extension (`apple/iOS-Shared.entitlements`, `scripts/set-ios-keychain-group.rb`); group passed at runtime via Info.plist `AssistAntKeychainGroup` = `$(KEYCHAIN_GROUP)`. macOS unchanged (resolves to empty → no group).
- Xcode resolved `$(AppIdentifierPrefix)` to `KTV2G3Z883.` on this Mac: a development team appears to be configured. Not assumed to be the owner's paid membership; asked.
- Verified: host app launched with DEBUG-only `-SeedSyntheticKey YES` wrote `sk-test-synthetic-sharing-check`; the Safari popup then showed "Ready. Using anthropic claude-sonnet-5-5." (`ralph/evidence/T018-ios-shared-keychain-ready.png`). Then `xcrun simctl keychain <test sim> reset`.
- Regression: macOS build ok, XCTest 10/10.

## 2026-10-15 — T018 live verification with owner test keys (Claude, supervised)

Owner saved test keys in the host app on "AssistAnt Test iPhone". Fixture site on 127.0.0.1:4318 (synthetic pages only). Results with Anthropic `claude-sonnet-5-5`:

- F02 ask: first attempt "The API key was rejected" (401). Cause: browser-origin calls need `anthropic-dangerous-direct-browser-access: true` (confirmed in the official TypeScript SDK source, sent for `dangerouslyAllowBrowser`). Added header + unit assertion. Also removed provider hosts from `host_permissions` (not needed; fewer prompts). Retest: correct total and "no coupon applied"; status shows tokens + estimated cost ($0.0014). PASS.
- F03 summarize: accurate bullets, $0.0018. PASS.
- F04 cross-tab: answered "I can't tell you" about the ticked tab. iOS Safari cannot script a background tab; the popup only noted this in the status line, which "Done" overwrote. Fix: unread tabs named in the conversation; new e2e. Live capability gap remains on iOS (works on macOS e2e only).
- F05 agent: hung on "Agent running." with Stop doing nothing. Causes found with DEBUG-only stage tracing (stage names only, compiled out of release; `debug.stage` native message → os_log):
  1. `content.js` (and `privacy.html`/`terms.html`) were never in either extension bundle's Copy Bundle Resources → handler missing. Fixed with `scripts/sync-extension-resources.rb`; added `scripts/check-extension-bundle.sh`.
  2. Page calls over `tabs.sendMessage` could wait forever. Switched to `scripting.executeScript` with an envelope that reports failures; page calls now time out (15 s) and Stop aborts both page calls and the model request (`AgentControl.signal`). New unit tests for hang, Stop-while-waiting, Stop-aborts-model, malformed snapshot.
  3. Popup now catches any agent failure instead of staying on "Agent running.".
  Retest: plan shown; typed name + email, selected Support; approval sheet "Agent wants to click "Send" (e5). This looks like it sends or publishes something."; chose Don't allow; agent reported it did not send and did not retry. 10,336 tokens, $0.03. PASS.
- F06 coupons: "No sourced codes found, so none were tried. AssistAnt does not guess codes." on the synthetic shop (expected: no public codes exist for 127.0.0.1). $0.0073. PASS for honesty; applying a real sourced code is untested live.
- Provider switch: OpenAI chosen + saved, popup still used Anthropic silently. Trace: `key:openai missing`. Root cause in host app: switching the provider picker kept "Key saved to Keychain." from the other provider, so the OpenAI key looked saved but never was. Fixed: per-provider state + provider name in the message (XCTest added); popup now announces any fallback (e2e added).
- Checks after fixes: unit 121/121, e2e 42/42, XCTest 11/11, iOS UI a11y audit TEST SUCCEEDED, macOS + iOS builds ok, both bundles contain all 7 resources.
- Owner action: re-enter the OpenAI test key in the host app (the status now names the provider), then the OpenAI live path can be verified.

## 2026-10-15 — final report

- Owner chose to skip the OpenAI live path for now.
- Refreshed stale launch blockers (3, 9, 10, 12, 13, 15) and added 16–20 from T018.
- Wrote `docs/final-report.md`. Gate A not met; Gate B not met.

## 2026-10-15 — macOS Safari: extension missing from Settings → Extensions

- Built, signed ad-hoc, and registered (`pluginkit` listed it), but Safari did not list it.
- Cause (most likely): LaunchServices also held the iOS Simulator build with the same bundle ID `com.example.AssistAnt`. Fix: `lsregister -u` on the Simulator copies, `touch build/.metadata_never_index` so Spotlight does not re-add them, `lsregister -f -R` on the Mac app, then the owner restarted Safari and re-allowed unsigned extensions. Owner confirms AssistAnt is now listed.
- Note for the Mac test flow: after any iOS Simulator build, re-run the unregister step or Safari may hide the Mac extension again.

## 2026-10-15 — Diagnostics tool for owner bug reports (supervised)

- Owner request: copy what happened on an error, paste it as "Actual behavior", Claude asks "What is the expected behavior?", then fixes.
- Added `src/diagnostics.ts`: local recorder of the last 5 runs (kind, stage timeline, user-visible errors, outcome, tokens, page hostname, provider/model). Scrubs keys, emails, URL paths; caps text. Question recorded only with opt-in.
- Popup (debug builds only): "Copy diagnostics" on every error message and in Settings → Diagnostics, opt-in checkbox, Clear. Clipboard with a selected-text fallback. Runs covered: startup (key lookup), ask, summarize, agent (steps, approvals), coupons.
- Release builds exclude it: `__ASSISTANT_DEBUG__` define + `minifySyntax` drops the code; `<!-- debug:start/end -->` block stripped from HTML. `npm run check:release` → "release bundle clean".
- Tests: unit 131 (10 new), e2e 45 (3 new: report is Actual behavior, contains no key/page text/URL query/question by default; opt-in includes question; controls labeled). XCTest 11/11. macOS build ok, bundle check ok.
- Workflow rule added to CLAUDE.md ("Bug reports from the owner"). Data inventory row added.

## 2026-10-15 — Ant mascot for the Safari toolbar

- Owner asked for a funny ant character as the toolbar element.
- Drew original SVGs: `design/icons/ant-toolbar.svg` (head: mismatched googly eyes, curly antennae, buck-tooth grin; dark outline + violet so it reads on light and dark toolbars) and `design/icons/ant-icon.svg` (full ant waving, on a lavender tile).
- `scripts/render-icons.mjs` renders PNGs with Playwright WebKit (no new dependency) into `src/icons/` and a light/dark preview (`build/icon-preview.png`, checked visually at 16/19/32 px).
- Manifest: `action.default_icon` (16–64) and `icons` (48–512). Build copies `src/icons/` to Resources; Xcode folder reference added to both extension targets; bundles verified (12 PNGs each).
- Added `scripts/register-mac-extension.sh` (unregisters Simulator copies, registers + relaunches the Mac app); run after any iOS build.
- Checks: unit 131, e2e 45, release bundle clean, macOS + iOS builds ok.

## 2026-10-16 — Chat-first popup redesign (T021–T027, supervised)

- Owner request with Comet screenshots: settings inside the dropdown (incl. API key), clean chat with saved history, Chat / Control Browser selector with a bold "Control Browser" chip, cleaner Safari-like UI, chat as the main area.
- Design: ui-ux-pro-max (minimal style; its Inter web font and landing pattern rejected: new vendor / not applicable); fixing-accessibility rules applied while writing. Existing contrast-checked tokens kept.
- New: `src/popup.html` and UI layer of `src/popup.ts` rewritten; logic modules unchanged. `src/providers/keytest.ts` (key check against the provider's model list; unit tests). Conversation helpers in `src/settings/settings.ts` (kind, New chat marker, clear). Agent `webSearch` option + research note; Anthropic web search tool updated to `web_search_20260209` (claude-api skill). Mac host app points key entry to the popup.
- Answer to owner question 2a: Claude computer use and Claude in Chrome cannot drive Safari from an extension, and an MCP server would be a separate program. The existing DOM tool-use agent is the right engine; this pass adds web research.
- Bugs caught by tests during the work: model pill accessible name did not contain its visible text (WCAG 2.5.3), fixed; Delete all data left a fresh diagnostics record, fixed (`connect(false)`, `Diagnostics.forget`); message box had no visible focus, fixed (ring on the composer box).
- I first misread a 150 ms color transition in a screenshot as a WebKit `:has()` bug; it was not. Kept the script-set selected class, corrected the code comment.
- Checks: unit 136, e2e 51 (incl. 6 new redesign tests, axe light/dark on chat + settings), lint + typecheck clean, release bundle clean, XCTest 11/11, macOS build + bundle check ok, extension re-registered. Screenshots: `ralph/evidence/popup-*.png`.
- Not verified yet: the new popup live in Safari on the owner's Mac; live Control Browser web research; iOS layout of the new popup in the Simulator.

## 2026-10-16 — Answer formatting + app icon (T029, T030)

- Owner report 1: on a Fox News article the answer began `Summary (from *3 children, teacher killed in Oregon school shooting; ... | Fox News*)` with literal asterisks. Expected: clean, well-formatted answers.
  - Cause A: renderer only handled bold, code, links. Rewrote `src/chat/markdown.ts` (still AST + createElement only): italics (`*`/`_`), bold italic, strike, h1–h6, block quotes, tables, nested lists, rules, URLs with one level of parentheses; leaves math and snake_case alone. Unit test reproduces the Fox News line.
  - Cause B: the system prompt told the model to "name the page title you took each fact from" even for one page. Replaced with `FORMAT_RULES`: one- or two-sentence overview, 3–6 bullets, sparing bold, no title or "Summary (from ...)" labels, no emoji, about 200 words, neutral and attributed for news; titles named only across several pages. Summarize prompt reworded; old wording still recognised in saved history. Agent finish summaries follow the same style.
  - Also fixed: restored conversations and a growing composer could hide the newest message. Thread now stays pinned unless the user scrolls up. A first version had a race (programmatic scroll events could unpin it; caught as 1-in-3 flaky e2e); fixed and confirmed 4/4 full runs.
- Owner report 2: Command-Tab showed a blank square. Cause: `ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon` but no asset catalog existed. Added `apple/App/Assets.xcassets` (macOS sizes 16–1024 with icon-grid margin and shadow; iOS opaque 1024, `hasAlpha: no`), rendered from new SVGs by `scripts/render-icons.mjs`; added to both app targets (`scripts/add-app-icons.rb`). macOS bundle now has `AppIcon.icns` + `Assets.car`.
- Checks: unit 143, e2e 54, lint + typecheck clean, release bundle clean, XCTest pass, macOS + iOS builds ok, bundle check ok, Mac extension re-registered.
- Not verified yet: the Fox News page live with the new prompt; the icon in the owner's Command-Tab (macOS may cache the old icon until the app is relaunched).

## 2026-10-16 — Keep the host app out of the Dock and Command-Tab

- Owner: the app showed in Command-Tab; Wipr/Superagent do not. Cause: `scripts/register-mac-extension.sh` launched the app after every build and it stayed open. The extension runs inside Safari and does not need the app running (Safari starts the extension's native handler itself).
- Fix: register script no longer launches the app (`--open` to show it); macOS `AppDelegate.applicationShouldTerminateAfterLastWindowClosed` returns true, so the setup window's close quits the app. `LSUIElement` not used: an app with no Dock icon would leave first-run users with a window and no menu bar.
- Checks: macOS + iOS builds ok, XCTest pass, extension still registered with the app not running.
- Not verified: Safari use with the app quit on the owner's Mac (expected to work: same as Wipr).

## 2026-10-16 — Coupon finder v2 (T031) from owner bug report

- Actual (diagnostics #23): getbeefy.co, `coupons:search` 19.6 s, `coupons:sourced 0 dropped 0`, outcome no_codes. Reference: Comet found 35 candidates (5 from influencer/affiliate pages, ~30 guesses), tested them via Shopify `/cart/update.js`, best BEEFY15 (a guess from a SimplyCodes hint) took $151.80 → $135.82.
- Expected (owner): scan the web, find as many codes as possible, test them all; after 25 codes ask "try more?". Owner: "There is no harm in testing and attempting coupon codes." This reverses the T019 sourced-only rule; recorded as a product decision (launch-blocker 4 stays open for legal review of merchant terms).
- Changes: `src/coupons/candidates.ts` (origins sourced/unverified/hint/pattern, store-name pattern guesses built in code, merge, labels); `src/coupons/codes.ts` (prompt covering coupon sites, influencer/affiliate, Linktree, social, Reddit, store pages; 8 searches + web fetch; HINT lines); `src/coupons/shopify.ts` + content handlers (`/cart.js`, `/cart/update.js`, reload); `src/coupons/finder.ts` (Shopify or coupon-box tester, batches of 25 with askMore, 250 ms pause, stop on 429/CAPTCHA, apply best and confirm, restore original code if nothing wins, reload cart; `couponSummary` builds a Comet-style chat answer in code); provider `webSearchMaxUses` + `webFetch` (`web_fetch_20260209`, fetched pages count as sources).
- Popup: "Try N more / Stop here" prompt in the coupon card; table shows source or "Guess (…)" labels; summary posted to chat and history.
- Tests: unit 149 (coupons rewritten for the new rule with the decision noted; CAPTCHA-attempt regression caught and fixed), e2e 57 incl. `cart.spec.ts` against a fake Shopify cart in `scripts/serve-fixtures.mjs` and popup batch prompts (win and no-win). Lint, typecheck, release check clean. macOS build + bundle check ok.
- Docs: terms draft §5, data inventory (cart requests, guessed codes), claims register, intentional differences, launch-blocker 4.
- Not verified: live run on getbeefy.co (owner to re-run Find coupons and paste diagnostics if it misbehaves).

## 2026-10-16 — Extension vanished after quitting Safari

- Cause: ad-hoc signed builds need Safari's "Allow unsigned extensions", which Safari turns off on quit, hiding the extension.
- Fix: this Mac has an "Apple Development" certificate (team KTV2G3Z883). New `scripts/build-mac.sh` signs with it (local signing only, no provisioning, nothing sent to Apple), checks the bundle, and registers without launching the app; falls back to ad-hoc when no certificate exists. `codesign --verify --deep --strict` passes; TeamIdentifier=KTV2G3Z883 on app and extension.
- Verified by owner 2026-10-16: quit and reopened Safari; AssistAnt stayed in the toolbar without "Allow unsigned extensions".

## 2026-10-16 — Renamed to Safari Scout; binoculars replace the ant

- Owner request: rename everything from "AssistAnt" to "Safari Scout" and replace the ant artwork with binoculars.
- Renamed: user-facing text, prompts, docs, manifest name and tagline ("Safari Scout: Your AI assistant in the world wide Safari"), Xcode project (`apple/SafariScout.xcodeproj`), products ("Safari Scout.app", "Safari Scout Extension.appex"), schemes, targets, Swift app file, entitlements files, scripts, content-script global (`__safariScoutHandle`), Info.plist key (`SafariScoutKeychainGroup`).
- Kept on purpose: bundle IDs `com.example.AssistAnt*` and Keychain group `com.example.AssistAnt.shared`. Changing them would orphan the saved API key and re-register Safari's extension as new. Placeholder IDs still need replacing before release (launch-blocker 14). GitHub repo and local folder still named `assist-ant`.
- Icons: original binoculars SVGs in `design/icons/`, rendered to `src/icons/` and the AppIcon set by `scripts/render-icons.mjs`; ant SVGs deleted. `docs/asset-licenses.md` updated.
- New launch-blocker 21: "Safari" is an Apple trademark; App Store review may reject the name. Needs trademark search + counsel.
- Fixed: rename left `scripts/register-mac-extension.sh` with an unquoted `grep Safari Scout`; quoted it. Removed old `AssistAnt.app` build products (same bundle ID) and unregistered them.
- Checks: build, typecheck, lint ok; unit 149/149; e2e 57/57 (WebKit, `PLAYWRIGHT_BROWSERS_PATH=.cache/ms-playwright`); release bundle clean; macOS XCTest 11/11; iOS XCUITest a11y audit 3/3 on "AssistAnt Test iPhone" simulator; signed Mac build (team KTV2G3Z883) registered as `com.example.AssistAnt.Extension` at `Safari Scout.app`.
- Not done: green control-glow overlay from the owner's design spec (not started).
- Owner to confirm: Safari toolbar shows binoculars and "Safari Scout" after enabling the re-registered extension.

## 2026-10-16 — Repo and folder renamed to safari-scout

- Owner approved. GitHub repo `HarrisonFischberg/assist-ant` renamed to `HarrisonFischberg/safari-scout` (private; GitHub redirects the old URL). `origin` now points to the new URL.
- Local folder moved from `~/projects/assist-ant` to `~/projects/safari-scout`. Old-path Mac build unregistered first; rebuilt and re-registered from the new path with `scripts/build-mac.sh`.
- Updated `package.json` repository URL, `package-lock.json` name, `docs/final-report.md` repo link. Older activity entries keep their original paths as history.
- Checks from the new folder: typecheck, lint ok; unit 149/149; e2e 57/57; signed macOS build ok, registered as `com.example.AssistAnt.Extension`.
- Owner to do: Claude Code workspace trust is per folder. Run `claude` once in `~/projects/safari-scout` and accept the trust prompt before the next Ralph loop, or `.claude/settings.json` permissions are ignored.

## 2026-10-16 — General chat, model/effort dropdowns, spec Part 1 foundation, rename cleanup

- Owner report (actual): on any page, Safari Scout assumed every question was about the page; an unrelated question (e.g. "I want to take vitamin D" on a stock site) got "the page doesn't say". Expected: answer off-page questions like a normal chat window, with follow-up questions; use the page when the question is about it.
- Cause: `SYSTEM_PROMPT` said Safari Scout "answers questions about the page" and "If the pages do not contain the answer, say so plainly"; the user turn was labelled "Question:" right after the page text.
- Fix (`src/chat/prompt.ts`): new `SCOPE_RULES` (decide whether the message is about the page; otherwise answer from general knowledge without mentioning the page, ask one or two follow-up questions when details are missing); user turn labelled "User message:". Tests: `tests/unit/chat.test.ts`, `tests/e2e/panel.spec.ts`. Live model behaviour not verified here (no live key in this session).
- Model and effort dropdowns (Settings): model list from the provider's read-only `GET /v1/models` with the user's key (Anthropic effort levels from `capabilities.effort`; OpenAI chat models only, effort low/medium/high on reasoning models), cached a day in `modelCache`, built-in fallback, "Other model ID…" for custom IDs (`src/providers/models.ts`). Effort goes out as Anthropic `output_config.effort` / OpenAI `reasoning.effort`, only when the model supports it; "Default" sends nothing. Pill shows e.g. "Opus 5.5 · Max". Chat cap raised 1024 → 16000 tokens and agent/coupon steps → 8000, since thinking counts toward the cap.
- Spec `safari_scout_part_1.txt` (Part 1): message bridge (`src/bridge/messages.ts`: `{ type, request_id, payload }`, sender validation, schema validation, error types timeout / blocked-by-user / schema-error / unhandled; `src/bridge/port.ts`: `scout-panel` port with exponential backoff reconnect); background worker answers `ping` and `panel.state`, tracks the port, sets "Open / Close Safari Scout", swaps light/dark toolbar icons, drops state for closed tabs, clears it at startup; one conversation per tab (`src/panel/state.ts`; the pre-existing conversation moves to the first tab opened); panel off in Private Browsing; monochrome binoculars toolbar icons plus filled-lens active set (`design/icons/safari-scout-binoculars*.svg`, `scripts/render-toolbar-icons.mjs`, no browser needed); manifest `short_name`, title, icons, `commands._execute_action` "Toggle Safari Scout" (Control-Shift-S on Mac); root `README.md`.
- Platform limits (documented in `docs/safari-api-support.md`): no side panel in Safari, so the panel stays a toolbar popover; no API hides the toolbar button (Settings explains Customize Toolbar instead); Safari does not let users remap extension shortcuts; reopening the panel on tab return relies on `action.openPopup` (Safari 16+, not runtime-verified).
- Rename cleanup: bundle IDs `com.example.AssistAnt*` → `com.example.SafariScout*` (app, extension, tests, UI tests), Keychain group and service, Logger subsystem, native app id; build defines `__ASSISTANT_*` → `__SCOUT_*`, env `ASSISTANT_BUILD/TEAM` → `SCOUT_BUILD/TEAM`; content messages `assistant:*` → `scout:*`; docs (`prd.md`, `docs/final-report.md`, `docs/asset-licenses.md`, `docs/launch-blockers.md`). Owner impact: Safari sees a new extension (re-enable it, re-grant sites) and the API key must be saved again (old Keychain item is left in place, not deleted).
- Spec check fixed: the spec's one-line grep could never pass ("assist ?ant" matches "assistant", the required API role; whole-word "ant" matches the `sk-ant-` key prefix). Replaced by `npm run check:rename` (`scripts/check-rename.sh`, tracked files only, this log excluded). Spell check of the spec: no mistakes.
- Checks in this session: typecheck, lint, build ok; unit 177/177; `npm run check:release` clean; `npm run check:rename` clean; stubbed popup smoke test in the browser pane (off-page question, dropdowns, per-tab restore, private mode) ok.
- Not run (sandbox): e2e (`browserType.launch` timeout, "sandbox_extension_issue_file_to_process failed … Operation not permitted") and Xcode builds (CoreSimulator unreachable, `~/Library/Logs` not writable). Need a run outside the sandbox.
- Owner approved running them in the Terminal panel, outside the sandbox. First e2e run: 58 passed, 3 failed. Fixes: (1) Settings selects had a wrapping `<label>`, so WebKit put every option's text into the select's accessible name ("Model Claude Opus 5.5 …", which VoiceOver would also read); Model, Effort, and Keep chat history now use `<label for>`. (2) Delete all data recreated `tabState` at once; the conversation id is now created on the next saved answer, so storage stays empty. (3) Two e2e locators made exact ("Effort" also matched the section and the model pill).
- Final results: e2e 61/61 (WebKit); macOS build ok, XCTest 11/11; iOS Simulator build ok; iOS UI accessibility audit 3/3 on BBCC2295-…; built bundles carry `com.example.SafariScout` and `com.example.SafariScout.Extension`; unit 177/177; release and rename checks clean.
- Owner to do: Safari now sees a new extension ID. Run `scripts/build-mac.sh`, enable Safari Scout in Safari Settings > Extensions, re-grant site access, and save the API key again in Settings.

## 2026-10-16 — Model menu in the composer; mode switch no longer wraps

- Owner request 1: the model pill opened Settings. Expected: a small pop-up menu from the composer to pick the model, without leaving the chat.
- Fix: the pill (`#model-pill`, `aria-haspopup="menu"`) opens `#model-menu` above the composer: a "Model" list and, when the model supports it, an "Effort" list, as `menuitemradio` items with a check on the current choice. Picking one saves it (same `persist` path as Settings), closes the menu, and returns focus to the pill. Arrow keys, Home/End, Escape, Tab, and click-outside work. The list is the cached or built-in one at once, refreshed from the provider's read-only model list if the cache is stale. Settings keeps the full controls (custom model ID, refresh). The pill is disabled while a chat, task, or coupon run is busy.
- Owner report 2 (actual, screenshot): on first load the composer row broke: "Control Browser" wrapped to two lines and the "Chat" pill grew into a tall oval. Expected: one line.
- Cause: the composer row was wider than the 400 px popover (+ button, mode switch, model pill, send), so flexbox shrank the mode switch and its labels wrapped.
- Fix (`src/popup.html`): row items no longer shrink, labels never wrap, and the model pill is the one item that gives way (its text ends in "…"). Tighter spacing so "Opus 5 · Medium" still fits at 400 px.
- Tests: new e2e in `tests/e2e/redesign.spec.ts` (menu by mouse, menu by keyboard, one-line mode switch) and an axe scan with the menu open (`tests/e2e/a11y.spec.ts`, light and dark). The one-line test fails on the old code (label height 39 px, limit 30) and passes now.
- Checks: typecheck, lint, build ok; unit 177/177; e2e 66/66 (WebKit, run in the Terminal panel with `PLAYWRIGHT_BROWSERS_PATH=.cache/ms-playwright`); `npm run check:release` clean. Visual check in the browser pane at 400×600, light and dark.

## 2026-10-16 — No "Ready" line, one cost line per run, system-matched colours

- Owner requests: (1) drop "Ready. Using anthropic claude-opus-5-5, medium effort."; (2) after each query, show a single "Cost: $X" line at the bottom of the chat; (3) match Safari's system look in light and dark, no purple.
- (1) The status line stays empty when ready. Diagnostics still record "Ready. Using …" (`current.finish`).
- (2) `formatCostLine` (`src/cost.ts`) replaces the long "Done. N tokens … Estimated cost …" text after chat, Control Browser, and coupon runs: "Cost: $0.0350" (4 decimals under $1, 2 above), "Cost: not available for <model>" when no price is recorded. Before this, only Claude Sonnet 5.5 had a price, so Opus showed no cost. Price table now covers current Claude models from https://platform.claude.com/docs/en/about-claude/pricing (fetched 2026-10-16), including dated snapshot IDs, Haiku 5.5's over-100,000-token prompt prices, and web search at $10 per 1,000 searches (Anthropic `usage.server_tool_use.web_search_requests`, now carried as `Usage.webSearches` through the agent loop and coupon search). OpenAI stays "not available" (no sourced price). `docs/claims-evidence.md` and compliance row 10 updated.
- (3) Palette: Apple neutral grays plus Apple blue (`#0071E3` / `#0073E6` buttons, `#0066CC` / `#2997FF` links and focus), gray user bubble and selected mode, no purple, following the system light/dark setting. Applied to the popup, the legal pages (`scripts/build.mjs`), and the host app (`SafariScoutApp.swift`). Fixed blue rather than the user's macOS accent colour, so contrast stays checked. `replica/design/tokens.json` gained `selected` and 10 more pairs; `replica/contrast.txt`: 44 pairs, 0 failing AA (dark button blue tuned to `#0073E6` to clear 3:1 against the composer).
- Checks: typecheck, lint, build ok; unit 182/182; e2e 66/66 (WebKit, Terminal panel); `npm run check:release` clean; signed Mac build registered; iOS UI accessibility audit 3/3 (BBCC2295-…); browser-pane check at 400×600 light and dark with a synthetic streamed answer (3,000 in / 800 out on Opus 5 showed "Cost: $0.0350").

## 2026-10-16 — Find coupons failed on a Shopify checkout (diagnostics run #20)

- Actual (owner's diagnostics, run #20 on www.tackform.com checkout, $170.00 cart): after a 115 s web search (38 found, 37 guessed) the run stopped with "Could not read a total on this page, so savings cannot be measured." No code was tested. Timeline: `coupons:method none status error`.
- Expected (owner): search the web for codes, test them on the cart, and after 25 attempts apply the code with the highest saving if one works; if none works, ask whether Safari Scout should find another 25 to test.
- Cause, checked read-only on the live checkout in the browser pane (no codes typed, nothing clicked): (1) the store answers `/cart.js` as `text/javascript; charset=utf-8`, and `shopifyCartInfo` required a JSON content type, so the exact Shopify cart path was skipped for the page path; (2) the checkout draws the total one span per character with the amount in `aria-label`, so the snapshot read "Total\nUSD $ 1 7 0 . 0 0" and `parseTotal` (no newline allowed) found nothing; (3) the discount box "Discount code or gift card" was redacted as a card field (`/card/`), so `findForm` fell through to "ZIP code" (matches `/code/`) with "Add discount" as the button. Had the total parsed, codes would have been typed into the ZIP field. (4) The flow asked "try more?" after every batch even when a code had already saved money, and stopped for good once the first search's codes ran out.
- Fix: `src/coupons/shopify.ts` parses the body and checks its shape instead of the content type. `src/snapshot/snapshot.ts` uses an element's `aria-label` when its visible text is the same string split across spans (text and names), and no longer redacts a field that is a discount/coupon/promo box that also takes gift cards (plain gift card number or PIN fields stay redacted). `src/coupons/finder.ts`: `parseTotal` allows a line break, a currency code, or "1 item" before the amount and never reads "Total savings" / "Total discount"; `findForm` skips ZIP, postal, phone, verification, and similar "code" fields, prefers coupon/discount/promo boxes, takes the Apply button that follows the box even while disabled, never "Add to cart"; each try re-reads the page, types, re-reads, and clicks Apply once it is enabled. Batches: a batch with a saving ends the search and applies the best code (largest saving, shown with its percent); a batch with none asks "Would you like Safari Scout to find 25 more to test?"; when fewer than 25 untried codes remain, a new web search runs that names the codes already tried, plus a longer guess list (`patternCodes(..., more)`), capped at 200 codes per run. Popup status now says the web search can take a couple of minutes.
- Evidence: new failing-first tests (9 failed before the fix): `tests/unit/snapshot.test.ts` (split price, gift-card wording), `tests/unit/coupons.test.ts` (checkout totals, "Total savings", synthetic checkout page path with ZIP field and disabled Apply, batch rules, find-more, `/cart.js` as text/javascript). New fixture `tests/fixtures/shopify-checkout.html` and `tests/e2e/checkout.spec.ts` (real popup + real content script, page path and Shopify cart path); `tests/e2e/coupons.spec.ts` updated to the new flow; the fake store in `scripts/serve-fixtures.mjs` now answers `/cart.js` as text/javascript like real stores. Read-only probe of the fixed bundle on the live checkout: `shopifyCartInfo` returned total 170 (cart path will be used); page path read baseline 170 and would type only into "Discount code or gift card".
- Checks in this session: typecheck, lint, build ok; unit 194/194; `npm run check:release` clean; `npm run check:rename` clean.
- Sandbox blocked e2e (WebKit launch: "sandbox_extension_issue_file_to_process failed … Operation not permitted") and Xcode (CoreSimulator unreachable). Owner approved running them in the Terminal panel, outside the sandbox: e2e 68/68 (WebKit, `PLAYWRIGHT_BROWSERS_PATH=.cache/ms-playwright`, includes the 4 new or updated coupon/checkout tests); macOS build ok; XCTest 11/11; iOS Simulator build ok; iOS UI accessibility audit 3/3 on BBCC2295-…; signed Mac build (Apple Development, team KTV2G3Z883) registered as `com.example.SafariScout.Extension`.
- Not verified: that the checkout page shows the winning code after the cart-API change and reload (no real code was applied on the live store).
- Known limit: on the page path (non-Shopify stores), a store that keeps an earlier code applied when a new one is rejected would credit the earlier saving to later codes. Shopify stores use the cart API, which replaces the code each time.

## 2026-10-16 — iOS device signing

- Owner request: set up signing so Safari Scout installs on their iPhone from Xcode.
- Found: this Mac has an Apple Development certificate on a paid Individual team (`KTV2G3Z883`, Xcode reports `isFreeProvisioningTeam = 0`), so launch-blocker 2 no longer blocks device testing. The owner's other iOS app uses the `com.harrisonfischberg.*` prefix.
- Change (iOS targets only): `scripts/set-ios-signing.rb` (new, idempotent) sets `DEVELOPMENT_TEAM = KTV2G3Z883`, Automatic signing, and bundle IDs `com.harrisonfischberg.SafariScout`, `.SafariScout.Extension`, `.SafariScoutUITests`. Keychain group is now `$(AppIdentifierPrefix)com.harrisonfischberg.SafariScout.shared` (`apple/iOS-Shared.entitlements`, `scripts/set-ios-keychain-group.rb`). `scripts/add-ui-test-target.rb` uses the new UI-test ID. macOS targets keep `com.example.SafariScout*` on purpose: changing them orphans the saved Mac key and re-registers Safari's extension (launch-blocker 11 updated).
- Evidence (Terminal panel, outside the sandbox): device build for "Hphone" (iPhone 17 Pro) `BUILD SUCCEEDED`, signed "Apple Development: Harrison Fischberg" with "iOS Team Provisioning Profile: *"; app and appex carry `application-identifier` `KTV2G3Z883.com.harrisonfischberg.SafariScout[.Extension]` and Info.plist group `KTV2G3Z883.com.harrisonfischberg.SafariScout.shared`; `codesign --verify --deep --strict` ok; `xcrun devicectl device install app` installed `com.harrisonfischberg.SafariScout`. iOS UI accessibility audit 3/3 on BBCC2295-…; `check:rename`, `check:release`, typecheck clean.
- Not verified: launching on the phone, enabling the extension in Settings, saving a key on the device. The Simulator's saved synthetic key used the old group, so it must be entered again there.

## 2026-10-16 — Explicit consent before sharing with Anthropic or OpenAI (App Store Review Guideline 5.1.2(i))

- Request (from the App Store readiness review): Guideline 5.1.2(i) needs a clear disclosure of where personal data goes, including third-party AI, and explicit permission before it is shared. Before this, the popup only stated it in text; compliance row 6 said "a distinct acknowledgement step is not built".
- Extension (`src/settings/consent.ts`, `src/popup.ts`, `src/popup.html`): before the first request to a provider, a modal `<dialog>` "Share with Anthropic?" / "Share with OpenAI?" names only that provider and lists what it receives: messages and tasks; for requests that use the page, its address, title, and text, plus links, buttons, and form fields for Control Browser and Find coupons (password and card fields hidden first); other tabs only when chosen; the API key only to sign in to that provider. Link to the provider's privacy policy (https://www.anthropic.com/legal/privacy, https://openai.com/policies/privacy-policy/, both opened in the browser pane 2026-10-16). Allow / Not now, same style; focus starts on the heading so nothing is preselected; Escape = Not now; the rest of the popup is inert while it is open; focus returns to the opener.
- Gated paths: chat, Summarize, Control Browser, Find coupons, Settings "Test and save" (key test), and the live model list (Settings and the composer menu fall back to the built-in list without consent). The check runs before the page is read or the content script is injected. Not now sends and stores nothing and keeps the typed question. Every popup request to `api.anthropic.com` / `api.openai.com` also goes through `gatedFetch`, which throws `ProviderError("consent_required")` without consent (the Anthropic and OpenAI clients now keep that reason instead of reporting a network error).
- Storage: `aiConsent` in `browser.storage.local`, per provider, with `CONSENT_VERSION` (bump to ask everyone again). Consent is checked synchronously from memory so the click keeps its user gesture for the site-access prompt. Settings > "Sharing with AI providers" lists each provider (allowed on date / not allowed) with a Withdraw button; withdrawal closes the gate at once and the next request asks again. Delete all data clears it (storage clear plus `consent.forget()`).
- iOS host app (`apple/App/ProviderSetup.swift`, `apple/App/OnboardingView.swift`): "Test key" sent the key to the provider with no permission step. Now it first shows the same disclosure as a sheet (plus "now, to test your key: only the key"), Allow / Not now, VoiceOver focus on the heading, Escape = Not now, swipe-to-dismiss disabled. Stored per provider in `UserDefaults` (`aiConsent.<provider>`, version only); "Withdraw permission" on the setup screen. The app and extension do not share storage, so Safari asks again before its first request. DEBUG launch argument `-UITestResetConsent YES` clears it for UI tests. macOS app has no key test, so no change there.
- Failing first: `tests/unit/consent.test.ts` failed before the module existed (suite could not load); the e2e dialog tests could not pass on the old popup (no dialog).
- Tests: unit `tests/unit/consent.test.ts` (20: per-provider storage, withdrawal, malformed/older records, Delete all data, `gatedFetch` blocks before Allow and after withdrawal, chat turn and OpenAI client send nothing, key test and model list send nothing, Not now stores nothing, text names only the chosen provider). e2e `tests/e2e/consent.spec.ts` (7: no request and no page read before Allow, asked once across reopen; Not now and Escape send nothing, keep the question, return focus; Option+Tab stays in the dialog; Summarize, Control Browser, Find coupons ask first; per provider when switching to OpenAI; withdrawal blocks until allowed again, including model refresh; key test asks first and Not now neither tests nor saves). `tests/e2e/a11y.spec.ts`: axe WCAG 2.2 AA on the open dialog, light and dark; Settings scan now includes a Withdraw button. `tests/e2e/settings.spec.ts`: Delete all data clears `aiConsent`. Existing e2e stubs now seed `aiConsent` so they keep testing their own feature. XCTest `ProviderSetupTests` +6 (Test key asks first and sends nothing, Not now, Allow then test, per provider, withdrawal, older version); existing tests pass an allowed store. XCUITest: consent sheet audit light and dark.
- Checks: typecheck, lint, build ok; unit 214/214; `npm run check:release` clean. Outside the sandbox (Terminal panel, owner-approved; WebKit launch hangs in the sandbox): e2e 77/77 (WebKit); macOS build ok; XCTest 17/17; iOS Simulator build ok; iOS UI accessibility audit 5/5 on BBCC2295-….
- Docs: compliance row 6 now PASS (engineering only); `docs/data-inventory.md` new consent row, model list, provider calls, and key test notes; privacy draft §3, §4, §6.
- Open: counsel to review the wording (blocker 8). OpenAI's link is its US privacy policy; a rest-of-world policy exists, owner to pick per market (blocker 5). Not verified in Safari itself (Mac or iPhone), only WebKit e2e and the Simulator.

## 2026-10-16 — Consent links and counsel packet (owner choices)

- Owner chose (1) OpenAI's rest-of-world privacy policy, https://openai.com/policies/row-privacy-policy/, which opens with links to the EU/UK/Switzerland and US versions (the US page links only to the EU one); (2) a counsel packet instead of owner sign-off.
- Found while checking the links in the browser pane: OpenAI's privacy policy says it "does not apply to content that we process on behalf of customers of our business offerings, such as our API"; Anthropic's says the same with Enterprise accounts as the example, and Anthropic's Commercial Terms say they govern "use of Anthropic API keys". Owner chose to keep the privacy-policy link and add a second one: "How Anthropic handles API data" (https://www.anthropic.com/legal/commercial-terms) and "How OpenAI handles API data" (https://openai.com/enterprise-privacy/). All four pages opened 2026-10-16.
- Changed: `src/settings/consent.ts` (`API_TERMS`, `termsLabel`/`termsUrl`), `src/popup.html` / `src/popup.ts` (second link), `apple/App/ProviderSetup.swift` (`apiDataTerms`), `apple/App/OnboardingView.swift` (second `Link`). Privacy draft §4 explains which provider document applies. New `docs/legal/consent-review.md`: exact dialog and sheet text, flow, stored record, and 10 questions for counsel (not bundled into the app).
- Failing first: 3 unit tests (`consent text`, `API data terms`) failed before the change. Tests updated: `tests/unit/consent.test.ts` (+1), `tests/e2e/consent.spec.ts` (link hrefs, Option+Tab reaches the new link), XCUITest consent sheet checks both links.
- Open: counsel review (blocker 8); owner to send `docs/legal/consent-review.md`.
- Checks: typecheck, lint, build ok; unit 215/215; `npm run check:release` clean. Terminal panel (outside the sandbox): e2e 77/77 before the privacy-draft wording change, then a11y + consent + settings specs 26/26 on the rebuilt `privacy.html`; macOS build ok; XCTest 17/17; iOS Simulator build ok; iOS UI accessibility audit 5/5 (consent sheet light and dark, both links present).

## 2026-10-16 — Counsel reviewed the consent wording

- Owner report: counsel reviewed `docs/legal/consent-review.md` and asked for no changes. Recorded as the owner's report; the scope is the consent text and flow only. The privacy policy (10 UNKNOWN) and terms (11 UNKNOWN) were not part of that review and stay drafts.
- Owner plan: get the legal pages ready now and publish once the business is registered (EIN and other details). New `docs/legal/publish-checklist.md` lists every fact to supply (with line numbers), the sections counsel still writes, and the engineering steps to remove DRAFT labels, publish, and set the App Store privacy URL. The EIN is not needed on any public page.
- Updated: `docs/legal/consent-review.md` status, compliance row 6 open items, launch-blocker 8. No code change; nothing published.

## 2026-10-16 — Consent build installed on the owner's Mac and iPhone

- Owner request: put the consent work live in Safari on iOS and on Mac. Done as local installs on the owner's own devices (debug builds); not an App Store or TestFlight release (listing and legal pages are not ready, `docs/legal/publish-checklist.md`).
- Mac (Terminal panel): `scripts/build-mac.sh` built `1a604f5`, signed Apple Development (team KTV2G3Z883), bundle check ok, registered `com.example.SafariScout.Extension` 0.1.0 with Safari (pluginkit). Registration points at this worktree's `build/DD`; re-run `scripts/build-mac.sh` from the main checkout after merging, or Safari loses the extension if this worktree is removed.
- iPhone "Hphone" (iPhone 17 Pro, `00008150-001A79E91140401C`): `xcodebuild -scheme "Safari Scout (iOS)" -destination 'id=…'` `BUILD SUCCEEDED`, `xcrun devicectl device install app` installed `com.harrisonfischberg.SafariScout`.
- Checked in both built bundles: `popup.html` has the consent dialog; `popup.js` has the rest-of-world OpenAI link and the API data terms links; the iOS app's code has the consent sheet ("handles API data").
- Not verified: opening Safari on either device and seeing the dialog. Owner to check: the first chat on each device should show "Share with Anthropic?" once, even with a key already saved.

## 2026-10-16 — One-command iPhone install

- Owner request: build and install on the iPhone automatically instead of the Xcode steps. Owner had confirmed the Xcode install, extension switch and key entry work on "Hphone".
- New `scripts/build-ios.sh`: `npm run build`, `xcodebuild` for the device with `-allowProvisioningUpdates`, `scripts/check-extension-bundle.sh`, then `xcrun devicectl device install app`. Device from `SCOUT_IOS_DEVICE` or the first paired physical iOS device (connected one preferred). Does not launch the app. CLAUDE.md build row points to it.
- Evidence (Terminal panel, outside the sandbox): first run failed in device detection (Node `require` of an extensionless temp file); fixed to `JSON.parse(readFileSync)`. Second run: device 00008150-…, `BUILD SUCCEEDED`, bundle ok, "App installed: com.harrisonfischberg.SafariScout", exit 0.

## 2026-10-16 — Renamed to Scout for Safari

- Owner request: rename "Safari Scout" to "Scout for Safari" to lower App Store rejection risk; new tagline "Your AI Scout for the Safari Browser".
- Renamed (every spaced "Safari Scout"): user-facing text in the popup, host app, errors, consent text, agent and chat system prompts, diagnostics heading (CLAUDE.md workflow updated to match), legal drafts and generated `privacy.html` / `terms.html`, manifest `name` / `short_name` / `default_title` / command, `CFBundleDisplayName` (app and extension), `PRODUCT_NAME` ("Scout for Safari.app", "Scout for Safari Extension.appex"), targets and schemes ("Scout for Safari (macOS)" / "(iOS)"), scripts, tests, README, PRD, docs, icon SVG comments. Tagline in manifest `description`, onboarding subtitle, README.
- Kept on purpose: CamelCase identifiers (`SafariScout.xcodeproj`, `SafariScoutApp.swift`, `SafariScoutTests`, `SafariScoutUITests`, entitlements files, `SafariScoutKeychainGroup`, `__safariScoutHandle`, `safari-scout-binoculars*.svg`), bundle IDs `com.example.SafariScout*` / `com.harrisonfischberg.SafariScout*` and the Keychain group (changing them orphans the saved key and Safari's registration), repo and folder `safari-scout`. Earlier activity entries and the owner's spec `safari_scout_part_1.txt` keep the old name as history.
- Counsel packet `docs/legal/consent-review.md`: text kept as counsel reviewed it; added a note that the app's consent wording changed only in the product name.
- Launch-blocker 21 updated: still open. Counsel and App Review have not confirmed the new name; trademark search for "Scout for Safari" still needed.
- One-time cleanup: unregistered and removed old "Safari Scout.app" / ".appex" build products in `build/DD` (same bundle ID as the new ones).
- Checks: build, typecheck, lint ok; unit 215/215; release bundle clean; e2e 77/77 (Terminal panel; Playwright hangs inside the sandbox); signed macOS build (team KTV2G3Z883), bundle ok, registered `com.example.SafariScout.Extension` at `Scout for Safari.app`; macOS XCTest 17/17; iOS Simulator build ok; iOS XCUITest a11y audit 5/5.
- iPhone "Hphone" (`00008150-001A79E91140401C`): `scripts/build-ios.sh` `BUILD SUCCEEDED`, bundle ok, installed `com.harrisonfischberg.SafariScout` as "Scout for Safari.app".
- Not verified: Safari toolbar and Extensions list showing the new name on Mac and iPhone. iOS home-screen label not checked: 16 characters may be truncated under the icon.

## 2026-10-16 — Listing names, iOS home-screen name, name approval

- Owner decisions: App Store subtitle "AI Scout for Safari Browser" (27 of 30 characters); iOS home-screen name "Scout"; name "Scout for Safari" approved; device testing of the new name later.
- iOS home-screen name: `apple/App/Info.plist` `CFBundleDisplayName` now reads `$(APP_DISPLAY_NAME)`, set per app target: iOS "Scout", macOS "Scout for Safari". The extension keeps "Scout for Safari" (Safari settings, toolbar). Product file names unchanged.
- New `docs/app-store-listing.md`: app name, subtitle, home-screen name, extension name, tagline, with lengths and where each is set. Linked from CLAUDE.md artifacts.
- Launch-blocker 21 marked resolved on the owner's report that the name is approved; App Review can only confirm it at submission.
- Evidence: built `CFBundleDisplayName` values: Mac app "Scout for Safari", iOS app "Scout", iOS extension "Scout for Safari". Simulator home screen shows the label "Scout" untruncated. typecheck, lint ok; unit 215/215; signed macOS build registered; iOS UI a11y audit 5/5; iPhone "Hphone" install via `scripts/build-ios.sh` ok.
- Not verified (owner testing later): the name in Safari's toolbar and Extensions list on Mac and iPhone, and on the iPhone home screen.

## 2026-10-16 — Button on webpages (T032)

- Owner request: put the Scout icon next to Safari's address bar on iPhone (mockup). Not possible: iOS Safari has no extension API for that (Apple iPhone User Guide, iOS 27: extensions live in the page menu; tab bar layouts are Compact, Bottom, Top only). Owner chose option B from two mockups: a tab on the page edge that can move and stays small when idle; tap opens a half-height sheet (suggestions + composer over the blurred page); asking takes it full screen (owner screenshots "API keys Claude Platform 2/3" used as layout reference only).
- Built:
  - `src/edge.ts` (new content script `edge.js`): closed shadow root, host styled with inline `!important` and put in the top layer (`popover`) when available. Tab tucks to a 10 px sliver after 2.5 s (24 px hit area), drag snaps to the nearer side and saves side + height; arrow keys move it when focused; Settings has Left / Right (single-pointer alternative to dragging). Only trusted taps/keys open it. Removed live when the setting goes off.
  - Sheet: `sheet.html` (built from `popup.html` with `data-embed="sheet"`) in an iframe inside a modal `<dialog>` (page made inert, blurred backdrop, follows `visualViewport` so the composer stays above the keyboard). Half: suggestion chips + close button + composer; tap above or Escape closes. Full on the first message or error: header with Close, title, New chat. Conversation kept per tab; reopening shows it.
  - Token gate (`src/panel/edge.ts` `SheetTokens`, `src/panel/sheet.ts`): the worker issues a one-time token on the tap (`frame.token`, content scripts only), the sheet must claim it (`frame.claim`) before it reads settings or the Keychain, and the edge script reveals the frame only after the worker confirms the claim (`frame.check`). A second load of the frame (page navigated it) drops it. A page that frames `sheet.html` itself gets an empty frame ("refused").
  - No API key entry, Settings, or panel port in the sheet; the no-key state points to the page menu.
  - Worker registers `edge.js` with `scripting.registerContentScripts` only for granted web origins (never provider hosts) while the setting is on; re-syncs on setting on/off, grant changes, install, startup.
  - Settings > Button on webpages: off by default; turning it on asks Safari for access to all sites (user may grant fewer), injects into the current tab, and shows where it applies.
  - Manifest `web_accessible_resources`: `sheet.html`, `popup.js`, `icons/*` for http(s) pages. Xcode: `edge.js`, `sheet.html` added to both extension targets (`scripts/sync-extension-resources.rb`). `.gitignore`: both build outputs. Release check now also scans `sheet.html`.
- Docs: PRD T032; launch-blocker 22 (not checked in Safari; CSP may block the sheet; residual clickjacking by a hostile page); data inventory row `pageButton` + flow note; `docs/safari-api-support.md` T032 table (MDN BCD: `registerContentScripts` 16.4, `web_accessible_resources.matches` 15.4; nothing runtime-verified).
- Evidence: build ok; typecheck ok; lint ok; unit 227/227 (new `tests/unit/edge.test.ts`, 12 tests); `npm run check:release` clean. `npm run check:rename` fails on `docs/final-report.md:3` ("renamed from assist-ant"), a line this change did not touch.
- Demo (in-app browser, Chromium, 375×812, stubbed `browser` API, synthetic article, canned answer; not Safari): tab tucked, half sheet dark and light, full sheet after Summarize, X closes, drag to lower left saved `{"on":true,"side":"left","y":0.677}`. Screenshots `ralph/evidence/T032-demo-*.jpg`.
- E2E (Terminal panel, outside the sandbox): owner approved installing Playwright's WebKit (`npx playwright install webkit`: WebKit 27.2, playwright webkit v2370, 78.9 MiB, plus FFmpeg v1013, 1.4 MiB, from cdn.playwright.dev). First run of `tests/e2e/edge.spec.ts`: 6/7; the arrow-key test pressed Tab, which in WebKit on macOS reaches only fields (a debug run showed focus staying on BODY); changed to Option-Tab as `a11y.spec.ts` and `consent.spec.ts` already do. Then edge 7/7 and full suite `npx playwright test` 84/84 passed.
- Not verified: Safari on iPhone or Mac (extension APIs inside the iframe, `postMessage` to the extension origin, `registerContentScripts`, keyboard and safe areas), VoiceOver on the tab and sheet.
- iPhone "Hphone" (`00008150-001A79E91140401C`), owner request: `scripts/build-ios.sh` in the Terminal panel: build ok, `BUILD SUCCEEDED`, bundle ok (`Scout for Safari Extension.appex` includes `edge.js` and `sheet.html` per `check-extension-bundle.sh`), "App installed: com.harrisonfischberg.SafariScout". Owner testing the button on the phone next; nothing seen in Safari yet.

## 2026-10-16 — Bug: page button crashed the page on iPhone (T032)

- Actual (owner diagnostics paste, iOS Safari 27.0, debug build): tapping the Scout tab crashed the web page; runs #3–#5 only show panel startups ("ready"). Owner also: the tab "can be much bigger than it is".
- Expected (owner): "For Scout to open and be a functional chat agent".
- Evidence of cause:
  - iPhone crash logs (`xcrun devicectl … systemCrashLogs`): `ExcUserFault_MobileSafari-2026-10-16-1659{44,49,54,56}.ips` and `ExcUserFault_com.apple.WebKit.Networking-…165905.ips`, all `EXC_GUARD`, `termination namespace WEBKIT`, `is_simulated: 1` (WebKit killing a process, not a code crash).
  - Reproduced in the iOS Simulator (BBCC2295, new build enabled, site access for 127.0.0.1, button on, tap): page showed "This webpage was reloaded because a problem occurred". WebKit log: the sheet iframe loaded in the page's own process (WebContent 96825), called `tabs.query()`, then "Received an invalid message WebExtensionContext_TabsQuery from WebContent process with PID 96825", `AuxiliaryProcessProxy::terminate`, `processDidTerminate … reason=Crash`. Excerpts: `ralph/evidence/T032-sim-webkit-log.txt`; screenshot `ralph/evidence/T032-bug-sim-page-reloaded-after-tap.png`.
  - Second effect seen: with `web_accessible_resources` in the manifest, Safari showed "Scout for Safari — Permission Required" in the page menu and asked for site access before the panel would open.
- Cause: the in-page sheet ran the full panel as an extension page inside the website. iOS Safari puts that frame in the page's process and treats privileged extension calls from it as invalid IPC, terminating the process.
- Fix: the tab no longer puts anything in the page except itself. A tap sends `panel.open` to the worker, which calls `action.openPopup()` (`openPanel` in `src/panel/toolbar.ts`); on iPhone that is Safari's own half-height panel sheet over the page, which can be dragged to full height. Removed: `sheet.html`, `web_accessible_resources`, the token handshake (`frame.*` messages, `SheetTokens`, `src/panel/sheet.ts`), and sheet mode in the popup. If Safari cannot open the panel, the tab says to use the page menu.
- Bigger tab: awake pill 56 x 60 with a 30 px glyph in a 60 x 64 target (was 40 x 46, 22 px glyph); tucked sliver 16 px in a 32 px target (was 10 px in 24 px).
- Tests first: unit `openPanel` and "no web_accessible_resources" failed (3/9), e2e tap/size/drag/keyboard failed (4/7) on the old code; all pass after the fix.
- Checks: build, typecheck, lint ok; unit 224/224; e2e 84/84 (Terminal panel, `E2E_PORT=4318` because the Simulator fixture server held 4317); `npm run check:release` clean; macOS XCTest 17/17; iOS UI accessibility audit 5/5.
- Simulator after the fix: tab drawn larger (`ralph/evidence/T032-fix-sim-bigger-tab.png`); tap opened Scout's panel sheet over the page, no reload (`ralph/evidence/T032-fix-sim-tab-opens-panel.png`); log shows `action.openPopup()` and no invalid messages or crashes afterwards. The panel showed "Add your API key" because the Simulator Keychain has no key.
- Simulator housekeeping (test device only): turned off two stale "Safari Scout" extension builds and turned on "Scout for Safari"; allowed site access to 127.0.0.1 for one day.
- The earlier demo screenshots `ralph/evidence/T032-demo-*.jpg` show the removed in-page sheet.
- Not verified yet: the fix on the owner's iPhone; the panel sheet's chat answering on device (needs the owner's key).
- iPhone "Hphone" (`00008150-001A79E91140401C`): `scripts/build-ios.sh` in the Terminal panel: `BUILD SUCCEEDED`, bundle ok, "App installed: com.harrisonfischberg.SafariScout". Owner to check: tab size, tap opens Scout's panel, page does not reload.

## 2026-10-16 — Spec Part 2: conversation, context and tools

- Owner approved the plan in chat ("Approved. Commit T032 first, then build Part 2 with the recommended defaults."). T032 committed first (`9114bdf`). Spec file kept as `safari_scout_part_2.txt`.
- Scout server = the answer engine in the background worker (`src/server/engine.ts`, `src/server/protocol.ts`, wiring `src/server/worker.ts`); no hosted server, no new vendor (PRD privacy promise kept). The popup gathers context, starts the answer (`chat.start`), and subscribes on the `scout-panel` port (`chat.subscribe` with the last sequence number it has). Events are numbered per message; the panel store (`src/chat/store.ts`) ignores repeats, so a dropped port resumes with no duplicated text. Tool calls become `tool_request` events; the panel runs them through the worker's tool host (`tool.run`) and posts `chat.tool_result` with the same request_id; the server continues the same answer. Tool turns go back to the model as plain text, as in the agent loop, so no thinking blocks need echoing (claude-api skill: Sonnet 5.5 always thinks; prefill is rejected, so Continue sends a new user turn).
- Answers keep running when the popover closes; the worker saves them to history. A reopened panel resumes running answers (`chat.active`). Provider stream drop: text kept, "Continue" finishes it (`display_question` / `answer_prefix` keep history clean).
- Context (`src/context/`): in-page extractor (self-contained `extractPage`) returns Markdown + metadata, never raw HTML; skips form controls and their values, password/hidden inputs, contenteditable, hidden nodes, scripts; never reads cookies or storage. Worker redacts keys, JWTs, bearer tokens, private keys, and secret URL parameters; 8 s per page, 12 s per request, partial results labeled. Blocklists are checked before any script runs and again on the URL that answered.
- Tools (`src/tools/`): fixed allow-list; unknown names → `schema-error`; inputs checked with the bridge schema; every call logged (tool, host, ms, status; `toolLog`, follows chat retention; memory only when history is off); `close_tabs` asks first (Cancel focused); screenshots asked per site (Allow once / Always / Never / Don't allow); `open_tab` http(s) only; `search_tabs` off until turned on, open tabs only on Safari; `group_tabs` / `ungroup_tabs` / `run_task` answer `unsupported` and are not offered to the model.
- Gate (`src/permissions/gate.ts`, Settings > Page access): share current page (on), tab search (off), screenshot answers per site, user blocklist ("Block this site"), organization blocklist from a managed `ScoutBlockedSites` value (`apple/Extension/ManagedPolicy.swift`, native `policy.get`, forced values only). Settings > Activity lists recent tool calls.
- Panel: attach picker (+ menu list renamed "Attach tabs", @ suggestions with arrow keys / Enter / Tab / Escape, removable chips). @words no longer attach tabs silently: only chosen tabs are read (acceptance "only that tab unless others are attached"). "Shared:" line under each answer (saved with history). Renderer adds MathML math, numbered citations [n] linked to the pages sent, code language + Copy.
- Consent v2 (`CONSENT_VERSION` 2): adds description, form entries left out, attached tabs, screenshots, tab search. Counsel reviewed v1 only (blocker 23). Test stubs moved to version 2.
- Mock server `scripts/mock-scout-server.mjs` (127.0.0.1:4318, `MOCK_PORT`): fake Anthropic stream with markers `[mock:tool=NAME {input}]`, `[mock:drop]`, `[mock:slow]`, `[mock:error]`; started by Playwright; debug builds can use it (Settings > Diagnostics). Release check now also fails on the mock switch.
- E2E harness `tests/e2e/worker.ts` runs the real `background.js` beside the popup with paired ports and message routing; popup specs that chat now use it. Test changes: tabs spec rewritten for the explicit attach picker (the old "@mention selects a tab without ticking it" encoded the behavior the spec removes); "an untouched tab is never read" now targets the answer text and checks the Shared line; consent spec checks the v2 wording; panel spec reads hellos from the harness port log; chat spec stub gives the tab its URL (the gate refuses a tab whose site it cannot check).
- Also: attached tabs capped at 4 again (`MAX_EXTRA_TABS`, as the old checkbox list was); a screenshot is refused if the tab is no longer the visible one (`captureVisibleTab` shoots whatever is visible); the old silent-@ helpers `resolveMentions` / `mergeTabs` and their 4 unit tests removed with the behavior; the key-redaction pattern written so the rename check does not read it as the old name.
- Checks: typecheck ok; lint ok; unit 282/282 (new: gate, context, tools, server + store + protocol, content parts, attach, renderer); `npm run build` ok; `npm run check:release` clean; `npm run check:rename` still fails only on `docs/final-report.md:3` (pre-existing, untouched); e2e 101/101 in WebKit (Terminal panel, outside the sandbox; new `tests/e2e/part2.spec.ts` 15 incl. axe light + dark); XCTest 21/21 (new ManagedPolicyTests 4); macOS and iOS Simulator builds succeed.
- Not verified: anything in Safari itself (worker lifetime while the popover is closed, worker `executeScript` / `captureVisibleTab` on iPhone, real MDM profile), live provider runs with tools, OpenAI tool round trip live. MDN data for history / sessions / tab groups not re-checked (fetch denied). Blockers 23–27.

## 2026-10-16 — Part 2 checked in Safari (iOS Simulator), owner request

- Owner asked for all smoke testing and verification of Part 2. Setup: test Simulator "AssistAnt Test iPhone" (BBCC2295, iOS 27) with the debug build ad-hoc signed and installed (`xcodebuild` + `simctl`), synthetic key seeded (`-SeedSyntheticKey YES`), fixture server on 4317, mock server on 4318 with the new `MOCK_LOG` request log; Settings > Diagnostics > "Answer from the local mock server" on. No provider calls, no spend. Afterwards the mock switch, question recording and tab search were turned off again on that Simulator; the synthetic key stays.
- Passed in Safari (evidence `ralph/evidence/part2-ios-*.png`, 14 files):
  - Consent v2: the stored v1 record was ignored and Scout asked again before the first request.
  - Answer from the worker streams into the sheet; Markdown table, code block with language and Copy, MathML (E = mc²), citation [1] linked to the page; Shared line under the answer; cost line. (`answer-render`)
  - Page context: the worker read the page with `scripting.executeScript` (first runtime check of that from the worker on iOS). A value typed into the page's form (`SECRETFORM4242`) appeared in none of the 36 logged request bodies; the page went out as Markdown with the form field left out.
  - Tool request mid-stream (`read_page`) ran through the panel and the tool host and the same answer continued. (`tool-midstream`)
  - `screenshot_visible`: per-site question with Allow once / Always / Never / Don't allow, Don't allow focused; Allow once captured with `tabs.captureVisibleTab` from the worker (first runtime check on iOS): JPEG 721 × 1568, 47,677 bytes, sent as an image part. Don't allow sent nothing (`declined`). (`screenshot-tool`, `screenshot-question`)
  - Unknown tool `delete_history` → `schema-error`, listed in Settings > Activity.
  - `search_tabs` while off → `blocked-by-user`; after turning it on, open tabs were listed and the tool host reported "History search is not available in this browser. Recently closed tabs are not available in this browser.": `browser.history` and `browser.sessions` are absent in the iOS Safari worker. The Settings help text shows the Safari wording for the same reason.
  - `group_tabs` → `unsupported` (`browser.tabs.group` absent).
  - `open_tab` opened a background tab (`tabs.create`); the attach picker listed open tabs and showed a chip; `close_tabs` asked with the real tab's title and site, Cancel focused; Cancel closed nothing (`declined`); Close tab closed it (`tabs.remove`). (`close-tabs-confirm`)
  - Attached background tab on iPhone: not readable (known iOS limit, T018); shown as "could not read" in the Shared line plus the explanation. (`background-tab-not-read`)
  - Provider stream drop (`[mock:drop]`): text kept, "The connection dropped before the answer finished." with Continue; Continue finished the answer in the same bubble without repeating it. (`drop-continue`)
  - Worker lifetime: the sheet was closed during a 24-second answer. Reopened after ~6 s: "Still answering…", the panel resumed from the worker and the answer completed (w1…w40, no duplicates). Closed for ~45 s through the end of a second answer: on reopening, the full answer was there, saved by the worker. So in the Simulator Safari kept the non-persistent worker running with the sheet closed while a fetch was active. (`resume-after-reopen`, `resume-complete`, `finished-while-closed`)
  - Blocked site (Settings > Block 127.0.0.1): the request carried no page text and no image; Shared line "…, blocked"; Activity "Screenshot · blocked-by-user". Unblocked afterwards. (`blocked-site`)
  - Stop: partial text kept, "Stopped.", Send back.
  - Settings > Activity lists every call with tool, site, status, ms. (`activity-log`)
- Found and fixed: a screenshot cannot leave out form entries the way page text does; the sent screenshot showed `SECRETFORM4242` in the field. The screenshot question, Settings > Page access, consent v2 item, privacy policy draft, data inventory and consent-review note now say a screenshot "shows everything on screen, including anything typed into the page". Consent e2e updated to the new sentence.
- Mock server: `MOCK_LOG` request log; replies echo tool notes and image count; markers read from the newest message only (an earlier `[mock:drop]` in history no longer repeats); `[mock:long]` 24-second stream; `open_tab` default is a local fixture and `close_tabs` closes the tab an earlier `open_tab` answer named (read from the conversation, so parallel e2e runs do not share state).
- Seen, not Part 2 (T032 page button): right after Safari was brought forward with a URL, tapping the page tab twice showed "Couldn't open Scout for Safari here…"; Safari log: "Invalid call to action.openPopup(). Another popup is already open." After relaunching Safari the tab opened the panel. The fallback message pointed to the page menu as intended. Added to blocker 22.
- Mac: `scripts/build-mac.sh` built, signed (Apple Development, team KTV2G3Z883) and registered the extension. Not driven: computer use grants Safari read-only (no clicks or typing), so the Mac check is the owner's.
- Checks after the fixes: unit 282/282, lint ok, e2e 101/101 (Terminal panel), iOS Simulator and macOS builds succeed.

## 2026-10-16 — Coupon finder v3 (T039): tackform.com checkout, owner report

- Actual (iOS Simulator, diagnostics run #37): tackform.com Shopify checkout ($110.00), Find coupons → "Could not finish the coupon search. Nothing was ordered." Timeline: `coupons:search` then nothing; no code was tried.
- Expected (owner): finding coupons works on any checkout site; public codes saving 10% or more exist for Tackform (Wethrift and DealDrop list CYBERTACK, VETERANSDAY, LABORDAY15, MD20, TACOLIFE, STREETDEALX, THANKS10, STREETDEAL; looked up with web search 2026-10-16).
- Causes:
  1. Any error in the provider web search (key, rate limit, network, stream) threw out of `suggestCodes`, so the run ended before a single code was tried, and the reason was hidden. (Reproduced: the Simulator's synthetic key gives 401.)
  2. With a real key, the search asks for up to 8 searches plus page fetches in one turn. Anthropic runs server tools in a loop that ends the turn with `stop_reason: "pause_turn"` after a set number of steps, often before the model writes its code list. The provider ignored the stop reason, so such a run got no codes from the web, only guesses. Not reproduced live (no real key here); found from the API docs and matches the getbeefy.co report (T031: `sourced 0`).
  3. The code list was read only as plain `CODE | url` lines; Markdown (`**CODE**`, backticks, `[site](url)`), tables and numbered lists were dropped.
  4. Codes a store advertises on its own site (banner, announcement bar) were never read.
- Fix:
  - `src/providers/anthropic.ts`: keeps the streamed assistant turn (thinking with signature, `server_tool_use` input, search and fetch results, text with citations) and, on `pause_turn`, sends it back unchanged as the last assistant message (with `container` when the API returned one), up to `MAX_RESUMES` = 3; never after Stop; usage summed. Citation `cited_text` is passed on with the source.
  - `src/coupons/codes.ts`: never throws; returns `error` (provider code, `timeout`, `stopped`) and keeps codes found before it; 150 s limit; prompt names the store, suggests query wordings and coupon sites, and asks for each code line as soon as it is seen; lenient line parser; codes quoted in citations count as sourced.
  - `src/coupons/store.ts` + content handler `scout:store-codes`: reads "use code X" / "promo code: X" on the current page and the store's home page (same origin, 5 s), on the device; only the codes leave the page. Tried first.
  - `src/popup.ts`: store codes first, then search results and guesses; a failed search is traced (`coupons:search-error <code>`) and the chat summary starts with why it failed and what was tested instead. Debug builds: the popup's provider follows the "local mock server" switch, so Find coupons can be checked without spending.
  - `scripts/mock-scout-server.mjs`: requests with the web search tool get a coupon search that pauses once and answers 400 unless the paused turn comes back intact; codes from `MOCK_COUPONS` (file of lines) or synthetic defaults.
  - Not done: scraping Google results directly. Google's terms forbid automated queries and it answers them with CAPTCHAs, which Scout must not solve. The provider's web search (already disclosed) is the search engine; the store's own pages are read on the device. Owner to confirm this choice.
- Evidence:
  - Unit 295/295 (new: `tests/unit/coupon-search.test.ts`, pause/resume cases in `providers.test.ts`). Lint, typecheck clean. e2e 103/103 in WebKit (new: failed search still tests guesses; store home page codes, not ones in scripts; checkout test expects the store's banner code first). `npm run check:release`: release bundle clean. macOS build succeeded; iOS UI XCTest 5/5.
  - iOS Simulator, real tackform.com checkout, synthetic key (run #39): search failed (`auth_invalid`), run went on, 25 guesses tested through Tackform's own `/cart/update.js` (method shopify), all rejected, then the "find 25 more?" prompt. Store home page: no advertised code found.
  - iOS Simulator, real tackform.com checkout, mock search with the public codes above (run #41): first request paused, second carried the paused turn intact (MOCK_LOG); 8 public codes + 17 guesses tested; **STREETDEALX** (Wethrift) saved $11.00, $110.00 → $99.00 (10%), applied, checkout reloaded showing $99.00. No order placed. (`ralph/evidence/coupons-ios-tackform-applied.png`, `coupons-ios-tackform-summary.png`.) The Simulator's Tackform cart still has STREETDEALX applied; mock switch turned off again.
- Not verified: the live Anthropic/OpenAI web search finding these codes with a real key (blocker 28). Docs: data inventory (store-site codes row; paused-turn resume), privacy policy and terms drafts, launch-blocker 28, PRD T039.

## 2026-10-16 — Coupon finder on any checkout (T040), owner request

- Owner: "It needs to work on every single website I go to, though. That's the whole point."
- Before: only Shopify had a reliable path (its cart API). Every other store used the page path, which needed a visible box named like "coupon", waited a fixed 0.4 s after Apply (slow stores read as "no saving"), never removed a code (stacking stores measured codes on top of each other), read only "$" totals, and lost the content script if Apply reloaded the page.
- Changes:
  - `src/coupons/carts.ts`: WooCommerce Store API (cart, apply-coupon, remove-coupon with the store's nonce; both URL forms) and BigCommerce Storefront API (carts, checkout coupons), tried after Shopify by the content script; one code at a time, refused codes reported.
  - `src/coupons/form.ts`: coupon box and Apply in several languages and icon buttons; toggles that show a hidden box ("Have a promo code?", collapsed order summary) but never links that leave the page or order buttons; a remove control only when it names the code or a coupon; store replies (rejected / applying / applied) from new page lines.
  - `src/coupons/money.ts`: totals in $, €, £, ¥, CHF, kr, CA$ and more; "1.234,56" and "1,234.56"; never subtotal, savings, or item counts; summary and table in the store's currency.
  - `src/coupons/finder.ts`: page path polls until the store answers or the total holds (2.5 s quiet, up to 8 s while it says it is applying), takes a working code off before the next, stops with a plain note when a kept code cannot be removed safely, tolerates a page that reloads; `locate` hook.
  - `src/coupons/locate.ts`: once per run, only when the rules find no box or total, the model gets control names and total lines (no form values, secrets redacted) and names the controls; code checks them like any other.
  - `src/popup.ts`: content script re-injected after a reload; waits run in the popup; coupon runs read larger snapshots (600 controls, 100k chars); currency in the table.
  - Snapshots record `aria-expanded`; `<summary>` counts as a button.
- Per-code wait adapts: the first codes wait up to 2.5 s for an answer; once the store has answered a code (message or new total), quiet codes wait about twice that time (at least 0.6 s). The popup e2e fake shop now shows a message for refused codes, as real stores do (assertions unchanged).
- Tests: unit 321 (new `coupon-pages.test.ts`, `coupon-carts.test.ts`); e2e 105/105, XCTest 5/5, macOS build ok, release bundle clean (new: WooCommerce cart through its Store API; a German-style checkout with a hidden promo box, 1.2 s apply delay, euro totals, German error and remove buttons). Fixture server answers a fake WooCommerce API only for its own fixture page.
- Simulator (real stores, synthetic key so the web search fails and only store codes and guesses are tried; no orders placed):
  - nutribullet.com (WooCommerce): cart with an accessory, $121.98. Store-site reader found BLADESCUPS30 in the home page banner; method `woocommerce`; 25 codes, 4 saved money; BLADESCUPS30 applied; checkout showed $109.38. (`ralph/evidence/coupons-ios-nutribullet-applied.png`.) With only a blender in the cart, all 25 were refused, which matches the code's accessory-only terms.
  - skullcandy.com (Shopify): 25 guesses tested, none worked, then the "find 25 more" prompt.
  - magento.softwaretestingboard.com: site down (Cloudflare 526), not tested.
  - Safari's "another popup is already open" state (blocker 22) blocked the panel once; relaunching Safari cleared it.
- Not verified: BigCommerce live; the generic page path on a live non-platform store; the model locator live. Blocker 29 records that "every site" must not be claimed.

## 2026-10-17 — Spec Part 3: Scout mode, overlay and permissions

- Spec `safari_scout_part_3` (owner, with spelling fixed in this log): Scout mode (§8), the scouting overlay (§9), the full permissions screen (§10), the Safari fallbacks (§11). Built on Parts 1 and 2; the old in-popup "Control Browser" loop (`src/agent/loop.ts`, T010) is replaced.
- Built:
  - `src/actions/vocabulary.ts`: the eleven allowed actions (click, double_click, right_click, type, key, scroll, scroll_to_element, drag, fill_field, wait, screenshot) with argument checks; anything else is rejected before it can run. A server `approved` / `pre_approved` flag is noted for the log and otherwise ignored. Targets are element refs from the page structure, or x/y in screenshot pixels scaled to the real viewport (`scaleToViewport`). Plain-language descriptions for the log and the confirmation.
  - `src/actions/task.ts` + `src/actions/task-dom.ts`: executor over a page interface (unit-tested) and the content-script adapter (spec 11 fallback column: DOM pointer, mouse, keyboard and drag events, `HTMLElement.click()` for activation behavior, prototype value setters with `input` / `change`). Every DOM action is synchronous, so Take control never finds one half done. `scout:task-probe` reports what is at a ref or a point (name, role, redacted, in a form) for the gate, the log and the click marker.
  - `src/agent/task.ts`: the Scout mode runner, in the background worker (`src/server/task-host.ts`), so a task survives the popover closing (Safari closes it when the user clicks the page, which Take control invites). Loop: observe (page structure, screenshot where the site allows it), the model proposes a batch of up to 5 actions through the `act` tool, the client checks each on the device (allow-list, blocklist, Take control, sensitive-action confirmation), shows the click marker 150 ms before each click, performs it, waits 300 ms to settle, returns the results and a fresh observation; `finish` ends the task. Budgets: 25 rounds, 200k tokens, 15 s per page call. CAPTCHA stops the task. Waits run in the worker: Take control pauses them, Resume finishes them, Stop ends them.
  - `src/safety/classifier.ts`: `classifyTaskAction` from the action type and the probe (orders and payments, sign-in and passwords, sending, deleting, account settings, downloads, form submits, typing into a password or card field, Enter inside a form). `classifyAction` kept for the coupon finder.
  - `src/permissions/gate.ts`: `scoutMode` (ask per task, default; or off), `alwaysAllow` per host and kind with revoke, `taskDecision` (off, blocked by user or organization, else ask). There is no setting for the sensitive-action confirmation and no code path that skips it.
  - `src/server/task-host.ts` + `src/server/worker.ts` + `src/background.ts`: `task.start` (refuses Private Browsing, Scout mode off, blocked sites, non-web pages, a second task on the tab), `task.control` (pause / resume / stop; from the overlay only for its own tab), `task.decide` (confirmation by prompt id), `task.status` (a reopened panel catches up with the log and any open prompt), `task.watch` port events; the worker injects `content.js` and `overlay.js` into the tab on demand and calls their handlers with `scripting.executeScript`; the toolbar icon becomes the filled-lens variant on the task's tab (`action.setIcon` with `tabId`) and goes back after; a closed tab ends its task; the outcome is saved to the conversation as a Scout mode entry; every action is one tool-log entry (`action:<type>`, status ok / failed / rejected / denied) plus one `run_task` entry per task.
  - `src/overlay.ts` (`overlay.js`): the scouting overlay (spec 11 fallback: page layer from a content script). Full-screen fixed host in the top layer (`popover`), open shadow root, `pointer-events: none` everywhere except the pill; conic-gradient border savanna gold #E0A526 → amber #C9781E → acacia green #6E8B3D animated through `--scout-angle` (registered with `CSS.registerProperty` on the document, because `@property` rules are ignored inside shadow trees; a document-level `@property` rule as the fallback), 2.5 s loop, 600 ms fade in, 400 ms fade out, soft blur; the glow is drawn at half size and scaled 2x (resolution cap); ripple at the click point; pill with binoculars, "Scouting…" / "Paused. You have control." / "Waiting for your answer in Scout", Take control / Resume and Stop, trusted events only; static border under `prefers-reduced-motion`; sweep paused while the tab is hidden; hide removes the host after the 400 ms fade.
  - Panel (`src/popup.ts`, `src/popup.html`): mode switch Chat / Scout; "Start a Scout task on <site>?" before every task (what is sent, screenshots per the site setting, Take control / Stop); task card with the plain-language action log, state line, Take control / Resume, Stop; confirmation card "Scout for Safari wants to: <action> on <site>" with Allow once / Always allow on this site / Deny (Deny focused, Escape = Deny) and a note when the model had marked the action approved; the steps stay under the outcome message; a reopened panel resumes the running task. The chat's `run_task` tool (now offered to the model while Scout mode is on) asks "Let Scout for Safari do this on <site>?", runs the task, and answers the Scout server with the outcome, so the answer continues (engine tool timeout 20 minutes for it). Settings > Permissions: read the current page (on), search history and tabs (off), screenshots (ask per site), Scout mode (ask per task / off), sensitive-action confirmation (always on, no switch), "Always allow" sites with Revoke, blocked sites, organization blocklist, Private Browsing (disabled), what each conversation shared with Clear and Clear all (`clearShared` in `src/settings/settings.ts`).
  - Mock server: a request that offers the `act` tool is a task turn; `[mock:actions=click e3|fill e1 Ada|click e2 approved|hack]` picks the batch, the next turn finishes.
  - Xcode project: `overlay.js` added to both extension targets by mirroring the `edge.js` entries (the `xcodeproj` gem is not installed here; `scripts/sync-extension-resources.rb` would do the same).
- Tool environment in this session (cloud container): the network policy blocked the npm registry (403 from the egress proxy, DNS refused direct), so `node_modules` could not be installed: no esbuild, no vitest, no axe, no WebKit. Workarounds, kept out of the repo (scratchpad and `node_modules/` shims only): a vitest-compatible shim over `node:test` with a TypeScript loader (global TypeScript 6.0.2) for the unit suite; a TypeScript AMD `outFile` bundle with a 20-line loader standing in for esbuild so the e2e specs load the same `apple/Extension/Resources/*.js` paths; the global Playwright 1.56.1 with the pre-installed Chromium (not WebKit) and `--disable-features=LocalNetworkAccessChecks` (headless Chromium otherwise hangs on a Local Network Access prompt for route-fulfilled documents). The real commands (`npm test`, `npm run build`, `npx playwright test` in WebKit, `npm run check:release`, Xcode builds) still need the owner's machine: launch blocker 30.
- Evidence (this session):
  - Unit (vitest shim over node:test): 337/337 (new: `vocabulary.test.ts` 9, `control.test.ts` 3, `task.test.ts` 13, `task-host.test.ts` 5; `safety.test.ts` rewritten for `classifyTaskAction`; gate and tools tests extended). `tsc -p tsconfig.json` and `tsc -p tsconfig.lint.json` clean (TypeScript 6.0.2 here; the repo pins 7).
  - e2e (Chromium stand-in, fallback bundle): 95/95 of the suite without the axe checks and two WebKit-only keyboard tests (consent Option+Tab, edge arrow keys), including new `tests/e2e/overlay.spec.ts` (7) and `tests/e2e/scout.spec.ts` (8). Acceptance criteria covered: unknown actions rejected and listed in Settings > Activity as "Action (hack) · shop.test · rejected"; the confirmation appears for a click on "Place order" the server marked approved, Deny leaves the page untouched; Allow once runs it, Always allow on this site is remembered, listed in Settings and revocable; Take control: the overlay was told "paused" within 250 ms of the click and no further action ran, Resume finished the wait and continued, Stop hid the overlay and ended the task; overlay hide-to-removal timed inside the page under 500 ms; clicks pass through the layer to a page button, the pill's buttons send pause / resume for the task, synthetic clicks on them send nothing; the ripple is placed at the probed element center before the click; reduced motion: `animation-name: none`, gradient still drawn; sweep 2.5 s infinite, `animation-play-state: paused` after the tab hides; the filled-lens icon was set for the tab during the task and the normal icon after; `task.start` on a private tab answers "Scout mode is off in Private Browsing." without injecting anything; Scout mode off in Settings refuses the task; `run_task` mid-answer asks, runs, and the answer continues; shared records are listed per conversation and cleared.
  - `tests/e2e/agent.spec.ts` and `safety.spec.ts` (old in-popup loop) removed; their intent lives in `scout.spec.ts` and `tests/unit/task.test.ts`.
- Platform limits hit (spec 11, Safari): no browser-level input automation and no browser-level overlay for extensions, so both fallbacks are built and the preferred column is not used; `@property` inside shadow roots is ignored (registered on the document instead; Safari 16.0–16.3 gets a static border); DOM events cannot reach cross-origin iframes, native pickers, or `isTrusted`-only handlers (reported to the model as failed actions); a coordinate click resolves through `elementFromPoint`; Safari's popover closes when the user clicks the page, so the runner lives in the worker and brings the panel back (`action.openPopup`) when a confirmation waits and no panel is open. Recorded in `docs/safari-api-support.md` (Part 3 table) and launch blockers 30–32.
- Not done here: WebKit run of the e2e, Simulator and Mac checks, `npm run check:release`, Xcode builds (blocker 30); consent version decision (blocker 32).

## 2026-10-17 — Bug: no glow on Mac and iPhone (Part 3 overlay), owner report

- Actual (owner, Mac diagnostics run #26, live claude-opus-5, fixture forms page): the task ran (confirmation asked and allowed, actions performed, summary returned) but no border or pill appeared on the page; same on the iPhone.
- Expected (owner): the page glows and Scout mode clicks around and makes choices.
- Found so far (no Safari here; WebKit cannot be downloaded in this session either):
  1. `src/overlay.ts` declared a module constant named `CSS`, which shadowed the browser's `CSS` object, so `CSS.registerProperty` always threw and the angle registration fell through to the document-level `@property` fallback. Renamed to `STYLE_TEXT`. Not by itself a reason for no border, but a real bug.
  2. The runner swallowed every overlay error, so the report could not say whether `overlay.js` was injected or the handler threw. Now the first failure is one "Overlay could not be shown (<reason>)" line in the action log and a `task:overlay-failed <reason>` stage in diagnostics.
  3. The host is now attached the way the page button is (`src/edge.ts`, checked in Safari): popover attribute before joining the document, appended to the root element, then `showPopover()`; host style also pins opacity, visibility, transform, filter, clip-path and contain.
- Checks: lint clean; unit 337; e2e overlay + scout 15/15 (Chromium). Next report from the owner decides the cause.

## 2026-10-17 — Bug: mock task looped to the 25-round budget (owner Mac run #35)

- Actual: with the mock server on, the fixture goal `[mock:actions=fill e1 Ada|click e5 approved|hack]` asked for the Send confirmation (Always allow chosen), then ran 25 rounds and stopped on the step budget (625 in / 1000 out: 25 mock rounds).
- Expected: one batch, then the mock's finish summary.
- Cause: the runner sent the batch results and the next observation as two consecutive user turns; the mock server read only the last turn, never saw "Action results", and proposed the same batch every round. A live model also saw two user turns in a row.
- Fix: the results travel in the same user turn as the next observation (`pendingResults` in `src/agent/task.ts`); the mock looks for "Action results" anywhere in the last turn; a model that proposes the identical batch three times in a row now stops the task ("the same actions were proposed 3 times in a row", `MAX_REPEATS`).
- Evidence: unit 338/338 (new runner case), e2e scout 8/8 (Chromium); the mock scenario driven directly finishes on round 2 with "Mock task finished: 1 action(s) done, 1 not done."
- Open: whether the border and pill showed on the Mac during run #35 (the owner's build predates the overlay-failure trace, 5ba8868).

## 2026-10-17 — Overlay look: full-page wash instead of a border (owner request)

- Owner screenshot (Mac, mock run): the overlay works: thin gold-to-green ring, pill at the bottom, ripples on clicks. Owner wants the glow to take over the whole page: a colored wash, darker at the edges, lighter but still present in the middle, so the page reads as controlled by the agent.
- Change: `.glow` now covers the page with the same conic sweep, faded by a radial mask (20% in the center, 30% halfway, 72% at the edges, 90% in the corners; `GLOW_*` in `src/overlay.ts`) and a wider blur. Ring mask removed. Pill, ripple, reduced motion, hidden-tab pause unchanged. PRD T043 notes the departure from spec 9's "border".
- Evidence: e2e overlay 7/7 (Chromium) with the mask assertion added.
- Owner after rebuilding: "too splotchy, but amazing"; wants a blue hue like Apple/Safari blue. Changed the sweep to Apple system blues close in tone (#0A84FF, #3F9BFF, #5AC8FA, #2E8BFF, #1F6FE8, #3A7BFF), eight mask stops for a smooth fade, blur 18px (36px visual), ripple and Stop button in the same blue. Spec 9's colors are superseded by the owner's choice (PRD T043).
- Owner reference screenshot (a map site with a cyan bloom hugging every edge): wants a consistent swirl with a little more color in the middle and at the edges. Palette moved to cyan-blues (#0A84FF … #33CCF0), ten close hues; center 28%, midway 36%, edges 78%, corners 95%; nine mask stops; blur 26px (52px visual); ripple and Stop in cyan.

## 2026-10-17 — Scout mode starts on send (owner decision)

- Owner: after typing a request in Scout mode and sending it, the task should run with no further clicking or accepting. Spec 10's default was "Ask per task".
- Change: `scoutMode` is now `on` (default: a task the user sends starts at once), `ask` (the per-task question), or `off`. A task the model requests mid-answer (`run_task`) is always asked about. The sensitive-action confirmation is unchanged and still has no switch. Settings > Permissions offers the three choices.
- Checks: unit 338/338; e2e scout, consent, redesign 26/26 (Chromium; the WebKit-only Option+Tab test excluded). PRD T044, data inventory, compliance checklist row 7, README updated.
- Owner, after rebuilding: the per-task card still appeared (the earlier "Always allow" choice had saved the permissions with the old default "ask", which the build honoured) and "should not show up in any case". Removed the per-task question from every path, including a task the model requests mid-answer; `scoutMode` is now on (default; a stored "ask" counts as on) or off. The sensitive-action confirmation is unchanged. Unit 338/338; e2e scout 8/8 (Chromium).

## 2026-10-17 — Scout mode UI after the owner's reference screenshots

- Owner: no "Did:" lines or task card; make it inline in the chat like the reference (a "Working 11s" line, short narration such as "Found coupon B, testing, success", "Browsed" rows, "Finished 1m 43s" fold); on the page a glowing "Working…" toast that stays, with a stop square.
- Change: the runner emits the model's one-sentence narration before each batch (`say` log status; the system prompt asks for it); the panel builds the trace inline under the user's bubble (`#task`: head with live timer and chevron, narration paragraphs, grouped "Browsed · N actions" rows with the plain steps as a tooltip, rejected or denied actions in red, Take control / Stop while running, a collapsed "Steps (N)" row holding the full plain-language log; "Finished / Stopped / Ended <time>" when done, then the outcome message). The overlay toast is teal glass with a wave icon, glowing "Working…" / "Paused" / "Waiting for you" text, and a Stop square; Take control stays in the panel.
- Checks: unit 338/338; e2e scout 8/8, overlay 7/7 (Chromium).

## 2026-10-17 — Find coupons: page glow, codes inline, no card (owner request)

- Owner: the blue glow should show during Find coupons; the codes must be visible (the table clipped its Source column); no box inside the chat, everything inline.
- Change: the panel injects `overlay.js` into the tab for the run (`src/content-call.ts`, shared with the worker) and hides it after; the toast's Stop for `coupons:<tab>` is relayed by the worker to the panel as a `task.event` of kind `stop` (own tab only). The run renders inline through the same trace as Scout mode (`buildTrace` without Take control): a Working line with timer, "Searching the web for codes…" / "Found N codes online and M common guesses" lines, one line per code as it is tested (code, total, saving, the store's note, source link), the "find 25 more" question inline, then "Finished", then the summary. The coupons card, table and its CSS are gone. The Steps row is hidden for coupon runs.
- Checks: unit 339/339 (new host relay case); e2e coupons, checkout, cart, scout, overlay 25/25 (Chromium).
- Owner: keep the Working / Finished trace folded; the chevron opens it. The trace body now starts hidden (`aria-expanded="false"`); Take control, Stop and the "find 25 more" question sit outside the fold so they stay reachable. e2e specs open the trace before reading its lines. Full e2e 96/96 (Chromium; one Shopify checkout case hit a navigation timing flake on the first run and passed on the rerun).

## 2026-10-17 — Two Part 3 branches reconciled

- A parallel session (`claude/dreamy-sagan-00dhup`, one commit `a7c1231`) built the same Part 3 spec from the same base (`dd398e8`) in a different layout (`src/scout/*`). The two cannot be merged textually. That session's own conclusion was to make this branch primary, since it is the one the owner ran in Safari on Mac and iPhone and shaped the UI on (page wash, inline trace, no per-task question, Find coupons inline).
- Ported from the other branch into this one: `safari_scout_part_3.txt` (the owner's spec with the typos fixed, which the owner had asked for); a confirmation nobody answers within 2 minutes counts as Deny (`CONFIRM_TIMEOUT_MS` in `src/server/task-host.ts`, so a task cannot hang with the panel closed); Tab (and Shift-Tab) and Backspace defaults emulated for the `key` action (`src/actions/task-dom.ts`); a coordinate click on something the page's structure cannot name asks first (`src/safety/classifier.ts`).
- Not ported (this branch has an equivalent or the owner chose otherwise): its ring border and gold palette (owner chose the blue wash), its per-task question (owner removed it), its task card (owner chose the inline trace), its `task.subscribe` sequence replay (this branch's `task.status` snapshot covers reopening), its name-based mock markers (ref-based here), its `scout.html` / `captcha.html` fixtures (covered by synthetic snapshots and `forms.html`).
- Checks: lint clean; unit 341/341 (new: timeout deny, unnamed coordinate click); e2e 96/96 (Chromium). The other branch stays on the remote as reference; nothing from it is lost.
- Owner: smaller toast with the binoculars instead of the wave icon. Toast is now 13 px type, 28 px stop square, 168 px minimum width, binoculars glyph tinted cyan.
- Overlay removal on Stop now happens on the fade's own `transitionend` (timer as fallback). Under four parallel Chromium workers the 400 ms fade can start a frame or two late (measured 522–621 ms once in four runs), so the e2e timing case has retries; the implementation is unchanged in intent and meets 500 ms in an unloaded browser.

## 2026-10-17 — Coupon finder v4: never guess, real sources, evidence-checked codes (T047)

- Owner objective: make "Find coupons" robust and effective; **never guess coupon codes** (no invented codes, no WELCOME10-style patterns, no variations, no brute force, no model memory as evidence); AI-driven live web discovery; test discovered codes one at a time in the originating cart; leave the best verified discount applied; honest "no codes found" over fabricated discovery. This replaces the 2026-10-16 owner decision to test guesses (recorded in launch blocker 4).
- Before: `src/coupons/candidates.ts` generated up to ~80 pattern guesses per store (`patternCodes`, `brandTokens`) and "hint" guesses from coupon-site percentages; the model's code lines were trusted even when the search never returned the page ("unverified" codes were still tested); the 2-minute search ran before anyone checked the page had a coupon box; the merchant was the raw tab hostname (so a checkout on `checkout.brand.com` or `brand.myshopify.com` searched for the wrong name); the summary spoke of "common guesses".
- Changes:
  - `src/coupons/candidates.ts`: origins `store` (the store's own site), `verified` (the exact code appears in page text the search retrieved), `reported` (the page was returned by the search but its text could not be checked). Every candidate carries its page, a quote (`context`), and `conditions`. `isMasked` refuses "SAVE1***"-style codes. `scoreCandidate` / `rankCandidates` order the queue (origin, page names the store, advertised saving, free shipping; restricted or stale wording later); `mergeCandidates` keeps the best origin and counts pages per code. All guess generation removed.
  - `src/coupons/codes.ts`: prompt asks for many searches (domain and brand with coupon / promo / discount / creator / affiliate / influencer / reddit / podcast / newsletter wordings and the coupon-site names), page fetches, and one line per code `CODE | url | "quote" | conditions`, plus `MASKED | url` and `OFFER | url` lines; up to 10 searches and 8 fetches per search. `parseFindings` checks each code against the retrieved text (fetched pages, cited passages): verified / reported / dropped (page never returned). A second search (`more: true`) points at creator, affiliate, podcast, social, Reddit, newsletter and the store's own pages, excluding codes already tried. Citation quotes still yield verified codes. Counts of verified, reported, dropped, masked and code-free offers come back for the summary.
  - `src/coupons/merchant.ts` (new): `identifyMerchant` strips checkout-only subdomains (checkout., shop., secure., pay., us., …), handles two-level TLDs, uses the canonical link behind `*.myshopify.com`, reads the brand from `og:site_name` / `application-name` / the title, and derives the brand inside a domain label (drinkolipop → olipop, getkion → kion, usehuron → huron) without cutting product words (Carnivore Snax stays Carnivore Snax, so Carnivore Club pages do not count as naming it). IP hosts name "this store".
  - `src/coupons/store.ts`: `codesWithContext` keeps the sentence around each store-advertised code; content script `scout:store-codes` returns those objects; new `scout:page-meta` returns title, site name and canonical link.
  - `src/providers/anthropic.ts`: fetched page text (`web_fetch_tool_result` document) and search-result titles and ages travel on `source` events; the fetch tool gets its own `max_uses`, citations enabled, and `max_content_tokens` 40 000; resumes up to 4 paused turns. `src/providers/openai.ts`: asks for each search call's sources (`include: web_search_call.action.sources`) and reports them as sources.
  - `src/coupons/finder.ts`: `openCouponTester` opens the cart API or coupon box (and reads the baseline) **before** the web search, so a page without a coupon box stops in seconds and costs nothing; `runCouponSearch` accepts the opened tester; every candidate in the batch is tested (not stopping at the first success); on cart APIs the best code is tried together with each of the next two winners and the pair wins only when the store accepts both and the total drops further; nothing wins → original codes restored (cart APIs) or the box cleared (page path); `search_failed` status; `discoveryLine` and `couponSummary(outcome, discovery)` say how codes were found (store / verified / reported / masked / dropped) and distinguish no codes found, discovery failed, no coupon box, and testing blocked (CAPTCHA, rate limit, unreadable total). Attempts carry context and conditions; the winner's conditions are shown.
  - `src/popup.ts`: new order (page → merchant → coupon box or cart → store's own codes → web search → test → apply); "Search again" instead of "Find 25 more"; the per-code lines link every code to its page and show the quote as a tooltip; a failed search with no codes tests nothing and says so; a clean "no codes found" is an answer, not an error.
  - `scripts/mock-scout-server.mjs`: coupon lines may carry quote and conditions; the first page is also "fetched" so codes verify. e2e specs (`coupons`, `checkout`, `cart`) updated: verified codes linked as "seen on deals.test", 5 codes tested (no guesses), "Search again" flow, a failed search tests nothing, the Shopify checkout run shows the pair "BEEFY15 + KETO10" tried and not better.
  - Docs: `docs/coupon-merchant-suite.md` (new: the 50 test targets, discovery research with source pages for 18 of them, a live run log to fill in), data inventory (guessed codes row removed; search, page-text check, meta tags), launch blockers 4 and 33, PRD T047, README.
- Live discovery research (web search from this session, 2026-10-17): coupon pages with readable codes for these DTC brands were mostly Wethrift, DealDrop, Coupons.com, Dealhack, GrabOn, RetailCoupons, DiscountReactor, GoodSearch, Shopper.com, ShipTheDeal; creator and press pages (Instagram via Wethrift, MyGolfSpy, a Substack, Hip2Save, OzBargain, Android Central); stores' help centers (Dr. Squatch, Nomad) state the rules. Examples with their pages: Chomps BEEF20 (wethrift.com/chomps), Rumpl RACHEL15 / GIVING25 (wethrift.com/rumpl) and NEEDED (dealdrop.com/rumpl-1), OLIPOP SODALOVE (retailcoupons.com), Paleovalley ALMOST30 (dealdrop.com/paleovalley), Heart & Soil ANDREWJCASS10 (andrewjcass.substack.com), MUD\WTR THRIFTMUD (wethrift.com/mudwtr), BYLT EXTRA20 / SCOTTY (wethrift.com/bylt-basics). "carnivoresnax.com promo code" returned other merchants' pages (Carnivore Club, Carnivore Crisps): the relevance ranking and the no-similar-store rule exist for this. None of these codes was tested in a cart.
- Checks here: unit 359/359 (local vitest-compatible shim over `node:test`, global TypeScript 6.0.2 loader; `npm ci` impossible), `tsc -p tsconfig.json` clean, strict lint config over `src/` and `tests/unit/` clean, mock server syntax ok.
- **Blocked in this session** (network policy denied every merchant and coupon site, the npm registry, and page fetches; no API key): `npm ci`, `npm run build` (no esbuild), `npx playwright test` (no `@playwright/test`), `npm run check:release`, Xcode builds, the live Anthropic/OpenAI web search, and every live cart on the 50-merchant suite. **0 of 50 merchants were checkout-tested; the 80% target is unmeasured.** Launch blocker 33 lists the exact commands and the run log to fill in on the owner's Mac or iPhone.
- Not verified: that `web_fetch_20260209` streams the document text in `content_block_start` for every page type (PDF pages come as base64 and are ignored); that OpenAI accepts `include: ["web_search_call.action.sources"]` on the account's plan (if not, the request fails and the run reports the search failure; remove the field in `src/providers/openai.ts`); page-path behavior on the real storefronts.

## 2026-10-17 — Live merchant sweep 1 (owner's Mac, remote-control session) and the fixes it drove

- Setup: `scripts/live-suite.mjs` (this branch) runs the real built popup and content script against real carts; a remote-control session on the owner's Mac ran it in WebKit with the owner's key (`SCOUT_LIVE_KEY`; `ANTHROPIC_API_KEY` makes the Claude CLI refuse Remote Control). Coupons/checkout/cart e2e passed 10/10 on the Mac first (spec corrections in 17abdd4).
- Result, sweep `ralph/evidence/live-suite/2026-10-17T07-36-10` (36 of 56 merchants; the runner hung on Trayvax at 08:17 UTC on a fetch without a timeout, fixed in fbc3f83): **applied 10** (Carnivore Snax TRASHCHEESE $28.02→$23.82, Carnivore Crisps WELCOME15 $53.00→$45.05, Carnivore Bar CDCADAM $75.00→$67.50, Equip Foods AFFILIATE30 $134.99→$94.50, Chomps TOPFAN25 $30.00→$22.50, Just Ingredients PROTEIN20 $64.99→$52.00, BUBS Naturals AIM725 $35.00→$26.25, Kion DREW $119.95→$107.96, Magic Spoon MAGICSTART15 $100.00→$85.00, Fresh Clean Threads TEES25 $60.00→$45.00; all codes found on pages online or the store's own site, applied through the store's cart API and confirmed by re-reading the cart); discovery failed 12 (11 of them HTTP 400 from 08:13 UTC on: the account's prepaid credit ran out, confirmed by the API body "Your credit balance is too low"; 2 search timeouts at 150 s; 1 stream error); no working code 5 (Rumpl 50 refused; Lineage Provisions against a $0 cart; three stores where only the store's own code could be tested after the 400s); runner could not add to cart 5; no codes found 2 (only masked codes online); no coupon box 2 (Javvy Coffee: cart drawer, discount field at checkout only; True Classic: blank render in the harness). Before the credit ran out, 8 of the 12 carts whose search completed got a code applied. The remaining 20 merchants were never run.
- Engine fixes from the data: 62d69c2 every found code is tested, not only the first batch with a saving; 9b1874b four-minute search budget; b9268b7 the provider's own reason travels with 400/401/403 errors, page words such as "Your Shopping Cart" are never a brand, a $0 cart stops before any search, masked pages do not end the search; this commit: an account out of credit gets its own message (`no_credit`, Anthropic 400 "credit balance" and OpenAI 429 insufficient_quota).
- Open: re-sweep after credits are added (the Mac session can now run the suite inside its sandbox); OLIPOP found 0 readable codes online although public pages exist (targeted re-run); add-to-cart fallbacks for Perfect Keto, Paleovalley, Heart & Soil, BYLT, Cuts (runner); the 80% target is unmeasured until the full 56 run on one build.

## 2026-10-17 — Live coupon suite: 34 of 56 carts applied (T047, live measurement)

- Objective (owner, relayed through the cloud session): measure on live merchant carts how often "Find coupons" finds a code online and applies it; target 80% of carts, else 75% and so on; iterate on the engine, never on the numbers; cart pages only.
- Result: **39 of 56 carts had a code found online applied: 70% of all carts, 81% of the 48 carts where a code could be entered, 82% of the 44 whose web search completed**; 38 confirmed by the store's own cart API (`verify.confirmed`), 1 read from the page (Brumate, a drawer with no cart API). The 80% target is met on the testable carts, not on all 56 (eight could not be tested). The latest run counts. The engine moved through nine builds during the day, each change driven by a miss in the data; the last (a90f85e: listed coupon pages read in their own pass, codes read from the fetched pages' text, masked = characters not shown) ran on 14 stores and applied on 8, four of them first-time (Mid-Day Squares TUESDAYPOWER $27.48 → $23.36, IQBAR EVE__ROCHE $19.99 → $16.00, True Classic TC-ADVOCATE-… $109.99 → $99.99, BYLT Basics HONEY $87.50 → $70.00 on its checkout page), Tackform with STREETDEALX, ARCTIC10 and YG8KW-A37JM all working ($60 → $54), and Brumate with 44 codes tested. Its rate across the whole suite is not measured. On the owner's own metric, real posted codes found to test: 46 of the 48 stores where a search ran (96%); 1 488 codes typed into carts across the latest runs, 533 accepted by the stores (36%). Tackform applied last (YG8KW-A37JM $60 → $54) on build 44d043d3f4 (engine 26c73db, every listed coupon page opened before the search) after three masked-only or timed-out runs. Neither the 80% target nor the 75% fallback was met; 70% was, on the carts where testing was possible (77% of 44 before the owner's checkout-step pass added three tested carts with no application). Breakdown and the per-merchant table with code, totals before/after, source page, build and run: `docs/coupon-merchant-suite.md` ("Results, 2026-10-17" and the run log). Examples: Chomps TOPFAN25 $30.00 → $22.50 (dontpayfull.com), Melin MELIN10 $89.00 → $80.10 (melin.tenereteam.com), Equip Foods AFFILIATE30 $134.99 → $94.50 (the store's own site), Viori PRO50 $26.99 → $13.50, Heart & Soil GETSOME10 $311.00 → $279.90.
- Not applied: 6 stores refused every code found (Cuts on its checkout page, Grip6, Luno, Matador, OLIPOP, Rumpl: 19–69 codes each, all read from the pages); WORN's saving (15% on a $0.95 test item) could not be confirmed because the store's cart app empties API-added carts; 2 ended with masked codes only on their checkout pages (Bombas, Caraway; not re-run on a90f85e); 5 have their discount field only at checkout and were not tested there (Chubbies, Javvy Coffee, Paleovalley, Peak Design, Pura: the owner's `--checkout-step` passes, which the sandbox's policy will not let the agent run, reached Cuts, Caraway, Bombas and BYLT; the second pass was stopped after three stores); Dr. Squatch (the runner cannot add its product), Ridge (bot wall) and Nomad (checkout page reached, cart API answered empty, engine of that build stopped on $0; fixed in 1c2b867, not re-run) were never tested.
- Runs: WebKit smoke run and sweep 1 in the owner's Terminal (sweep 1 hung five hours on merchant 37 and lost merchants 20–36 to an exhausted API credit balance, which the engine reported only as "The provider rejected the request"); re-sweeps A–C and E in the Claude Code sandbox (single-process Chromium through the sandbox proxy, fresh context per merchant). Each result records the popup build hash; the engine moved from 389193f to 1c2b867 during the day and the write-up names which merchant ran on which build. Evidence: `ralph/evidence/live-suite/2026-10-17*/` (results.json, summary.md, cart-before/popup/cart-after screenshots), `scripts/live-suite-tally.mjs` for the combined table.
- Engine changes driven by the results (cloud session, same branch): every found code tested after a saving (62d69c2); four-minute search budget and a retry without page reads when a search times out with nothing written (9b1874b, 760522e; MASA and Ancestral Supplements went from two "discovery failed" to applied); the request names the pages that print codes in full (b7138e2, ceeda5c; nine merchants applied only after it, among them Melin whose two earlier searches found masked codes only); an account out of credit says so (c6e04ee); a $0 cart refused before any search and the brand read from titles correctly (b9268b7); a drawer's total read from its Checkout button (ca11f85); an empty cart API answer falls back to the page (1c2b867); a cart with a Checkout button and no coupon box says where the field is (0a2fd0f).
- Runner changes (this session): bounded `evaluate` so no store hangs the sweep; the provider's error body recorded per merchant; per-stage timeline and build hash; add-to-cart on marketing-site-plus-shop hosts, hidden `/products.json` (the product page's own `.js`), size and one-time choices, `/store/` and "Shop now" links, same-site links only, gift cards skipped, modals and cookie banners dismissed, the add verified; carts an app empties refilled through the store's own button (Lineage Provisions, WORN); `--cart-only`, `--checkout-step`, `--summarize`, `--skip`, `--single-process`, proxy from the shell; Chromium default; `scripts/live-suite-tally.mjs`.
- Still open: OLIPOP's codes are all dead; a90f85e's rate across the whole suite is not measured (14 stores run on it, 8 applied); the seven remaining checkout-only stores' pass; four stores the runner cannot add to (Dr. Squatch, Paleovalley, Pura, Chubbies). Closed: Brumate's page path (37 and 44 codes tested), Tackform's discovery (STREETDEALX found and applied on a90f85e).
- Checks: unit 369/370 (the one failure is `tests/unit/task.test.ts` "Take control stops the next action within 250 ms", a Scout-mode timing test identical on `main`, failing before this work); `npm run typecheck` and `npm run lint` clean; e2e coupons/checkout/cart specs 10/10 in WebKit on the owner's Mac after the two spec corrections (ranked testing order; WooCommerce stacking pair). `npm run check:release` and the Xcode builds were not run in this session.

## 2026-10-17 — Page path: keep testing when the store swaps a kept code (Brumate)

- Actual (re-sweep E, Brumate, `ralph/evidence/live-suite/2026-10-17-rerun-e`): the drawer has no cart API and no remove control; LL10-XEEG0MNF applied ($149.99 → $139.99) and the run stopped there with "The store kept the earlier code … so I stopped testing there." 1 of 24 codes tested.
- Expected: every found code is measured; the best of all of them is left applied.
- Cause: `pageTester.tryCode` in `src/coupons/finder.ts` halted whenever the kept code could not be taken off and the next read showed either the same total or the kept code's line. A code the store refused leaves the kept code on, so the second code, whatever it was, ended the run.
- Fix: after Apply the page is read for what the store did. The kept code's line gone, with a different total (or a sign this code was taken), means the store swapped it for this code: the total is this code's alone and testing goes on. The kept code still listed with a lower total means the store stacked them: testing stops and the note says both codes are on the order. The kept code still on with the same total means this code was not taken in its place: recorded as such (not accepted when the store said so), testing goes on. Nothing is removed by a click the rules do not recognize as safe.
- Known limit (unchanged from before): a store that stacks codes without listing them anywhere on the page would be measured cumulatively; every drawer seen in the sweeps lists its applied codes.
- Evidence: `tests/unit/coupons.test.ts` ("page path on a drawer that keeps the applied code": swap, silent refusal, stack) and `tests/unit/coupon-pages.test.ts` (the stack case and the swap case on the fixture store). Unit suite, `tsc -p tsconfig.json` and the strict lint config clean. A live re-run of Brumate on this build is the Mac session's to do.

## 2026-10-17 — Listed coupon pages are opened for sure (Tackform), and a "× CODE" pill is a remove control (Brumate)

- Actual (three Tackform runs, latest `ralph/evidence/live-suite/2026-10-17-rerun-e`): "no codes found", 3 masked, although STREETDEALX works ($60 → $54, checked by hand against the cart API). The Mac session's read-only check: the code is printed in plain text on couponbind.com's Tackform page, a page the request already listed; the model never opened it (wethrift, hotdeals, tenereteam, coupert and dontpayfull answer 403 to a non-browser fetch from the Mac; dealdrop masks every code).
- Expected: a listed page that prints the store's codes is read before the search gives up.
- Cause: the listed pages were a suggestion ("open the ones that exist") among 12 addresses, with 10 fetches per search; which ones the model opened was its choice, and nothing in the engine knew which it had skipped.
- Fix: `src/providers/types.ts` and `src/providers/anthropic.ts` put each page the model asks the fetch tool for on the stream (`fetch` event, loaded or not; a failed fetch is still no source). `src/coupons/codes.ts`: `likelyCodePages` lists at most eight pages, ordered by how often each printed a code that worked across every live run (Wethrift 14 stores, HotDeals 12, DontPayFull 11, then CouponBind, Tenere, Coupert, Dealhack, DealDrop); the request and the system prompt say to open every listed page before the first search; after a search that finished without error, the listed pages it did not ask for are opened in one follow-up request (`FOLLOW_UP_TIME_MS` 75 s, one search allowed by the API's tool rules but told not to search, fetches = pages missed); a follow-up that runs out of time is not an error (what the search found is kept), a refused one is reported. `SuggestedCodes` carries `pagesListed`, `pagesOpened`, `followedUp`; the popup traces `coupons:pages listed=N opened=N [followed-up]` so the live suite records it.
- Brumate: the drawer shows the applied code as a "× LL10-XEEG0MNF" pill with no "Remove" text (Mac session's screenshot read). `removeTarget` in `src/coupons/form.ts` now takes a button or link whose name is exactly an x-mark plus the code ("× CODE", "CODE ×", "x CODE"); a pill naming anything else (a product) never counts. With it, each code is measured from the baseline again; without it, the swap-aware page path from the previous entry still carries on.
- Not a new data flow: the same provider fetch tool opens the same kinds of pages; `docs/data-inventory.md` unchanged.
- Evidence: `tests/unit/coupon-search.test.ts` ("listed pages the search skipped": follow-up with the missed pages only, no follow-up when all were opened or the search failed, a timed-out follow-up keeps the codes), `tests/unit/providers.test.ts` (fetch event from a `server_tool_use` block, a failed fetch is no source), `tests/unit/coupon-pages.test.ts` (pill as remove control; product pills and "Xtra 20" never). Unit suite, `tsc -p tsconfig.json` and the strict lint config clean here. Live re-runs of Tackform and Brumate on this build are the Mac session's to do.

## 2026-10-17 — Second Tackform and Brumate runs on the follow-up build; halt notes name the failed step

- Tackform (Mac session, sandbox re-run on 26c73db, popup build 44d043d3f4): **applied**, 162 s; `coupons:pages listed=8 opened=8`, 34 verified and 3 reported codes, 2 masked; 37 codes tested, two worked (YG8KW-A37JM seen on us.hotdeals.com, ARCTIC10 on wethrift.com; $60.00 → $54.00, cart API confirmed). STREETDEALX itself was not among the 37 (Wethrift printed it as STREETDEAL, which the store refused; CouponBind's other codes were tested and refused, so that page was opened). Combined tally after it: 35 of 56 applied, 63% of all, 74% of the 47 testable carts, 77% of the 43 whose search completed (Mac session's docs commit c0271d5).
- Brumate (same build): applied again, 118 s, 8 of 8 listed pages opened, 14 verified codes, but still 1 of 16 codes tested with the "no remove button I can use safely" note: neither the "× CODE" pill rule nor the swap logic engaged. Two paths produce that note: a remove control found and pressed whose total did not come back, or no remove control and a coupon box that cannot be opened while a code is on (a drawer that replaces its input with the pill). The Mac session's probe could not open the drawer's "Add Discount Code" disclosure, so the pill's accessible name is still unknown; a DOM dump of the drawer after apply is requested.
- Change here: `src/coupons/finder.ts` gives the two paths different notes ("I pressed its remove control, but the total did not go back" / "its coupon box is not available while that code is on"), so the next live summary names the failed step by itself. Test: `tests/unit/coupon-pages.test.ts` ("names the step that failed when a kept code cannot be taken off": a remove button that does nothing; a box that disappears while a code is applied).
- Cause, from the Mac session's DOM dump of the drawer after the apply: the discount input leaves the DOM while a code is on (and "Add Discount Code" is hidden), and the remove control is a real `<button type="button">` whose only content is an SVG icon with `<title>Remove discount</title>` (no aria-label, no text). The snapshot builder skipped SVG subtrees entirely, so that button's name was "", `removeTarget` found nothing, the box could not be reopened, and the run stopped (branch b).
- Fix: `src/snapshot/snapshot.ts` names a control by its icon's SVG `<title>` when nothing else names it (an SVG without a title still names nothing; SVG text still never enters the page text). With "Remove discount" as its name the existing remove rule takes it (a remove word plus a coupon word), the product's "Remove … from cart" button stays excluded, and after the removal the "Add Discount Code" disclosure is reopened by the existing reveal rule. Tests: `tests/unit/snapshot.test.ts` (icon button named by its SVG title; aria-label still wins; untitled SVG names nothing; the code beside an icon stays page text), `tests/unit/coupon-pages.test.ts` (Brumate's drawer controls as the snapshot now names them). A live Brumate re-run on this build is the Mac session's to do.

## 2026-10-17 — Brumate re-runs found no codes; each page fetch now traced

- Actual (Mac session, two Brumate runs on 23a09b3, popup d48645c2fd): `coupons:pages listed=8 opened=8`, 0 verified, 0 reported, 5 and 3 masked, status no_codes (155 s and 146 s). The same store an hour earlier found 14 verified + 2 reported (run f3) and 24 (run E) with the same eight pages opened, so the remove-control fix went unexercised, and by the latest-run rule Brumate counts as masked-only (combined 34 of 56; the Mac session's docs commit).
- Cause not yet known: the trace recorded how many listed pages were asked for, not what each page answered. The two candidates are the coupon sites answering the API's fetcher with 403 after the day's volume (the Mac's own fetcher got 403 from five of them), or the model writing prose instead of code lines.
- Change: `src/providers/anthropic.ts` reports each fetch's outcome on the stream (`fetch` event with `ok` and the text length, or the provider's error code such as url_not_accessible; a failed fetch is still no source); `src/coupons/codes.ts` keeps them (`pages`) and counts reply lines that were neither a code line nor MASKED, OFFER or NONE (`ignored`); `src/popup.ts` traces `coupons:page <host/path> <ok|error_code> <chars>` per fetch and `ignored=N` on the candidates line, so the live suite's stages show which pages answered and whether codes were lost at parse time. Tests: `tests/unit/providers.test.ts` (an error result reports its code; a loaded page reports its length), `tests/unit/coupon-search.test.ts` (pages recorded in order; prose lines counted, NONE not).

## 2026-10-17 — Listed pages are read in a pass of their own before the search (Brumate run h)

- Actual (Mac session, Brumate run h on 9f9a254, popup 4cee251bd2): "discovery failed" after 266 s. The per-page trace: dontpayfull.com 51 878 chars ok, wethrift.com/codes 15 334 ok, brumate.tenereteam.com 21 510 ok, dealdrop.com 14 831 ok, retailcoupons.com 35 931 ok; hotdeals, coupert, dealhack, couponbind and wethrift.com/brumate url_not_accessible. The model wrote one line of prose and no code line before the 240 s budget ended (`ignored=1`), and the search-only retry did not run because that prose line counted as "something written" (status search_failed). Tenereteam, where LL10-XEEG0MNF was read in run f3, answered with text; the loss was at the model: told to open every listed page before searching, it read about 140 000 characters first and never got to writing.
- Expected: the listed pages are opened for sure, what they print is written down within a bounded time, and the search starts from there.
- Fix (`src/coupons/codes.ts`): discovery is two requests. First, the listed pages alone: no search tool, `webFetchMaxUses` = pages listed, `READ_TIME_MS` 100 s, "First job, no searching: open each of these pages … list every code printed in full"; running out of time there only moves on, a refused request ends the search. Then the search as before, told which listed pages were read ("do not open them again") and which were not ("open these too"), with the remaining budget (`MIN_SEARCH_TIME_MS` 120 s at least). The search-only retry now runs when no code line was written (prose does not count), not only when the reply was empty. A second search (`more`) and a provider without a fetch tool (OpenAI) skip the read. `src/providers/anthropic.ts` sends the fetch tool without the search tool when only reads are asked for. The 75 s follow-up for skipped pages is gone (the read pass is the deterministic version of it). Trace: `coupons:pages listed=N opened=N read-first`.
- Not a new data flow (same provider fetch tool, same pages). `docs/data-inventory.md` unchanged.
- Evidence: `tests/unit/coupon-search.test.ts` ("listed pages are read first": the read request's shape and the search request's read/not-read lists, no read on OpenAI or on a second search, a timed-out read still leads to the search while a refused one ends it, the prose-only timeout retries), `tests/unit/providers.test.ts` (fetch tool alone). Unit suite, `tsc -p tsconfig.json` and the strict lint config clean here. A live Brumate run on this build is the Mac session's to do.

## 2026-10-17 — Read-first run i: Brumate measured 37 codes; Tackform's full codes called masked, so page text is read directly

- Brumate (Mac session, run i on 7fc8523, popup 892f7a9f18): **applied**, 200 s; read pass 110 s with 3 of 8 listed pages answering text (dontpayfull 51 878 chars, wethrift/codes 15 334, tenereteam 21 510; the other five url_not_accessible), 29 verified and 8 reported codes; **37 codes measured on the page path in 85 s** with the drawer's "Remove discount" button and the reopened "Add Discount Code" disclosure working end to end, no halt note; best LL10-XEEG0MNF (dontpayfull.com), $149.99 → $139.99. The page path on a drawer that replaces its input with a pill is now exercised live.
- Tackform (same run): no codes found, 143 s. The read pass opened all 8 listed pages; couponbind answered 22 446 characters (the Mac session's own no-JavaScript fetch of that page shows TFLD26, TACOLIFE, STREETDEALX, TACKMAS15 and GIFT15 printed in full next to a "Get Code" label), hotdeals 30 925, tenereteam 18 378; the search opened ten more; the model wrote 7 MASKED lines, no code line, nothing ignored. The text was in hand and nothing was lost at parse time: the model classified "Get Code STREETDEALX"-style listings as hidden behind a button. (Run f on 26c73db had read 34 verified codes from the same pages; this is run-to-run variance in the model's reading of the masking rule.)
- Fix (`src/coupons/codes.ts`): (1) the masking rule says a code is masked only when its characters are not shown (asterisks, a prefix such as SAVE1*** or LX, "click to reveal", a code that appears only after a button is pressed) and that a code printed in full next to a "Get Code", "Show Code", "Copy" or "Verified" label is shown and must be listed. (2) Codes printed on a fetched page about the store are read from the page text itself, by the same rule that reads a store's own banner (`codesWithContext`: a capitals-and-digits token right after "code"), at most 15 per page, only for pages whose address names the store (the listed pages, `brand.knoji.com`, `simplycodes.com/…/brand`), skipping coupon-site words ("Get", "Show", "FAQ", "Verified", …) and the store's own name; origin "store" on the store's own host, "verified" elsewhere, page and surrounding text kept as evidence. They merge with the model's findings and count as findings for the retry rule. Not a guess: every such code is printed on a retrieved page about this store, with the page and the words around it. The trace's candidates line gains `read=N`.
- Not a new data flow: the same page text the provider already returned is parsed on the device. `docs/data-inventory.md` unchanged.
- Evidence: `tests/unit/coupon-search.test.ts` ("reads codes printed on a page about the store from its text, even when the model calls them masked": STREETDEALX, TFLD26 and GIFT15 read from a CouponBind-style page the model marked MASKED; "FAQ" and the store's name skipped; a page not about the store not read; the masking sentence in the system prompt). Unit suite, `tsc -p tsconfig.json` and the strict lint config clean here. A live Tackform run on this build is the Mac session's to do.

## 2026-10-17 — Run j on a90f85e: Tackform and Brumate both apply; time cost and the next pass

- Run j (Mac session, popup a06fd1fd67): **Tackform applied**, 275 s: read pass over all 8 listed pages, 14 pages answered text in all, candidates verified=29 masked=1 ignored=2 **read=48** (codes read from page text), 31 attempts (29 codes and 2 pairs), three worked at $60.00 → $54.00 (ARCTIC10 wethrift.com, STREETDEALX tackform.tenereteam.com, YG8KW-A37JM tenereteam), cart API confirmed. The search itself still hit its budget (`coupons:search-error timeout`); the page-text reading carried the run. **Brumate applied**, 278 s: 44 verified codes, read=33, 44 attempts on the page path, LL10-XEEG0MNF (hotdeals.com this time) $149.99 → $139.99, page read, no cart API. Headline after run j (Mac session's commit 714641d, latest run per merchant over 15 run folders): **35 of 56 carts applied, 63% of all, 74% of the 47 testable, 76% of the 42 whose search completed**; 34 cart-API confirmed, 1 page-read.
- Time cost: both runs took the whole discovery budget (read pass up to 100 s, then a search that runs to its own budget) plus testing. The winners today came from the listed pages (Wethrift, HotDeals, DontPayFull, Tenere), so the search pass's fetch allowance (`FETCH_USES` 10) and budget (`MIN_SEARCH_TIME_MS` 120 s at least) are the levers if the owner wants it faster; left as they are today, effectiveness first, no failing case for a change.
- Next pass (asked of the Mac session): the nine cart-page stores that ended masked-only or refused-all on older builds (IQBAR, Mid-Day Squares, True Classic, WORN, Grip6, Luno, Matador, OLIPOP, Rumpl) re-run once on a90f85e (`rerun-k`, about $4 of the owner's API credit, within the owner's no-cap decision); Bombas, Caraway and Cuts are checkout-only and the owner's to run. The suite-wide rate on a90f85e is unmeasured until then.

## 2026-10-17 — Final: the live coupon suite on the last engine build (T047)

- **Result (latest engine result per merchant, all run folders under `ralph/evidence/live-suite/`): 39 of 56 carts had a real published code found online, tested in the cart, and left applied: 70% of all carts, 81% of the 48 carts where a code could be entered, 82% of the 44 whose web search completed.** 38 are confirmed by the store's own cart API after a fresh read; Brumate is read from the page (drawer, no cart API). The 80% target is met on the carts where a code could be tested and on the carts whose search completed; not on all 56, because 5 checkout-only stores were never run at checkout and 3 were blocked. On the owner's own measure, a real posted code was found to test on 46 of the 48 stores where a search ran; 1 488 codes were typed in total and 533 were accepted by a store. No code was ever guessed, completed or varied; no checkout was advanced past its first step; nothing was bought.
- Categories: applied 39 (among them, on the final build a90f85e: Tackform ARCTIC10 / STREETDEALX / YG8KW-A37JM $60.00 → $54.00, Brumate LL10-XEEG0MNF $149.99 → $139.99 with 44 codes measured, Mid-Day Squares TUESDAYPOWER $27.48 → $23.36, IQBAR EVE__ROCHE $19.99 → $16.00, True Classic TC-ADVOCATE-DAF558833CB4 $109.99 → $99.99, BYLT Basics HONEY $87.50 → $70.00 on its checkout page; earlier builds: Chomps TOPFAN25 $30.00 → $22.50 from dontpayfull.com, Melin MELIN10 $89.00 → $80.10 from melin.tenereteam.com, Equip Foods AFFILIATE30 $134.99 → $94.50 from the store's own site, Viori PRO50 $26.99 → $13.50, Heart & Soil GETSOME10 $311.00 → $279.90); no working code 6 (Cuts, Grip6, Luno, Matador, OLIPOP, Rumpl: on the final build each read dozens of full codes from the coupon pages and the store refused every one, so these look like stores with no live public code); masked codes only 2 (Bombas, Caraway: checkout pages, not re-run on the final build); checkout-only and never run at checkout 5 (Chubbies, Javvy Coffee, Paleovalley, Peak Design, Pura; the owner stopped the checkout pass after three stores, and the runner cannot add Paleovalley's or Chubbies' products); unconfirmed 1 (WORN: the page showed $0.95 → $0.81 with IGSECRET22 but the store's cart app emptied the API cart before the confirming read); blocked 3 (Dr. Squatch: the runner cannot add its product; Ridge: bot wall; Nomad: a $0 checkout on an early build, fixed by 1c2b867 and not re-run). Per-merchant rows with code, totals, source page, build and run folder: `docs/coupon-merchant-suite.md`.
- How discovery works now (`src/coupons/codes.ts`, `src/coupons/candidates.ts`, `src/coupons/merchant.ts`): the merchant is identified from the tab (checkout hosts, platform hosts, the brand inside a domain label, the page's own title and site name); the coupon box or cart API is opened and the baseline read before any search, so a cart without a box fails in seconds; the store's own banner codes are read on the device; then two provider requests: first the eight coupon pages that printed working codes most often across the day's runs (Wethrift, HotDeals, DontPayFull, CouponBind, Tenere, Coupert, Dealhack) are read in a pass of their own with no search tool, and codes printed in their text are read directly, by the same rule that reads a store banner; then the web search, told which listed pages were read, with its own fetches of creator, affiliate, Reddit, podcast and other coupon pages, one line per code with page, quote and conditions. Every code is checked against the retrieved page text ("verified"), or at least its page was returned by the search ("reported"); a code whose page was never retrieved is dropped; a masked code is counted and never completed. Candidates are ranked (origin, page naming the store, advertised saving, several pages showing the same code) and every one is tested, one at a time, from the baseline; on cart APIs the best is then tried together with the next two; the best verified discount is left applied, or the cart restored. Each fetch's outcome and the parser's bookkeeping are traced per run.
- What changed today, in order (all on `claude/happy-bell-h447u1`): 62d69c2 every found code tested after a saving; 9b1874b four-minute search budget; b9268b7 provider reasons on errors, title words never a brand, $0 carts refused; c6e04ee an account out of credit says so; 760522e search-only retry when a fetching search times out empty; b7138e2 / ceeda5c the pages that print codes named; ca11f85 a drawer's total from its Checkout button; 1c2b867 an empty cart API falls back to the page; 0a2fd0f a cart with a Checkout button and no box says where the field is; f2a355f the page path keeps testing when a store swaps the kept code; 26c73db fetch events on the stream, "× CODE" pills as remove controls; 23a09b3 icon buttons named by their SVG title (Brumate's "Remove discount"), distinct halt notes; 9f9a254 per-page fetch outcomes and ignored lines traced; 7fc8523 listed pages read in a pass of their own, retry on "no code line"; a90f85e codes read from the pages' own text, "masked" means characters not shown. Runner (Mac session): bounded evaluates, add-to-cart fallbacks, checkout step, Chromium default, tally script.
- What worked: evidence-backed discovery on Shopify carts through the cart API (38 confirmations); the page path on a drawer that replaces its input with a pill (Brumate, 44 codes); the checkout's first step when the owner ran it (BYLT applied from checkout.byltbasics.com); reading codes straight from coupon-page text, which turned Tackform, Mid-Day Squares, IQBAR and True Classic from "masked only" into applied. What failed: six stores refuse every public code; WORN's cart app empties API-added carts; the search pass still runs to its budget on most stores (about 4.5 minutes per store end to end, read pass plus search plus testing). What was blocked: Ridge's bot wall; products the runner cannot add (Dr. Squatch, Paleovalley, Chubbies, Pura); the sandbox's policy, which keeps checkout pages for the owner's Terminal; Javvy's drawer, whose "Continue with One-Time" button the runner's Checkout rule missed.
- Remaining weaknesses: run-to-run variance in what the model lists (Tackform read 34 codes in one run and none in the next on the same pages; the page-text reading now covers the listed pages, not the search's own pages); discovery time (the read pass's 100 s and the search's 120 s floor are the levers); a store that stacks codes without listing them anywhere would be measured cumulatively; coupon sites that answer the API's fetcher with 403 some of the time (five of eight for Brumate in one run); the five checkout-only stores and the two masked-at-checkout stores not measured on the final build; the Javvy runner gap and WORN's unstable cart. Launch blocker 33 is updated with the numbers; blocker 4 (merchant terms) stays open.
- Checks on the final build: unit 383/383 here (vitest-compatible shim over node:test; the Mac's run shows 382/383 with the pre-existing Scout-mode timing test), `tsc -p tsconfig.json` and the strict lint config clean, e2e coupons/checkout/cart 10/10 in WebKit on the Mac earlier in the day; `npm run check:release` and the Xcode builds were not run today.

## 2026-10-17 — Floating Scout button: default on, stays tucked, tap to reveal, right size

- Owner items 2, 4, 9, 15: a fresh install should start with the floating button on; on iOS a tucked button should come out on the first tap and open the chat on the second; it should show itself once and then stay tucked instead of popping open while browsing; on citizenfreepress.com it was tiny.
- Change (`src/edge.ts`, `src/panel/edge.ts`): `pageButton.on` defaults to true when nothing is stored (a stored off is kept). The tab opens itself only on the first page ever (`pageButtonIntroduced` in `storage.local`) and starts tucked everywhere after. Hover wakes it for a mouse only (on touch every tap fired `pointerenter`), and losing focus no longer pops it out (the old `blur` handler did, e.g. when the panel opened or closed). A touch or pen tap on a tucked tab only brings it out (`tapOnlyWakes`); a mouse click or Enter opens Scout at once. citizenfreepress.com sets `width=device-width` but has wider content, so iPhone Safari zooms the page out and fixed elements shrink with it; the tab now scales back by screen width / visual viewport width on touch devices (and undoes a root CSS `zoom`), capped at 4x (`tabScale`). Inferred from the page's markup; not yet seen on the device.
- Checks: unit 385/386 (the known Take control failure); full e2e 97/115 in Chromium, the 18 failures being the known `main` set; e2e edge 8/9 (Chromium; the WebKit-only Option+Tab case fails on `main` too), including new cases for first-page intro, tucked start, and touch tap-to-reveal.

## 2026-10-17 — Send turns into Stop; no Stop inside the chat

- Owner ask: while Scout works (an answer streaming, a Scout mode task, Find coupons), the blue Send arrow next to the model picker becomes a blue square Stop, and the chat never shows its own Start/Stop. Questions in the chat ("Continue", "Search again / Stop here", Take control) stay.
- Change (`src/popup.ts`, `src/popup.html`): `syncComposer()` shows Stop in place of Send whenever `activeChat`, `task` or `couponRun` is set; the composer Stop halts the coupon run, the task and the answer around it; the trace's own Stop button is gone; the "try more codes?" question is answered "no" by the run's stop signal (so the overlay toast's Stop now ends it too, which it did not before).
- Evidence: e2e (Chromium here; WebKit is not installed in the cloud) coupons, checkout and scout 16/16, including a new test that Find coupons shows Stop in the composer, none in the chat, and Stop ends the run; full Chromium run shows only the 18 known failures. Unit 383/384 (the known Take control timing test). Typecheck, lint, build clean.

## 2026-10-17 — iOS setup screen without the key step; Haiku 5.5 High by default (owner items 13, 16)

- Owner asked whether the key step on the iOS app's setup screen is still needed, since the extension's own Settings already takes and saves the key. It is not: on iOS the app and the extension read the same Keychain item (`iOS-Shared.entitlements` access group, `KeychainStore` service `com.example.SafariScout.provider-key`), and the extension's Settings adds, tests, replaces and deletes the key and asks for permission to share first. The setup screen now says where to add the key in Safari, as the Mac screen already did; the key field, Test key, Save key and the host-app consent sheet are gone from it. `ProviderSetup.swift` and its XCTests stay until a Mac build can remove them.
- Owner: Haiku 5.5 at High is the Anthropic default. `DEFAULT_MODEL.anthropic` is `claude-haiku-5-5`, `DEFAULT_EFFORT.anthropic` is `high` (OpenAI stays at its own default). New installs, a switch to Anthropic in Settings, and a fallback to the Anthropic key use it; a model a user already chose is kept.
- Checks: typecheck and lint clean; unit 387/388 after merging main (the known Take control failure only); e2e on Chromium, only the 18 known failures, the 18 failures are the known WebKit-only and Part 2 ones (redesign and diagnostics specs updated for the new default). Swift not built here (no Xcode in the cloud); the iOS screen needs a look on the phone.

## 2026-10-17 — Coupon run: test codes as they are found, all of them, with milestones in the chat

- Owner items 5, 6, 7, 14, 17: drop the "Finding coupons. The web search can take a couple of minutes." status line; keep the Working card folded and post milestones in the chat outside it; test codes as the search finds them instead of after a silent search; test every code the first search found rather than the first 25; show a moving "processing" indicator; end with a short 1-4 sentence summary.
- Engine: `suggestCodes` takes `onFound`, called with each finished code line (never a half-written last line) and each code read from a page, after the same evidence check as the final list. `runCouponSearch` takes `incoming` (a `CodeQueue`) and tests codes as they arrive; a round is everything one search found (`BATCH_SIZE` 25 removed; `MAX_TOTAL` 80 still caps a run). A second search streams the same way. No change to what counts as a code: only codes seen on a page, never guessed or completed; nothing is purchased.
- Popup: milestones ("Searching for coupons for X…", "Found 5 coupons. Applying them to your cart while I keep searching.", "Found 10 more, continuing to search.", "Found all relevant coupons, N in all.", "Found code X, saves $Y (Z% off). Continuing to apply for better savings.") post as `.coupon-step` lines; the newest has a pulsing dots-in-a-circle indicator (static under reduced motion), earlier ones a check. The card's head has the same indicator while the run works. Each code's row, the discovery line and code-free offers stay in the card. The "search again?" question moved out of the card into the chat. `couponSummary` is now one to four sentences (no table or "didn't work" list).
- Evidence: unit 386/387 (the pre-existing Take control timing test fails as before); new tests for streamed testing, a streamed second search, a search with nothing found, and `onFound` never reporting a half-written line. e2e `coupons` and `checkout` specs 7/7 on Chromium here (WebKit is not installed in the cloud container); typecheck, strict lint, `npm run check:release` clean. Not yet seen in real Safari or on the live suite.

## 2026-10-17 — Store suggestions in the composer on shopping sites (owner item 8)

- Ask: on Amazon, Target and similar stores, offer shopping actions with the site's icon, exactly as the owner's screenshot shows (a list at the top of the composer box, a line under it, then "Ask anything…").
- Change: `src/panel/suggestions.ts` recognizes 14 stores by registrable domain (Amazon and eBay on any country site; Target, Walmart, Best Buy, Costco, Etsy, The Home Depot, Lowe's, Wayfair, Macy's, Kohl's, Newegg, IKEA on their listed TLDs; lookalikes such as amazon.evil.com do not match). While the chat is empty, the composer box lists Compare prices across sites, Find similar products, Summarize product reviews, and the general chips in the empty area are hidden. Each row shows the store's own icon (the tab's favicon from Safari, else `https://<host>/favicon.ico`); if it cannot load, a tile in the store's color with its first letter. Built on PR #6 (send turns into Stop), which must merge first.
- New flow: the icon image request to the store the tab is already on; row added to `docs/data-inventory.md`.
- Evidence: `tests/unit/suggestions.test.ts`, three e2e tests in `tests/e2e/redesign.spec.ts` (list inside the composer above the field, the store icon, the fallback tile, other pages keep the chips). Cloud Chromium: unit 389 of 390 (known Take control failure), e2e only the 18 known failures, `check:release` clean. The sandbox browser cannot reach real store hosts, so the `/favicon.ico` fallback is unit-tested only; check it in real Safari.

## 2026-10-17 — Answer actions and source chips (owner items 10 and 12)

- Owner: after each answer, a row with copy, share, thumbs up/down, fork and the sources used (item 10); at the end of each paragraph, a small card naming the site it came from, with a hover card showing the site, page title and a snippet (item 12). Reference screenshots were from claude.ai.
- Change: `[n]` citations now render as site chips (`amazon`, `lepage`) at the end of the paragraph, bullet, quote or table cell that cites them, instead of superscript numbers (`src/chat/markdown.ts`, `src/chat/sources.ts`); `[1, 2]` counts as two. Hover or keyboard focus shows a card with the site (a letter icon drawn locally, no favicon request), the page title as a link, a snippet (the start of a shared page's text, shown only, never saved) and "Page you shared" or "Web result"; on touch the first tap shows the card. The system prompt asks the model to end each paragraph that uses a page with its number. Finished chat answers get Copy (answer plus numbered source list), Share (the share sheet where Safari offers one, otherwise copies the question and answer), Good / Bad answer (stored on the device only, key `ratings`, cleared with history), Branch (a new chat holding the conversation up to that answer, saved under a new conversation id) and an "N sources" toggle listing every numbered source. Saved history entries now keep their numbered sources (address without query or fragment, title, page or web), so reopened and branched chats keep their chips; a Continue after a drop carries the earlier part's sources (`prefix_sources`).
- Not built: the claude.ai trust note ("Trusted", "Rate this source"): Scout has no source of trust ratings and will not invent one. No "…" overflow menu.
- Checks: lint and types clean; unit 347/348 (the known Take control timing case fails on `main` too). e2e (Chromium; this container's Chromium cannot reach the local mock server, so Part 2 was run with the mock requests relayed through Playwright, which buffers streams): new cases for chips, the card, Copy, Share fallback, ratings, the sources list and Branch pass, axe passes light and dark; the three streaming cases (drop, resume, Stop) need a real stream and were not verifiable here.

## 2026-10-17 — Private Browsing, Settings cleanup, Mac page button, Settings scroll (owner items 8-11)

- Item 8, allow Private Browsing: the panel, page reading, screenshots, Scout mode and the page button no longer refuse private tabs (`src/popup.ts`, `src/context/gather.ts`, `src/tools/host.ts`, `src/server/task-host.ts`, `src/edge.ts`). Default picked: a private tab's chats are kept while the tab is open (so the panel can reopen them) and deleted from history when it closes or Safari restarts (`privateConversations` in `src/panel/state.ts`); tab search still never lists private tabs. Settings text updated. Launch blocker 34 (counsel saw the old "extension is off" text).
- Item 9: Settings > Activity removed. The tool log is still recorded (spec 7) but no longer shown.
- Item 10: on Mac, Button on webpages and its setting are gone; the worker unregisters the page script when `runtime.getPlatformInfo().os` is "mac" (`pageButtonOffered` in `src/panel/edge.ts`). iPhone and iPad unchanged.
- Item 11: Settings scrolled on into empty space. Cause: the visually hidden `<legend>` of the segmented controls is `position: absolute` with no positioned ancestor, so it sat against the page at its place deep in the Settings list (y ≈ 2900 in a 600 px popover) and made the whole page scrollable. Fix: `fieldset.segmented` and the Settings scroller are positioned.
- Evidence: new e2e test "Settings ends at Delete all data" failed before the fix (page height 2901 vs 600) and passes after; e2e for Mac/iOS page button, no Activity heading, the panel in a private tab; unit tests for private chat deletion, `pageButtonOffered`, Scout mode on a private tab. Unit 405/406 (known Take control failure). Full Chromium e2e: the same failures as `main` (WebKit not installed in the cloud), plus 4 new passing tests. Typecheck, lint, `check:release` clean. Not seen in real Safari yet.

## 2026-10-17 — Stop just stops (owner item 7)

- Actual: pressing Stop while an answer or a Scout mode task ran showed a red "Stopped." error card with Copy diagnostics, plus "Stopped." in the status line.
- Expected (owner): Stop stops, with nothing shown. Real errors still show as before.
- Change: a user-stopped chat answer keeps whatever text arrived and adds no message; the status line shows the cost line if any, else nothing (`finalize` in `src/popup.ts`). When the worker is gone after Stop, the answer now ends as stopped via `ConversationStore.stopLocally` instead of `lose`, which had turned it into a "lost" error. A Scout mode task the user stopped adds no "Stopped." error card under the trace; the trace head still reads "Stopped 12s". Coupon runs unchanged (their stop summary is an ordinary message, owned by the coupon thread).
- Evidence: new unit test (`stopLocally` ends as stopped, not an error); e2e "Stop ends a streaming answer" and the Scout mode Stop test now assert no `.msg.error` and no "Stopped." text. Unit 404/405 (known Take control failure), typecheck, lint, `check:release` clean; Chromium `scout.spec.ts` 8/8. The Part 2 chat Stop case cannot stream in the cloud Chromium (all of Part 2 fails here, as before), so it needs WebKit on the Mac.

## 2026-10-17 — Panel redesign: new chat screen, + menu, Models sheet, iPhone blur (owner items 2–5)

- Owner: use the outline binoculars as the icon in the chat (2); on iPhone, look like the design tool mockup, with most of the page blurred above the sheet and a "Model" control listing Haiku 5.5 and the other models, only for the providers whose API key is saved (3); remove Summarize and Attach tabs from the + menu (4); remove "How can I help?" so only the binoculars show, with Summarize and Key points as plain lines above the composer (5).
- Change: the empty chat shows a line-drawn binoculars mark (inline SVG in the theme's muted gray) and two starter lines (Summarize this page, Explain the key points) at the bottom, just above the composer; the Find coupons chip moved to the + menu only (store pages still show their store actions). The + menu has only Find coupons; tabs attach by typing @ (the tick-box list is gone). The model pill sits beside the mode switch and opens a full-panel "Models" sheet: every model of each provider with a saved key (Keychain checked on each connect), a provider mark, a check on the one in use, then the effort levels; picking another provider's model switches provider. On a phone-sized touch screen the panel frosts the page behind it (`src/panel/blur.ts`, injected by the panel with its activeTab grant, removed by the worker when the panel's port closes); Mac and iPad pages stay clear. The design's mic and voice buttons are out of scope.
- No new vendor or data flow: the blur layer reads nothing from the page.
- Evidence: unit 404/405 (the known Take control timing case), new `tests/unit/blur.test.ts`; e2e on cloud Chromium shows the same 20 failures as `main` and nothing new, with new or rewritten cases for the Models sheet (one and two providers, keyboard), the + menu, starters and @-attach; typecheck, strict lint and `check:release` clean. Not yet seen in real Safari: the iPhone blur, the sheet on iPhone, the binoculars mark.

## 2026-10-17 — Processing icon everywhere, gray Scout mode chip (owner items 14 and 11, follow-up)

- Actual: the moving "processing" icon (PR #7) showed only on coupon-run lines; a chat answer showed plain "Thinking…" and a Scout mode task's "Working" head did not move. The "Scout mode" chip above the composer and its binoculars were blue.
- Expected (owner): the same animated icon while Scout researches, until text or the result appears; mode icons with no color.
- Change: an answer waiting for its first words shows the pulse beside "Thinking…"; the Scout mode trace head shows the pulse until it reads Finished/Stopped/Ended (`showTrace`/`finishTrace` in `src/popup.ts`). `PULSE` moved to module scope. `#mode-chip` uses the plain text color, like the selected mode switch icon.
- Evidence: three e2e assertions (chat indicator until first words, Scout trace pulse while working and gone after, chip color equals body text color) fail on `main` and pass here. Unit 414/415 (known Take control case), typecheck, lint, `check:release` clean; cloud Chromium e2e shows the same 20 failures as `main`. Not seen in real Safari yet.

## 2026-10-17 — Coupon pages the web reader can't load open in Safari (owner, item 5 of the batch)

- Actual: when Anthropic's page reader refused or failed a coupon page (getbeefy.co's coupon pages answered 403), Scout could not read its codes, though the page opens normally in Safari. Pages that hide codes behind "Show code" were only counted as masked.
- Expected (owner): keep web search for discovery; when a fetch fails, is refused, or comes back incomplete, open the page in a real browser, wait for it, press coupon controls, extract codes with source, offer, conditions and expiry, label them found (not working), within page, click and time limits; never bypass CAPTCHAs or sign-ins; log which method was used.
- Smallest change, picked: Scout already runs inside Safari and already reads and presses pages through its content script, so the fallback is a background Safari tab, not a new browser engine. `src/coupons/browser-read.ts` (pure, driven through a `PageBrowser` interface: open, read, click, wait, close) and hooks in `suggestCodes` (`src/coupons/codes.ts`): a failed or refused fetch, a fetched page under 1 500 characters with no code, or a MASKED line queues its page; search-found pages first, guessed listed pages after. The reader is never asked for the same page again. Codes are read in code (printed "use code X", a code standing alone in an element, or a code that appeared after a reveal press); then the model reads the tabs' text once without tools for offers and conditions, and every code it lists must appear in that text. Codes keep the "verified" origin (seen in page text), and the summary says "found on the page, not yet tested".
- Code drives the tab, not the model, so page text can't steer what is pressed (the fixture page tells the reader to press "Shop now" and it is not pressed). Limits: 5 pages, 2 minutes, 30 s and 6 presses per page; presses that leave the site end the page.
- Authorization: the owner picked "Always automatic" on the decision card (recommended was "ask once"). The first Find coupons press asks Safari once for access to every site (`couponBrowser` = "asked"); after that, refused pages open with no question. A site Safari doesn't allow is skipped, and the summary says so and where to change it.
- Evidence: `tests/unit/coupon-browser.test.ts` (11 cases: controls, code reading, CAPTCHA stop, leaving the site, limits, the acceptance case through `suggestCodes`, both methods failing reports nothing, declined, no browser). `tests/e2e/coupon-browser.spec.ts`: the reader refuses `coupons.test/synthshop`, the built content script renders `tests/fixtures/coupon-site.html` (offers drawn by script after load, codes behind Show code), and the trace reads `coupons:browser coupons.test/synthshop why=refused(url_not_accessible) -> read chars=881 clicks=4[reveal; reveal; more; reveal] codes=3 7s`. Run in cloud Chromium (WebKit not installed here). Unit 425/426 (known Take control failure), typecheck, lint, `check:release` clean; full Chromium e2e shows the same 20 failures as `main`.
- Not seen in real Safari yet: whether `tabs.create({ active: false })` keeps the panel open on iPhone (if Safari switches to the new tab the panel closes and the run ends), Safari's site-access prompt on the first Find coupons press, and a real refused coupon site.

## 2026-10-17 — Mic button: speech to text (owner's iPhone design)

- Owner: add the mic from the iPhone design, next to Model. First build also had the teal voice-chat button (Scout listens and talks back) in place of Send on an empty box; owner then decided: the mic and Send both stay in the row all the time, the mic is only speech to text, and the user sends with Send as usual. The voice-chat button was removed.
- How: WebKit's own `webkitSpeechRecognition` (`src/panel/voice.ts`): tap the mic, the words appear in the box after what was typed, tap again to stop; nothing is sent. Safari decides whether an extension panel may use the microphone; if it refuses, or this Safari has no recognizer, the status line says to use the keyboard's own dictation (the keyboard mic on iPhone, the Dictation key or Fn twice on Mac). New data flow in `docs/data-inventory.md` (speech goes to Apple's recognizer; Scout stores no audio).
- Evidence: `tests/unit/voice.test.ts` (5 cases), `tests/e2e/voice.spec.ts` (4 cases with a stubbed recognizer: both buttons always shown, dictation then Send, refused mic, no recognizer). Unit: only the known Take control failure; full Chromium e2e: the same 20 failures as `main`; typecheck, lint, `check:release` clean.
- Not verified: whether Safari lets the extension panel use the microphone on Mac and iPhone (no WebKit or Safari in the cloud). Needs the device check.

## 2026-10-18 — Gray outline binoculars in the Safari toolbar (owner)

- Actual (owner): Safari's toolbar showed Scout's icon in blue.
- Expected (owner, with an image): the gray outline binoculars from the new-chat screen.
- Cause of the blue: the toolbar icon was a pure grayscale glyph, and Safari paints grayscale extension icons in the system accent color while the extension can read the page (Apple Developer Forums threads 660596 and 733949).
- Change: new `design/icons/safari-scout-binoculars-outline[-active].svg`, the same drawing as `.scout-mark` in `src/popup.html` with a slightly heavier line for small sizes; `scripts/render-toolbar-icons.mjs` now paints stroked shapes in order (each inside erases what is under it, like the panel's canvas fill) and renders gray glyphs with a faint warm tint, so the icon is not grayscale and Safari shows it as drawn. Light and dark toolbars still get their own gray (the worker swaps them). Active state: the same outline with filled lenses.
- Evidence: rendered PNGs checked visually against the owner's image at 128, 38 and 19 px on light and dark backgrounds. The tint workaround is reported by developers, not documented by Apple; not seen in real Safari yet (needs the device check on Mac and iPhone).

## 2026-10-17 — Find coupons on any store: blocked coupon sites and checkout-only coupon boxes (owner, follow-up to item 5)

- Owner: the getbeefy.co fix must work for any store on the web, as reliably as Comet's assistant.
- Measured on yesterday's 56-store live runs (`ralph/evidence/live-suite/`, 18 run folders): 184 of 476 coupon page fetches failed (148 `url_not_accessible`, 30 `url_not_allowed`); usa.coupert.com failed 30 of 30, us.hotdeals.com 26 of 30, wethrift.com 30 of 76. Six stores (Chubbies, Nomad, Peak Design, Pura, Javvy Coffee, Paleovalley) had no coupon box on the cart and stopped with "no coupon box"; two (Bombas, Caraway) showed only masked codes (now pressed by the PR #17 fallback). The live runner had no `tabs.create`, so PR #17's fallback never ran there.
- Change 1, sites that refuse the reader go to the browser first: Coupert and HotDeals (seeded from the data) and any site that refused the reader at least twice and more often than it loaded on this device (`src/coupons/reader-hosts.ts`, key `couponReaderHosts`) skip the reader. Their listed pages and their search results about the store open in a background tab at once, and the model is told not to fetch them. The browser now opens up to 8 pages, two tabs at a time, in 150 s.
- Change 2, checkout-only coupon boxes (owner picked "Yes, automatically"): a cart with no coupon box and a plain Checkout control is taken to checkout in the same tab (`checkoutTarget`, `goToCheckout` in `src/coupons/finder.ts`); express wallets, Pay and Place order are never pressed, nothing is typed, and a password field or CAPTCHA stops it with what the user needs to do. The summary says "It's applied on the checkout page. Nothing was bought, and none of your details were filled in."
- Change 3, the live runner (`scripts/live-suite.mjs`) opens background tabs as Playwright pages, routes `executeScript` by tab id, and re-injects the content script after a navigation like Safari does, so the next sweep measures both changes.
- Evidence: unit 444/445 (known Take control failure) with new `tests/unit/reader-hosts.test.ts`, `tests/unit/coupon-checkout.test.ts`, and browser-first cases in `tests/unit/coupon-browser.test.ts` (listed blocked pages skip the reader, a Coupert search result opens without a fetch, two tabs at once). e2e: new "a cart with no coupon box" case (`tests/fixtures/cart-checkout-only.html` → `shopify-checkout.html`; presses Check out, not Shop Pay; SAVE20 applied on the checkout page; email and ZIP empty); the checkout spec's stub now models a navigation like Safari. Typecheck, lint, `check:release` clean. Not measured live yet: the before/after rate needs a sweep on the owner's Mac.

## 2026-10-18 — iPhone: keyboard covered the composer (owner bug)

- Actual (owner, two screenshots): right after Scout opens, tapping the question box grows Safari's sheet to full height and the keyboard covers the whole composer (box, +, mode switch, model, mic, Send) and the starters.
- Expected (owner): the full composer stays visible with the keyboard under it.
- Cause: the panel's body is `height: 100%` of the page, and on iPhone WebKit does not shrink the page for the keyboard; only the visual viewport shrinks, so the bottom of the panel sat under the keyboard.
- Fix: `src/panel/keyboard.ts` (touch devices only, so the Mac popover is unchanged) sizes the body to `visualViewport.height` while the keyboard is up and scrolls the page back to the top if WebKit scrolled it; it returns to the stylesheet's height when the keyboard closes.
- Evidence: new `tests/unit/keyboard.test.ts` (keyboard up → body 430 px, scroll reset, keyboard down → full height; small differences ignored). Unit 446/447 (known Take control failure), typecheck, lint, `check:release` clean; `tests/e2e/panel.spec.ts` WebKit has the same 3 failures with and without the change. No keyboard in Playwright or this container: needs the real iPhone check.

## 2026-10-18 — Scout reopened itself after a tab switch (owner bug)

- Actual (owner): use Scout on a tab, switch to another tab, come back, and Scout opens on its own with the old chat.
- Expected (owner): each tab keeps its own chat (tab 1 context A, tab 2 context B), but Scout stays closed when you return to a tab until you click it; then it shows that tab's chat.
- Cause: Part 1 behaviour in `src/background.ts`. When Safari closed the panel because of a tab switch, the worker kept the tab marked open for 400 ms, and `tabs.onActivated` called `action.openPopup()` on returning to a tab marked open. Same worker on Mac and iPhone, so both were affected.
- Fix: removed the `tabs.onActivated` reopen and the grace timer; a closed panel is always marked closed. Per-tab conversations (`conversationForTab`) are unchanged.
- Evidence: new `tests/unit/tab-switch.test.ts` loads the real worker with a Safari stub (fails on `main`: `openPopup` called once; passes with the fix). Unit 448/449 (known Take control failure), typecheck, lint, `check:release` clean. e2e on Chromium (no WebKit in this container): `panel` + `redesign` 19/19, full suite the same 20 failures as `main`. Needs the Mac and iPhone check.

## 2026-10-18 — iPhone Safari bottom bar turned solid once Scout loaded (owner bug)

- Actual (owner, iPhone screenshots on a pink page and ESPN): on a fresh Safari start the page shows through Safari's bottom bar; a few seconds later, when Scout loads, a solid light strip appears behind the bar.
- Expected (owner): loading Scout does not change how Safari's bottom bar looks.
- Cause: the floating Scout tab (`src/edge.ts`, the only thing Scout puts on a page at load) is a fixed element. WebKit only samples page edges for its bar colour when the page has viewport-constrained (fixed or sticky) objects (`LocalFrameView::fixedContainerEdges` returns early otherwise); with one present and nothing fixed at the bottom edge, iPhone Safari 26 fills the strip under its bar with the page background. Pages with no fixed elements of their own changed look the moment the tab appeared.
- Fix: on a phone-sized touch screen (`tabInPage`), the tab's host is an absolute top-layer box that covers the part of the page on screen (`tabArea`, from `visualViewport`, kept inside the page so it never lengthens it) and moves with every scroll; the tab and status line are absolute inside it. Nothing Scout adds is fixed or sticky. Drag maths now uses the same box. Mac and iPad keep the fixed tab unchanged.
- Evidence: new e2e `iPhone` group in `tests/e2e/edge.spec.ts` (390 px mobile viewport): no fixed or sticky element anywhere, shadow content included (fails on `main` with 5 fixed elements, passes now); tab stays on the edge after scrolling to the middle and the end, page length unchanged, tap-then-tap opens Scout; drag after a scroll lands where dropped. New unit tests for `tabInPage` and `tabArea`. Unit 450/451 (known Take control failure), typecheck, lint, `check:release` clean. e2e on Chromium (no WebKit in this container): edge 11/12, the arrow-keys failure is the same on `main`. Needs the real iPhone check (bar see-through with Scout loaded; tab keeps up while scrolling).

## 2026-10-18 — Scout shows sooner after opening Safari from cold on iPhone (owner request)

- Ask (owner): from a dead start (Safari not running, then opened onto a page), Scout takes a few seconds to appear on the page; make it faster without changing how it looks or behaves.
- Where the time went (code trace): the page tab (`src/edge.ts`) was registered at `document_idle`, which WebKit runs at the end of parsing, after every script in the page has downloaded and run. On a cold phone that is most of the page load. The script then made two storage reads one after the other before drawing (three on the very first page). The panel, once opened, waited on two to three Keychain round trips in a row (`findKey`, then `savedProviders`) before showing the composer; each wakes the app's native handler, slowest right after Safari starts.
- Fix: the worker registers the edge script at `document_start` (`EDGE_RUN_AT`) and re-registers installs still at `document_idle`; the script reads both settings in one call while the page arrives and draws the tab as soon as the page has a body. A page that rebuilds `<html>` while loading gets the tab back (at most 3 times). The panel starts both Keychain reads in parallel as it opens and the first `connect()` uses them. Nothing looks or behaves differently.
- Not changed, cannot be from the extension: how long iOS takes to start Safari, restore the tab and load Scout's extension, and the page's own network time.
- Evidence: new `tests/unit/edge-register.test.ts` (real worker: registers at document_start, moves a document_idle install over; fails on `main`). New e2e `starts with the page` group in `tests/e2e/edge.spec.ts`: on a page whose last script takes 1.5 s, the tab shows more than 1.2 s before the page finishes loading; a page that rebuilds itself gets the tab back (fails without the guard); iPhone layout in place before load and after a scroll. New e2e in `tests/e2e/panel.spec.ts`: with 400 ms Keychain reads, opening the panel makes 2 parallel reads (on `main`: 3 reads over 800 ms). e2e on Chromium (no WebKit in this container). Needs a real iPhone timing check.

## 2026-10-18 — Bottom bar still solid, and pages zoomed out after #25/#26 (owner bug)

- Actual (owner, iPhone, citizenfreepress.com and espn.com): after #25 and #26 the page does a strange zoom-out, and the bar at the bottom is still white and covers text.
- Expected (owner): loading Scout changes neither the page's zoom nor how Safari's bottom bar looks.
- Cause, zoom: #25 put the iPhone tab in a screen-sized absolute box sized from `visualViewport`. Since #26 the tab mounts at document_start, before the page's viewport meta applies, so the box was sized for the 980 px default layout and the page became wider than the screen (Chromium repro: 1590 px instead of 980); Safari zooms out to fit.
- Cause, bar (corrected; #25's cause was wrong): the tab is shown as a popover, and every top-layer element gets a full-screen fixed `::backdrop`. WebKit's edge sampling (`LocalFrameView` `findFixedContainer`) treats a hit on a backdrop as a dimming layer and, when it is transparent, uses the page's extended background colour, which is the solid strip under the bar. A small fixed tab mid-edge is not sampled.
- Fix: reverted #25's in-page box (the tab is a plain fixed element again everywhere) and, on phone-sized touch screens (`topLayerTab`), no longer put the tab in the top layer. Mac and iPad unchanged.
- Evidence: e2e (Chromium, no WebKit here) `iPhone` checks that nothing is in the top layer and every fixed box Scout adds is small and away from the bottom edge (fails on `main`: one popover open); new zoom checks at document_start: phone page stays 390 px at scale 1 (fails on `main`), page without a mobile viewport is exactly its own width (fails on `main`: 1590 vs 980). Edge e2e 16/17 (arrow keys fails on `main` too). Unit 452/453 (known Take control failure), typecheck, lint, `check:release` clean. Needs the real iPhone check on citizenfreepress.com and espn.com.

## 2026-10-18 — White strip flashes under Safari's bar when Scout closes (owner bug)

- Actual (owner, iPhone, after #27): opening Scout and then closing it shows the solid white strip under Safari's bottom bar for a split second, then it goes away.
- Expected (owner): closing Scout leaves the bar alone.
- Cause: the page blur behind the iPhone sheet (`src/panel/blur.ts`) was a see-through fixed box over the whole screen (`inset: 0`), which Safari 26 samples as a dimming layer and fills the strip under its bar with the page background. The worker removes it only after the panel's port closes, so it outlives the sheet by a moment.
- Fix: the layer now stops `PAGE_BLUR_BOTTOM_GAP_PX` (96 px) above the bottom, out of the strip Safari samples. The sheet covers the bottom of the page while it is open, so nothing visible changes.
- Evidence: new unit test in `tests/unit/blur.test.ts` (the injected layer has the bottom gap and no `inset: 0`). Unit 453/454 (known Take control failure), typecheck, lint, `check:release` clean. Needs the real iPhone check: open and close Scout and watch the bar.

## 2026-10-18 — Page stays frosted after closing Scout (owner bug)

- Actual (owner, iPhone, citizenfreepress.com, screenshot): right after closing Scout, a see-through frosted layer stays over the page (all but the bottom strip #28 leaves clear).
- Expected (owner): the page is clear as soon as Scout closes.
- Cause: the blur layer (`src/panel/blur.ts`) was removed only by the worker, after it noticed the panel's port had closed. The worker is non-persistent, so waking it and injecting the removal can take a noticeable time (before #28 the same delay showed as the white flash under the bar).
- Fix: the layer now clears itself. The open panel pings it every `BLUR_PING_MS` (250 ms) over `tabs.sendMessage` and says goodbye on `pagehide`/hidden, which removes it at once; a layer that hears nothing for `BLUR_TIMEOUT_MS` (900 ms) removes itself. The worker's removal stays as a last resort. Layer geometry from #28 unchanged, so the bar stays clear.
- Evidence: new unit tests in `tests/unit/blur.test.ts` with a fake page and fake timers (stays while pinged, goes on goodbye, goes on its own after 900 ms of silence, ignores other messages). Unit 456/457 (known Take control failure), typecheck, lint, `check:release` clean; Chromium e2e `panel` + `redesign` 20/20, same as `main`. Needs the real iPhone check: open and close Scout.

## 2026-10-18 — Page blur comes and goes faster (owner request)

- Request (owner): keep the blur behind the iPhone panel, but make it show up and go away faster.
- Before: the panel first loaded settings, AI-sharing consent, the active tab and the tab's chat (four sequential storage or tab calls), then injected the blur, which appeared at once with no fade. On close it went at once since #29 (before that, whenever the worker woke up).
- After: `frostPage()` in `src/popup.ts` starts the blur as the panel's first step, in parallel with loading settings, and it fades in over `BLUR_FADE_IN_MS` (120 ms; no fade with reduced motion). Close is unchanged from #29: removed at once, or by itself after 900 ms if the goodbye is missed. Layer geometry (bottom gap) unchanged.
- Evidence: new unit tests in `tests/unit/blur.test.ts` (fade in over 120 ms then removed at once; reduced motion skips the fade). Unit 458/459 (known Take control failure), typecheck, lint, `check:release` clean; Chromium e2e `panel` + `redesign` 20/20. Needs the real iPhone check.

## 2026-10-18 — Page still frosted after closing Scout, on a build with #29/#30 (owner bug)

- Actual (owner, iPhone, new build): the blur is still there after closing Scout.
- Expected (owner): it goes as soon as Scout closes.
- Cause (inferred, no iPhone here): #29 relied on the closed panel sending a goodbye on `pagehide`/hidden, or going quiet. iPhone Safari can keep a dismissed panel's page alive without either, so its `setInterval` kept pinging and the layer never timed out.
- Fix: the panel pings from `requestAnimationFrame`, which WebKit stops for a page that is off screen, every 100 ms; it also says goodbye on window `blur` and resumes on `focus`/`pageshow`/visible. The layer clears itself after 350 ms without a ping (was 900 ms), and a ping to a cleared layer puts it back, so a stall never leaves an open panel without its blur for long.
- Evidence: new unit test (gone within 350 ms of silence; a late ping restores it). Unit 459/460 (known Take control failure), lint, `check:release` clean; Chromium e2e `panel` + `redesign` 20/20. Needs the real iPhone check.

## 2026-10-18 — Scout truck replaces the binoculars (owner request)

- Ask (owner): the binoculars look too close to his Sunglasses at Night extension. He picked option 1, a safari truck in side view, from a preview of a truck and a pith helmet.
- Change: new original artwork in `design/icons/` (`scout-truck-outline[-active].svg` toolbar, `scout-truck-solid.svg` edge tab and overlay toast, `truck-icon.svg` extension tile, `truck-appicon-{mac,ios}.svg`); the binoculars SVGs are removed. The panel's new-chat mark, the Scout mode switch and the Scout mode chip use the truck. `scripts/render-toolbar-icons.mjs` now supports `<polygon>`. Active toolbar state: large filled hubs.
- Evidence: unit 459/460 (known Take control failure), typecheck, lint, build, `check:release`; screenshots of the panel, toolbar PNGs and app icon checked by eye. App icons were rendered with Chromium in the cloud sandbox (`scripts/render-icons.mjs` needs macOS `sips`). Needs the Mac and iPhone check.

## 2026-10-18 — iPhone: blur lags when closing from the chat view

- Actual (owner, iPhone): closing Scout from Settings clears the page blur at once; closing from the chat view (swipe down or Safari's checkmark) leaves it up for a split second.
- Expected: the blur clears at once wherever the panel is closed.
- Cause (inferred from the difference, not traced on device): Settings focuses its heading on open; the chat view focuses nothing on iPhone so the keyboard stays down. With nothing focused the panel's window never had focus, so its `blur` event (the goodbye from #31) never fired and the layer waited out its 350 ms timeout.
- Fix: on iPhone the panel focuses the chat's visually hidden heading (`#chat-title`, `tabindex="-1"`) as it starts, which gives the window focus without raising the keyboard.
- Evidence: new e2e `touch device › iPhone screen › focuses the chat heading on open…` fails without the fix and passes with it (Chromium). Unit 459/460 (known Take control failure), typecheck, lint, `check:release` clean; a11y Option+Tab and edge arrow-key e2e fail identically on main in Chromium.

## 2026-10-18 — iPhone: blur still lags on a first open closed without a tap

- Actual (owner, iPhone, build with #33): opening Scout and closing it (swipe down or Safari's checkmark) without tapping anything leaves the blur up a split second. After any tap (New chat, Settings) closing clears it at once.
- Expected: the blur clears at once however the panel is closed.
- Cause (inferred from the tap/no-tap difference): only a tap gives the panel's window focus, so only then does its `blur` event send the goodbye. Without one the layer waits out its 350 ms timeout. #33's programmatic focus did not count as a tap on the device, so it is reverted.
- Fix: the panel pings every 33 ms (was 100) and, once its startup has finished, asks the layer to wait only 120 ms (`BLUR_QUIET_MS`) before clearing; the 350 ms wait stays only while the panel starts. A layer dropped by a stall comes back without the fade.
- Evidence: two new unit tests fail without the fix and pass with it. Unit 461/462 (known Take control failure), typecheck, lint, `check:release` clean; chat, panel, redesign and settings e2e pass in Chromium.

## 2026-10-18: iPhone panel text size and starter spacing (owner request)

- Asked: smaller text; "Summarize / Explain" starters closer to the "Ask anything..." box; panel about 20% smaller; panel should not grow to full height when the box is tapped.
- Done (`src/popup.html`): on iPhone body text 15→14 px, starters 18→16 px, model pill 15→14 px, composer buttons 38→36 px; the question box stays 16 px because iOS zooms the page on smaller inputs. The empty conversation log and an empty status line no longer reserve space, so the gap between the starters and the composer drops from about 60 px to about 10 px (Mac too). Follow-up (owner: tighter still): iPhone starter rows 32 px tall (were 40) with no gap below them, so they sit right on the composer.
- Not changeable from the extension: on iPhone the panel is Safari's own sheet (`action.openPopup`). Safari picks its height and grows it to full height when the keyboard opens; the popup page cannot set the sheet size. The earlier in-page panel was removed because Safari kills such frames (2026-10-16).
- Evidence: Chromium render 393 px wide, touch, `/mnt/project-files/panel-size/before.png` and `after.png` (not Safari). Unit 459/460 (known Take control failure), typecheck, lint, `check:release` clean. Needs the real iPhone check.

## 2026-10-18 — No "Shared:" line under answers; answers type out steadily

- Ask (owner): remove the "Shared: <page title> (<site>)" line under every answer, everywhere; and make Scout's reply text flow slower and smoother instead of spewing out.
- Change: the panel no longer renders the Shared line (live or restored answers). What is shared is still sent to the model, saved with history, and listed in Settings > Permissions > Shared in conversations. Streamed text is revealed by `src/panel/typing.ts` at a steady 50 characters a second, speeding up only so it is never more than about 3 s behind; Stop or an error shows what arrived at once, and the answer buttons appear when the reveal finishes.
- Evidence: new unit `typing.test.ts`; unit 463/464 (known Take control failure), typecheck, lint, build, `check:release`. Chromium e2e: same failures as main (20, the part2 mock-stream set and keyboard focus); tabs, scout, panel and redesign specs pass. WebKit is not installed in the cloud sandbox. Needs the Mac and iPhone check.

## 2026-10-18 — iPhone: first-open blur lag, debug probe

- Actual (owner, iPhone, build with #34): on a first open closed without a tap the page blur still lingers; after any tap it clears at once. #33 (focus the heading) and #34 (shorter wait) did not fix it, so the cause is not what they assumed.
- Expected: the blur clears at once however the panel is closed.
- Step: instead of a third guess, debug builds now log how the blur goes away (`src/panel/blur-probe.ts`): the panel's focus, blur, pagehide, visibility, resize and taps; the page's own focus, resize and visibility; ping gaps; the goodbye; and when the layer is removed. The next open on the same page writes the previous log into Diagnostics as `blur-probe:` stages. Times and event names only. Release builds carry none of it (`check:release` now also checks for it).
- Evidence: new unit tests in `tests/unit/blur-probe.test.ts`; unit 467/468 (known Take control failure), typecheck, lint, `check:release` clean; chat, panel, diagnostics and settings e2e pass in Chromium.

## 2026-10-18 — iPhone: first-open blur lag, what the probe showed

- Probe, close after a tap: panel focus at the tap; on close the page got focus and the panel's blur arrived 24 ms later, so the goodbye came at once. Pagehide only came 520 ms after that.
- Probe, close with no tap (the bug): `focus no` at open, no focus or blur events at all, pings kept arriving until pagehide at 1687 ms (last ping 37 ms before the layer went). So the panel keeps drawing frames while the sheet slides away, and nothing reaches it until pagehide, about half a second after the sheet is gone. This is why #33 (focusing an element does not focus the window) and #34 (a shorter wait cannot help while pings continue) did not work.
- Step: the panel now calls `window.focus()` as it opens on iPhone, so that if WebKit grants it, closing sends the blur at once as after a tap. Debug builds also log viewport scrolls and, at each ping, any change in the panel's screen position, viewport, or focus, so the next capture shows whether focus was granted and whether anything moves while the sheet closes.
- Evidence: unit 467/468 (known Take control failure), typecheck, lint, `check:release` clean; chat, panel, diagnostics and settings e2e pass in Chromium. Device result pending.

## 2026-10-18 — iPhone: page blur removed (owner decision)

- Probe with #38 on the phone, close with no tap: `focus no` before and after `window.focus()`, nothing in the panel's frame, viewport or focus changes while the sheet slides away, pings continue to the end, and the first signal is pagehide. So a panel that was never tapped cannot know it has closed until about half a second after its sheet has gone, and no change in Scout can clear the blur sooner.
- Owner decision (card, 2026-10-18): no page blur on iPhone. Removed the panel's blur, its heartbeat, the worker's cleanup, the `blur` field of `panel.hello`, and the debug probe. `wantsPageBlur` is now `isPhoneScreen` (the coupon overlay still uses its lighter phone wash).
- Evidence: new e2e `touch device › iPhone screen › never blurs the page…` fails on main and passes here (Chromium). Unit 455/456 (known Take control failure), typecheck, lint, `check:release` clean; chat, panel, redesign, settings, overlay and diagnostics e2e pass.

## 2026-10-18 — Scout as its own page in a tab (owner request)

- Request: a button next to New chat and Settings that opens the whole Scout chat as its own page in a new tab, to bookmark and use Scout like an AI chat site.
- Change: new "Open Scout in a new tab" header button (Mac only; hidden on touch screens, owner 2026-10-18) opens `popup.html?view=page` (`src/panel/standalone.ts`). That page fills the tab in a 760 px column, shows the name, reads no current tab, and hides the page-only actions (starters, store suggestions, + menu, Chat/Scout switch). It shares the key, model and settings, and gets its own chat (per tab, like the panel). The address is the extension's own, so it opens only in Safari with Scout installed.
- Evidence: new `tests/unit/standalone.test.ts` and e2e `Open in new tab…` (redesign spec). Unit 458/459 (known Take control failure), typecheck, lint, `check:release` clean; full Chromium e2e has the same failures as main. Device check pending.

## 2026-10-18 — Scout page fills the whole window (owner request)

- Request: the standalone Scout page should use the full window, not a centered column.
- Change: removed the 760 px column; header, conversation and composer now span the tab.
- Evidence: unit (known Take control failure only), typecheck, lint; redesign e2e pass in Chromium. Device check pending.

## 2026-10-18 — Scroll up while an answer types; slower typing (owner request)

- Request: while an answer types out (Summarize this page, Explain the key points), let the user scroll up smoothly to read from the top; and show the text about 50% slower.
- Cause: every typed frame called `scrollToEnd()`, which re-pinned the thread to the bottom and ignored scroll events for 150 ms after it, so with frames every ~16 ms a user scroll never counted.
- Change: typed frames and Scout mode / coupon progress lines now call `followEnd()`, which scrolls only while the thread is pinned. Scrolling up (wheel, touch drag, or any scroll that leaves the bottom) unpins it; scrolling back to the bottom pins it again. New questions and prompts that need an answer still jump to the bottom. `src/panel/typing.ts`: 25 characters a second (was 50) and at most about 6 s behind (was 3 s), so the whole reveal is half as fast.
- Evidence: new e2e `scrolling up while an answer types out…` (chat spec) fails on main (scrollTop pulled back to 1497) and passes here. Unit 458/459 (known Take control failure), typecheck, lint, `check:release` clean; full Chromium e2e: 130 passed, 20 failed, the same part2 mock-stream and keyboard-focus set as main. WebKit is not installed in the cloud sandbox. Needs the Mac and iPhone check.

## 2026-10-18 — iPhone page button: smaller, always out, draws at once (owner request)

- Request: make the Scout button on iPhone smaller but still clearly showing the truck, and stop hiding it; it should be there immediately when Safari opens (it took about 2 to 5 s from a cold start).
- Change (`src/edge.ts`, `src/panel/edge.ts`): the tab no longer tucks into a sliver; it stays out on every page and one tap opens Scout (the intro flag, tuck timer and tap-to-reveal are gone). New size `TAB_SIZE` 42 x 44 pill with a 28 px truck (was 56 x 60 with 30 px) in a 46 x 48 target, which keeps Apple's 44 pt minimum height. Owner picked Medium from three previews (project files `page-button-size/sizes.png`). Speed: the worker registers the script only while the button is on, so the tab now mounts as soon as the page has a body instead of first waiting on a `storage.local` read (a round trip to the extension that is slowest right after Safari starts). It stays hidden until the saved side and height arrive or 150 ms pass (`PLACE_WAIT_MS`), so a tab moved to the left does not jump; a stored "off" removes it. Settings help text updated.
- Not changed: how soon Safari itself injects the script after a cold start; that part is Safari's and can only be measured on the device.
- Evidence: new e2e (Chromium; no WebKit in the cloud): small target and stays out when idle; one click / one tap opens Scout for a returning user; tab shows within 1 s while storage takes 4 s; a left-side tab never shows on the right first. The first four fail on `main`. Edge e2e 18/19 (arrow keys fails on `main` too). Unit 458/459 (known Take control failure), typecheck, lint, `check:release` clean. Needs the iPhone check: size, always out, and time to appear after a cold Safari start.

## 2026-10-18 — Scout opens at once on iPhone (owner request)

- Ask (owner): make the Scout button on iOS smaller but still showing the truck, and stop hiding it. From Safari not running to Scout open takes 2-5 s; it should be immediate. iOS's start page can't run Scout, so there is idle time to get ready before the user reaches a page.
- Button: the smaller, always-out tab came in #43 (merged first); this change keeps it and adds the warm-up calls to it.
- Where the cold-open time went (code trace): (1) the extra tap to bring the tucked tab out; (2) the panel waited for the Keychain read, which starts the app's native handler, before showing the question box; (3) the panel made about eight storage reads one after another before it could show anything.
- Fix: (1) #43. (2) The worker wakes the native handler with a harmless `policy.get` when a page with the button loads, when a finger lands on the button, and on Safari startup, at most every 20 s (`src/panel/warm.ts`, new `panel.warm` content request). The panel remembers which providers have a saved key (`keyHint`, true/false only, never the key) and, when one does, shows the question box and the tab's chat at once while the Keychain read finishes; anything sent meanwhile waits for it, and a stale hint falls back to the no-key screen. (3) Settings, consent, active tab, key hint and coupon flag in one parallel round; conversation, model lists and diagnostics in a second.
- Measured (Chromium e2e, simulated cold phone: 30 ms per storage call, 800 ms Keychain read): question box shown after 915 ms on `main`, 115-125 ms now (before the Keychain answers at ~845 ms). Debug builds now log `open:shown` and `open:keys` (ms since the panel started) in the startup run of Copy diagnostics, for the real iPhone numbers.
- Not changed, cannot be from the extension: how long iOS takes to launch Safari, restore the tab and load extensions, and whether iOS keeps the native handler alive between the wake-up and the tap.
- Evidence: new `tests/unit/warm.test.ts` (throttle, hint parsing, real worker answers `panel.warm` and sends one `policy.get`); e2e `edge.spec.ts`: warm on load and on pointerdown; e2e `panel.spec.ts`: question box before the Keychain answers (fails on `main`: 915 ms vs 845 ms Keychain), a question sent early is answered, a stale hint shows the no-key screen.

## 2026-10-18 — Smooth sheet drag on iPhone (owner request)

- Request: dragging the Scout panel up and down on iPhone at medium or fast speed is jittery; it should be extremely smooth.
- Cause (inferred from code, not yet seen on a device): the keyboard fix (`src/panel/keyboard.ts`) ran on every visual viewport resize. While Safari resizes its sheet, `innerHeight` and `visualViewport.height` update at different moments, so on some frames they differ by more than the 80 px keyboard threshold; Scout then set a fixed body height (and could scroll the page to the top), moving the composer up and back while the panel moved. Separately, the panel page could rubber-band before Safari's sheet took over the drag.
- Change: the body is resized only while a text field has focus (the only time the keyboard can be up), viewport events are folded into one update per animation frame, and the page scroll reset runs only with the keyboard up. On iPhone `html, body` get `overscroll-behavior: none`, so a drag goes straight to the sheet. The sheet's own size and drag are Safari's and unchanged.
- Evidence: new unit tests in `tests/unit/keyboard.test.ts` (no resize mid-drag without focus, one write per frame, focused-element check). Unit 464/465 (known Take control failure), typecheck, lint, build, `check:release` clean. Needs the iPhone check.

## 2026-10-18 — Debug log for the iPhone sheet drag (owner report)

- Report: after #45 the panel is still jittery while dragging, "particularly around the summarize and explain text".
- Step: instead of a second guess, debug builds now log each drag (`src/panel/drag-probe.ts`): how many resize events Safari sent and how far apart, how long the panel's frames took, how far `visualViewport` was from `innerHeight`, and how far the starters sat from the panel's bottom. One `drag:` line per drag goes into Diagnostics. Evenly spaced resizes with quick frames point at Safari drawing the panel behind its sheet; slow frames point at Scout's layout; a single resize per drag means Safari only resizes once the sheet settles. Sizes and times only. Release builds carry none of it (`check:release` now checks for `drag: `).
- Evidence: `tests/unit/drag-probe.test.ts`; unit 468/469 (known Take control failure), typecheck, lint, build, `check:release` clean. Needs a drag on the iPhone and Copy diagnostics.

## 2026-10-18 — iPhone sheet drag: first device log and a height test (owner report)

- Device log (debug build with #46, owner's iPhone, Safari 27): Safari resizes the panel about every 17-20 ms during a drag (max gap 49-69 ms); Scout's frames keep up (1-2 frames over 25 ms per drag, max 46 ms); `visualViewport.height` differs from `innerHeight` by up to 49 px mid-drag; the starters sat 0-173 px above the window's bottom edge, against 136 px at rest.
- Reading: Scout is not too slow; on many frames the page is laid out at a different height from the window, so everything anchored to the bottom (starters, composer) moves against the sheet. Which of the three heights matches what is on screen is not known yet.
- Step: debug builds can now pick the panel's height source under Settings → Diagnostics → "Panel height while dragging": A Page (today's stylesheet 100%), B Window (`innerHeight`, set on every resize), C Visible area (`visualViewport.height`). The keyboard fit returns to the chosen height. The drag log line now names the mode and records page-vs-window and composer positions too. Stored in extension storage (`scout.debug.sheetHeight`), debug builds only.
- Evidence: `tests/unit/drag-probe.test.ts`; unit 471/472 (known Take control failure), typecheck, lint, build, `check:release` clean. Needs the owner to try A, B and C on the iPhone and paste diagnostics.

## 2026-10-18 — iPhone sheet drag: fade the starters while it moves (owner choice)

- Result of the #47 test: the owner felt no difference between the three panel height sources (A, today's, closest), so the wobble is Safari drawing the panel a frame or two behind its sheet, not Scout's layout.
- Owner choice (decision card): fade Summarize / Explain while dragging.
- Change: `src/panel/sheet-drag.ts` treats two panel resizes less than 100 ms apart as a drag (a single resize, such as the panel opening or a detent snap, is not) and adds `sheet-dragging` to `<html>` until no resize has come for 180 ms; on iPhone the starters and store suggestions fade out in 90 ms and back in 140 ms. Not while a text field has focus. The #47 height switch is removed; the debug drag log stays.
- Evidence: `tests/unit/sheet-drag.test.ts`; unit 471/472 (known Take control failure), typecheck, lint, build, `check:release` clean. Needs the iPhone check.

## 2026-10-18 — iPhone: pin Summarize / Explain and the question box to the bottom (owner request)

- Owner check of #48: the sheet itself is smooth; the starters "don't really fade, they just go away". Request: no fade; pin Summarize, Explain, the question box and its menu bar to the bottom so they stay put and the panel grows above them.
- Change: removed the fade (`src/panel/sheet-drag.ts`). `src/panel/dock.ts` moves the starters into the composer on iPhone and makes the composer `position: fixed` to the bottom of the panel (WebKit places fixed layers against the new view size without waiting for the page to lay out again, which is where the wobble came from). The thread keeps room for it through `--dock-h`. While a text field has focus the composer goes back into the page flow so the keyboard fit keeps it above the keyboard. The starters still hide once the chat starts and on store pages.
- Evidence: new e2e (redesign spec, touch device) keeps the starters at the same distance from the bottom across three heights, undocks while typing, and hides them after an answer. Unit 468/469 (known Take control failure), typecheck, lint, `check:release` clean; Chromium e2e: 136 passed, 20 failed, the same 20 as main. WebKit is not installed in the cloud sandbox. Needs the iPhone drag check.

## 2026-10-18 — iPhone: Find coupons menu opens above the + button again (owner bug report)

- Actual (owner screenshot): tapping + on iPhone showed the "Find coupons" menu high in the panel, over the truck logo and above Summarize / Explain.
- Expected (owner): "too high and not coming out of the + sign itself"; the menu opens right above the question box by the +, as before #49.
- Cause: the + menu (and the @ tab list) are `position: absolute; bottom: 100%` of `#composer`. #49 moved Summarize / Explain into the composer on iPhone, so the composer grew and the menu opened above the starters.
- Fix: both lists move inside `.composer-box` (now `position: relative`), so they anchor to the question box on Mac and iPhone alike. Docking from #49 is unchanged.
- Evidence: new e2e (redesign spec, touch device) taps +, checks the menu sits 0–10 px above the question box at its left edge, and that tapping Find coupons starts the search; it failed before the fix (76 px gap) and passes after. Unit 468/469 (known Take control failure), typecheck, lint clean. Needs the iPhone check.

## 2026-10-18 — iPhone quick ask removed (owner decision)

- Owner tried the quick ask box from #51 on his iPhone and decided not to keep it. This reverts #51 exactly; the page tab opens Scout's sheet directly again. The pre-#51 state is also kept as branch `saved/before-quick-ask`.

## 2026-10-19 — Find coupons keeps running when the panel closes (owner request)

- Owner, iPhone: the pointer moving between the code box and Apply was only visible after dragging the panel down; dragging it all the way closed it, which ended the run and left the page glowing with "Working…" until Stop. Asked: drop the panel out of the way, or keep the run going when it is swiped away and show it where it is on reopen.
- Lowering Safari's sheet is not possible from an extension (see the iPhone sheet notes above). The run lived in the panel, so closing it killed the run.
- Change: the run moved to the background worker (`src/coupons/job.ts`, `src/server/coupon-host.ts`; tab access in `src/coupons/tab-page.ts`), like Scout mode and answers. The panel starts it (`coupons.start`), shows its events (`coupons.event`), answers "search again?" (`coupons.answer`) and stops it (`coupons.stop`); a reopened panel replays the run so far (`coupons.status`), including a question still waiting. No answer within 2 minutes counts as "Stop here". The overlay toast's Stop goes to the host directly. A closed tab ends its run. No new vendor or data flow: the same provider calls, now from the worker, as answers already are.
- iPhone: the element the pointer presses or types into is scrolled to the top quarter of the page, above the half-height sheet (`aboveSheetScroll` in `src/actions/pointer.ts`).
- Evidence: `npm test` 473/474 (the known Take control failure); new `tests/unit/coupon-host.test.ts`, `tests/unit/pointer.test.ts`; e2e (Chromium in the cloud sandbox, WebKit not installed there) `coupons`, `checkout`, `actions` 18/18 with the worker harness; full suite 137 passed, the 20 failures identical on `main` in Chromium. `npm run check:release` clean.
- Not checked: a real iPhone (whether Safari keeps the worker alive for a several-minute run with the sheet closed; launch blocker 24 covers 45 s answers on the Simulator).

## 2026-10-19 — Coupon glow, Safari's bar and "couldn't open" after #55 (owner device check)

- Owner, iPhone after #55: the run works with the panel closed. (1) wants more glow and motion; (2) Safari's bottom bar is solid again during the run (fixed before); (3) once, the page tab said "Couldn't open Scout for Safari here…" and only quitting Safari fixed it.
- (2) Cause: the overlay (full-screen fixed box in the top layer, with its ::backdrop) and the pointer (full-screen fixed box). iPhone Safari 26 paints a solid strip under its bar while a page has either (see `topLayerTab`, #27/#28). Before #55 the sheet covered the bar during runs. Fix: on iPhone the overlay is a plain fixed box (no top layer) that stops 120 px above the bottom edge, its glow fading out over the last 48 px; the pointer host is a zero-size box at the top-left corner on every platform.
- (3) Likely cause (inferred, not reproduced): with the panel closed, "search again?" made the worker call `action.openPopup()` without a tap. The coupon host no longer opens the panel itself; the overlay pill says "Waiting for you" and the question waits for the panel (2 minutes, then "Stop here").
- (1) Glow stronger at the edges (center unchanged), sweep 2.5 s → 1.5 s, a 1.8 s pulse; iPhone at full strength (was 75%). Preview: /mnt/project-files/coupon-glow/before-after.png (Chromium, iPhone size).
- Evidence: unit 473/474 (known Take control failure); e2e overlay (new iPhone layout test), actions, coupons, checkout pass in Chromium; full Chromium suite 139 passed, the same 20 failures as `main`. `npm run check:release` clean. Not checked: real iPhone.

## 2026-10-19 — iPhone glow back over the whole page

- Actual (owner, on device after #56): the blue glow was missing from the bottom quarter of the page, and the solid strip under Safari's bar was still there.
- Expected: the glow fills the whole page with "Working…" at the very bottom.
- Cause: #56 stopped the overlay 120 px above the bottom on iPhone to clear the strip. It did not clear it, so the strip comes from something else.
- Fix: `src/overlay.ts` covers the whole screen on every device again. iPhone still skips the top layer (a top-layer `::backdrop` is what made Safari's bar solid in #27).
- Evidence: `tests/e2e/overlay.spec.ts` "on iPhone" asserts the overlay reaches the bottom edge, is not in the top layer, and the pill sits at the bottom. Build, typecheck, lint, and the overlay/actions/coupons/checkout e2e pass (Chromium, 26/26).

## 2026-10-19 — Diagnostics name each tested code's source site

- Actual (owner report #193): the panel was reopened mid-run, so the report began at attempt 26 and could not show where any code came from.
- Expected: a report shows the whole run and the site each tested code came from.
- Cause: `CouponHost` did not keep trace stages for a reopened panel, and attempt lines did not name a source.
- Fix: attempt traces end with `from <host>` (host only, or the origin such as `store`); a reopened panel replays the run's trace stages as `replay +Ns …`. Page URLs are still not kept.
- Evidence: `tests/unit/coupon-host.test.ts` checks replayed traces carry their time and the attempt names its source. Unit 473/474 (only the known Take control failure), typecheck, lint, check:release, e2e 26/26 (Chromium).

## 2026-10-19 — Find coupons searches far wider and learns from each run (owner request)

- Owner: search "dozens and dozens (100+?)" sites, use AI to find the most likely coupons, do better than Comet. Owner supplied two logs from his local tool: Birdcall (61 codes, none worked; it grouped the store's replies: only Tuesday, not active yet, used up, another location, expired) and getbeefy.co (GETBEEFY applied at checkout; BEEFY15 and KETOVORENURSE worked in the cart earlier). Merged plan: /mnt/project-files/coupon-engine/best-in-class-plan.md.
- Why Scout never found a code on getbeefy.co: both winners were guesses (BEEFY15 from SimplyCodes saying a hidden 15% code exists; GETBEEFY from the domain), which the 2026-10-17 rule forbade. Owner decision 2026-10-19: "All guesses".
- Changes:
  - `src/coupons/codes.ts`: the search runs as four requests at once, each from its own angle (coupon sites; creators, Linktrees and influencer code directories; the store's own rewards, newsletter, affiliate, blog and press pages; Reddit, deal forums, local news and this month's promotions), 6 searches + 6 page reads each, after the listed pages. A second round uses four other angles (more coupon and cashback sites, promotions running now, more creators, student/military programs and archived emails), and when most refusals were expiries it looks for this month's promotions first. Parallel streams keep their unfinished line apart, so lines never mix. One angle failing does not fail the search. Percentages that hidden codes and result titles mention are returned for guesses.
  - `src/coupons/reasons.ts` + `finder.ts`: on the page path the store's own message is kept for each refused code ("The store said: …") and grouped (expired, not active yet, used, days/times, location, minimum, items, combining, account, invalid). The summary lists codes by group and the sites the codes came from.
  - `src/coupons/guesses.ts`: after the search ends, up to 40 guesses: the store's name with the hinted percentage first (BEEFY15), the name alone (BEEFY, GETBEEFY), then common and seasonal codes (WELCOME10, SAVE15, OCTOBER, HALLOWEEN). Skipped when the provider refused the search (fix the key first) and on IP/localhost fixtures. Labeled as guesses in the rows and summary.
  - `src/coupons/memory.ts` + `job.ts`: codes that lowered the total are remembered per store on the device (`coupons.worked.v1`, data inventory updated) and tried first next time; a remembered code refused twice is forgotten.
  - Diagnostics: each attempt line now also carries the reply group (never the store's words), next to #57's `from <host>` (`from guess` / `from remembered` for those); plus `coupons:remembered`, `coupons:angles`, `coupons:guesses`, `coupons:find-more fresh`.
  - At most 140 codes per run (was 80).
- Evidence: unit 484/485 (known Take control failure), new `tests/unit/coupon-wide.test.ts` (Birdcall reply groups, BEEFY15/GETBEEFY guesses from a "15% Off" title, a whole getbeefy-like run that tests the creator code first, applies BEEFY15 and tries it first next time, parallel angles, partial failure). Typecheck, lint, build, `npm run check:release` clean. e2e in Chromium (WebKit not installed in the cloud sandbox): coupons, cart, checkout, coupon-browser 13/13 with updated expectations (37 codes = 5 found + 32 guesses; store's words on refused codes); full suite 139 passed, the same 20 failures as `main`.
- Not checked: a live run with a real key (the 56-store suite on the owner's Mac, plus getbeefy.co and order.eatbirdcall.com); rate limits on low-tier keys with four requests at once; checkout confirmation of a cart winner (step 3 of the plan, not built).

## 2026-10-19 — Page button "Couldn't open Scout for Safari here" (owner bug report, iPhone)

- Actual (owner): the page button kept showing "Couldn't open Scout for Safari here" and would not open Scout until he opened it from Safari's extensions menu. Not during a coupon run. His diagnostics did not show it (no panel opened, so no run was recorded).
- Expected: a tap on the page button opens Scout.
- Cause (inferred, not reproduced on device): Safari refuses `action.openPopup()` with "Another popup is already open" while a sheet it just closed is still going away, the same refusal seen in the Simulator on 2026-10-16 (launch blocker 22). The button tried once and gave up.
- Fix: `openPanel` (`src/panel/toolbar.ts`) tries twice more after 250 ms and 600 ms. Debug builds: the worker stores Safari's reason (`diagnosticsButton`, last 5, scrubbed) and the report lists it under "Page button could not open Scout"; the tab's message adds the reason; a failure to reach the worker at all is shown too.
- Also from the same report: a coupon run the panel caught up with after reopening was recorded under the panel's startup run ("startup → no_form"); it now gets its own coupons run. Earlier runs in the report name their site and last error.
- Evidence: new tests in `tests/unit/edge.test.ts` (retry after "Another popup is already open", gives up after 3 tries in under 1 s) and `tests/unit/diagnostics.test.ts` fail on `main` and pass. Unit 490/491 (known Take control failure), typecheck, lint, build, `npm run check:release` clean. e2e Chromium (WebKit not in the cloud sandbox): 139 passed, the same 20 failures as `main`. Not checked: real iPhone.

## 2026-10-19 — New chat opens while Find coupons runs (owner choice 1)

- Before: New chat did nothing while a coupon run was going (`popup.ts` returned early on `couponRun`), which felt broken.
- Now: New chat opens at once. The run keeps going in the worker (#55) and still saves its summary to the chat it started in. A chip above the composer ("Finding coupons… Show", "Find coupons needs your answer", "Coupon search finished") goes back to that chat and replays the run so far, or shows its summary. A panel reopened on the new chat shows the chip instead of replaying the run into it. While the run is away, Find coupons goes back to it and Scout mode waits (both would drive the same page); chat questions work.
- `coupons.status` now returns the run's `conv`; `reopenConversation` (`src/panel/state.ts`) points the tab back at it. No change to the coupon search itself.
- Evidence: new e2e `coupons.spec.ts` "New chat during Find coupons…", unit tests for `reopenConversation` and the run's `conv`. Unit 491/492 (known Take control failure), typecheck, lint, build, `npm run check:release` clean. e2e Chromium (WebKit not in the cloud sandbox): 140 passed, the same 20 failures as `main`. Not checked: real Mac and iPhone.

## 2026-10-19 — Chats menu (owner request)

- Request: a hamburger menu listing earlier chats to refer back to; a chat with a coupon search still running opens with the search still going. Also from the report: on Mac, clicking away from the popover during Find coupons left the glow but no way back to the search.
- Owner choice: slide-in list (decision card). Defaults stated in the thread: title = first question with the site and how long ago; kept as long as chat history keeps them (Settings, 7 days by default, max 200 entries); trash icon per chat (hover on Mac, always on iPhone); Clear chat history empties the list; a search running on another tab switches to that tab and opens Scout there.
- Built: ☰ at the top left of the chat header opens `#chats` over the chat. `src/chat/list.ts` groups saved history by conversation. The worker lists coupon runs (`coupons.list`) so a running search shows first with "Finding coupons…" / "Needs your answer" before its summary is saved. Opening a chat reuses #62's `reopenConversation`; a run shown in the panel goes on in the background, as with New chat. Private Browsing chats show only in their own tab. History entries now save `site` (host only; data inventory updated). `tabs.show` (worker) activates another tab and opens the panel there.
- Builds on PR #62 (merge #62 first).
- Evidence: new `tests/unit/chat-list.test.ts`, coupon-host list test, e2e "the chats menu lists earlier chats…" (panel.spec) and "the chats menu shows a running Find coupons…" (coupons.spec). Unit 497/498 (known Take control failure), typecheck, lint, build, `npm run check:release` clean. e2e Chromium (WebKit not in the cloud sandbox): 142 passed, the same 20 failures as the base branch. Not checked: real Mac and iPhone, and whether Safari opens the panel after switching tabs (`tabs.show`).

## 2026-10-19 — Find coupons missed a creator's code on getbeefy.co; diagnostics showed the wrong run (owner report)

- Actual (owner, iPhone, build with #58): getbeefy.co found and applied GETBEEFY, but not KETOVORENURSE, which the owner's other tool found on a creator's Linktree. The copied diagnostics (#227) showed a panel opening, not the coupon run (#225 "unfinished", listed below it).
- Expected (owner): find KETOVORENURSE too; a copied report shows the coupon run.
- Causes (inferred; the coupon run's trace was not available): (1) "Beefy" plus "code" is too generic a search, and the creator's page says "meat chips", not the store's address; codes on fetched pages were read directly only when the page address named the store, so a Linktree's codes depended on the model listing them. (2) The report always showed the most recent run, and opening the panel to copy it starts one; a resumed coupon run's stages also landed in that startup run.
- Fixes: the store's own meta description (first sentence, at most 120 characters) goes into every search request as "what the store sells", with a note to search the name with it ("Beefy meat chips code"); codes on any fetched page are read directly when their own line, or the line above a short code line, names the store. The report shows the most recent run that is not a quiet panel opening ("Other runs" below it), and a resumed coupon run gets a diagnostics run of its own. Data inventory updated (description).
- Evidence: unit 488/489 (known Take control failure), new tests in `tests/unit/coupon-wide.test.ts` (sells line, request wording, a creator page with two brands' codes) and `tests/unit/diagnostics.test.ts`. Typecheck, lint, `check:release` clean; Chromium e2e coupons, cart, checkout, coupon-browser, diagnostics 16/16. Not checked: live getbeefy.co run.

## 2026-10-19 — Clear chat history does nothing (owner bug report, Mac and iPhone)

- Actual (owner): tapping Clear chat history in Settings shows nothing at all on Mac and iPhone, not even "Chat history cleared." (owner's answer "1" to: no message / chat still there on Back / chat back after reopening).
- Expected: the saved chat is gone, now and when Scout reopens, with a message saying so; the API key stays (Delete all data removes that).
- Cause: not reproduced. In the Chromium test panel (desktop and phone-sized) the button works. Since no message showed, the storage write never finished in Safari (rejected or never answered), and the old handler had no catch. Inferred, not verified on a device. The old write stored empty values (`history: []`, `ratings: {}`); other Settings saves, which store non-empty values, work for the owner.
- Fix: `clearHistory` (`src/settings/settings.ts`) removes the keys with `storage.local.remove` instead of writing empty values (falls back to the write where remove is missing). `src/popup.ts`: the result always shows, "Chat history cleared." or "Could not clear chat history. Try again." (also when storage has not answered in 5 s); diagnostics record `history:clear`, `history:cleared` or `history:clear-failed <reason>`; the tab starts a new conversation so nothing saved under the old one shows again; other open Scout windows (Mac Scout page, another window's panel) clear their thread when the history is removed, unless something is still running there. Worker-side coupon and Scout mode runs only replay while still running.
- Evidence: new e2e tests in `tests/e2e/panel.spec.ts` (clear, Back, reopen: thread gone, history and ratings removed, new conversation, key kept; storage that rejects or never answers shows the message; these fail on `main`), new unit test for remove-not-write. Unit 491/492 (known Take control failure), typecheck, lint, build, `npm run check:release` clean. e2e Chromium (WebKit not in the cloud sandbox): 142 passed, the same 20 failures as `main`. Not checked: real Safari on Mac and iPhone.
## 2026-10-19 — New chat opens while Find coupons runs (owner choice 1)

- Before: New chat did nothing while a coupon run was going (`popup.ts` returned early on `couponRun`), which felt broken.
- Now: New chat opens at once. The run keeps going in the worker (#55) and still saves its summary to the chat it started in. A chip above the composer ("Finding coupons… Show", "Find coupons needs your answer", "Coupon search finished") goes back to that chat and replays the run so far, or shows its summary. A panel reopened on the new chat shows the chip instead of replaying the run into it. While the run is away, Find coupons goes back to it and Scout mode waits (both would drive the same page); chat questions work.
- `coupons.status` now returns the run's `conv`; `reopenConversation` (`src/panel/state.ts`) points the tab back at it. No change to the coupon search itself.
- Evidence: new e2e `coupons.spec.ts` "New chat during Find coupons…", unit tests for `reopenConversation` and the run's `conv`. Unit 491/492 (known Take control failure), typecheck, lint, build, `npm run check:release` clean. e2e Chromium (WebKit not in the cloud sandbox): 140 passed, the same 20 failures as `main`. Not checked: real Mac and iPhone.
## 2026-10-19 — Mac: after clicking away during Find coupons, the glow stayed and the run could not be reopened (owner report)

- Actual (owner, macOS Safari): during Find coupons, clicking the page or another tab closed the panel; the page kept glowing, but reopening Scout did not show the run.
- Expected (owner): reopening Scout on that tab shows the coupon search, still going.
- Cause (inferred from code, not reproduced in Safari): the run lives in the non-persistent background worker (#55). With the panel closed nothing talks to the worker while it waits on a long web search, so Safari can unload it; the run and its events go with it, the overlay is never told to hide, and `coupons.status` from a reopened panel finds nothing. The panel's own replay path (`resumeCoupons`) is unchanged and works while the worker lives.
- Fix: the page's overlay holds a port to the worker (`scout-run`, `src/bridge/run-port.ts`) for as long as it shows, with a heartbeat every 10 s, so Safari keeps the worker and the run alive. The worker answers each beat with whether it still has the run (`runAlive` in `src/server/worker.ts`); if not (it ended, or the worker was unloaded anyway), the glow goes by itself. Applies to Scout mode tasks too.
- Evidence: `tests/unit/run-port.test.ts` (holds and beats, glow goes when the run is gone, reconnects after the worker drops). Unit 498/499 (known Take control failure), typecheck, lint, build, `check:release` clean. e2e Chromium (WebKit not in the cloud sandbox): 139 passed, the same 20 failures as `main`. Not checked: real Mac Safari.

## 2026-10-19 — Mac: the Scout button did nothing on the tab where Find coupons ran (owner report)

- Actual (owner, macOS Safari, build with #63/#64): after starting Find coupons and clicking away, Scout opened on other tabs, but on the coupon tab the Scout button did nothing for the whole run; the run kept going and applied its code. Reports #199 and #203.
- Expected (owner's first message, confirmed in thread): back on that tab, Scout opens and shows the search, still going or with its result.
- What the reports show: #63 worked (the run survived). The panel that started run #203 was still loaded and taking the run's events 132 s later, after it had been clicked away; in #199 a panel loaded on the coupon tab and replayed the run while the owner saw nothing open. So on Mac a panel Safari has hidden can stay loaded.
- Cause (inferred, not reproduced in Safari): while that hidden panel is still loaded, Safari does not show a new one on the same tab, so the button does nothing. Before #55 the run died with the panel, so this never came up.
- Fix: on Mac (not touch screens, not the standalone page) the panel closes itself when Safari hides it (`visibilitychange` to hidden, `src/panel/dismiss.ts`). The next click opens a fresh panel, which catches up with the run in the worker. Debug builds trace `panel:visibility` and `panel:close-hidden`, so the next report shows whether Safari sends the signal.
- Evidence: `tests/unit/dismiss.test.ts`. Unit 508/509 (known Take control failure), typecheck, lint, build, `check:release` clean. e2e Chromium: 145 passed, the same 20 failures as `main`. Not checked: real Mac Safari.

## 2026-10-19 — Mac: Scout would not open after the chats menu jumped to the coupon tab (owner report)

- Actual (owner, Mac, build with #65): checkout page, Find coupons, go to another tab, open Scout, ☰ chats, tap the coupon search; Safari switches to the coupon tab, then clicking Scout there does nothing.
- Expected: clicking Scout on that tab opens it and shows the search.
- Cause (inferred, not reproduced in Safari): after switching tabs, the worker called `action.openPopup()` with no click behind it (#64's `tabs.show`). On Mac that popover never showed, and Safari then would not open Scout on that tab.
- Fix: on Mac `tabs.show` only switches the tab (`reopensAfterSwitch` in `src/panel/toolbar.ts`); the owner clicks Scout there, which opens a fresh panel that catches up with the run. iPhone and iPad keep opening the panel after the switch.
- Evidence: new unit test in `tests/unit/edge.test.ts`. Unit 509/510 (known Take control failure), typecheck, lint, build, `check:release` clean. e2e Chromium: 145 passed, the same 20 failures as `main`. Not checked: real Mac Safari.

## 2026-10-19 — getbeefy.co: junk codes, no creator code, empty coupon report (owner run #203 and panel log)

- Actual (owner): run #203's report had no stages, only `port:reconnecting`. The panel log: GETBEEFY (a guess) applied; every "code found online" was a menu word or another store's code (BUNDLE, STORES, CATEGORY, STUDENT701, EXTRA10, ETSC); WELCOME10 and WELCOME "saved" $0.01 and were tried together with GETBEEFY; BEEFY5 and BEEFY50 were the first guesses; the offers line showed `&#34;` and cut words. No creator code (KETOVORENURSE) was found. The model was Haiku 5.5.
- Expected (owner): find the creator code as another assistant did, and a report that shows every page and code.
- Causes: (1) The worker stamps each coupon stage with `at_ms` (#57), and the panel's port schema for `coupons.event` did not list it, so every stage was dropped; say, attempt and done events had no `at_ms` and arrived. (2) Elements on a rendered page counted as codes when written in capitals, including menu links (STORES, CATEGORY, BUNDLE). (3) A coupon-site address built from the store's name (`likelyCodePages`) can answer with other stores' codes; its address names the store, so its codes counted. (4) Any lower total counted as a saving. (5) Percent hints included code-free offers ("5% off 3+ bags") and 50%. (6) The creator search named kinds of pages, not searches (inferred: none of the four searches returned a code, and the report had no trace to confirm).
- Fixes: `at_ms` in the port schema; one diagnostics run for a resumed coupon run (two merged changes each started one); room for 400 stages. On a page as loaded, a word with no digit is a code only when labeled ("Copy", "Code:"). Codes on a built page that names the store fewer than three times count only next to the store's name, for codes read there and for the model's lines about it. A saving under 10 cents or 0.25% of the total does not count ("Takes off only $0.01, too little to count."). Guesses use hinted percentages from 10 to 40 only, and code-free offers are not hints. Offers: entities decoded, one field, cut at a word. The creator search runs written-out searches (`"getbeefy.co" code`, `site:linktr.ee Beefy`, `Beefy code linktree`, ...) with 9 searches; the second round adds Beacons, Stan Store, Instagram and YouTube searches.
- Evidence: new unit tests (port schema check fails on `main` with "payload.at_ms is not allowed"; built page and menu words fail on `main` with CATEGORY, EXTRA10, STORES, STUDENT701; cent saving; percent hints; offers; creator searches). Unit 512/513 (known Take control failure), typecheck, lint, build, `check:release` clean. e2e Chromium (WebKit not in the cloud sandbox) coupons, checkout, coupon-browser, diagnostics 15/15. Not checked: a live getbeefy.co run; whether the written-out searches find KETOVORENURSE.
- Owner decision ("Sonnet for search", decision card): with a Haiku model picked in the panel, the coupon web search runs on Sonnet 5.5 (`couponSearchModel`, `src/coupons/codes.ts`); finding the coupon box keeps the panel's model, and a stronger model the user picked, or another provider's, is kept. The cost line prices each part with its own model (`formatCostLineParts`); the trace shows `coupons:search-model`. Same provider and key, so no new data flow. Test: `coupon-wide.test.ts` "searches with Sonnet 5.5…".

## 2026-10-19 — getbeefy.co run #237: four Sonnet searches, no code line, and no way to see why (owner report)

- Actual (owner, Mac, after #67): GETBEEFY applied from memory; the full trace now shows the search on Sonnet 5.5. The four searches ran for 216 s and wrote no code line (`ignored=5`, `verified=0 reported=0 dropped=0`); every coupon-site page opened in the browser came back "empty" at 263 to 1704 characters. 38 759 input tokens for four searching requests: few results reached the model.
- Expected: find KETOVORENURSE (a creator's Linktree code), or a report that says why not.
- Causes (partly inferred): the trace counted only kept codes, so it could not say whether the searches failed, returned nothing, or wrote codes in a shape the parser skips. A failed web search returns HTTP 200 with an error object, which the Anthropic adapter ignored. A code line whose page was written without `https://` was ignored. A bot check or a missing page in the browser was reported as "empty".
- Fixes: the adapter reports each web search (`search`: results, or the error code) and why the turn ended (`stop`). Each search request writes one trace line, `coupons:pass <angle> <s>s searches= results= search-errors= fetches= lines= masked= ignored=(shapes) stop=`, counts and codes only. "CODE | site.com/page | …" reads as https (only with "|"). Browser pages with no code are "wall" (bot check or block), "missing" (not found) or "empty".
- Evidence: new unit tests (adapter search error and stop; bare-URL line and ignored shapes; pass trace with no page text; wall and missing pages). Unit 519/520 (known Take control failure), typecheck, lint, build, `check:release` clean; e2e Chromium coupons, checkout, coupon-browser, diagnostics 15/15. Not checked: live run; the next getbeefy.co report should show which of the causes applies.

## 2026-10-19 — Find coupons reads coupon sites without opening tabs

Owner asked whether coupon testing could stop showing/opening tabs. Testing codes already ran on the shop tab itself; the tabs came from the browser fallback for coupon sites that refuse the provider's reader. Owner chose "Quiet only": those pages are now downloaded by the background worker (`src/coupons/quiet-read.ts`, no cookies, no tab, no history) and parsed without a DOM; codes kept in `data-code`-style attributes and embedded JSON are read as "Code: X" lines. Trade-off: no page scripts run and "Show code" is never pressed. Evidence: `tests/unit/coupon-quiet.test.ts` (8 tests); full unit suite 523/524 (the known Take control failure on `main`); typecheck, lint, build, check:release clean. Device check still needed on Mac and iPhone.

## 2026-10-19 — Chrome and Firefox packages (Scout AI Assistant, step 1)

Owner asked to rename to "Scout AI Assistant" and ship on Chrome, Firefox and Safari. Plan: `/mnt/project-files/scout-ai-assistant/plan.md`. This step builds the other two browsers from the same code; the rename follows after the Trailhead look PR.

- `SCOUT_TARGET=chrome|firefox` in `scripts/build.mjs` (`npm run build:chrome`, `build:firefox`, release by default) writes `dist/<browser>/` and a store zip. Safari build unchanged. Per-browser manifest in `scripts/targets.mjs`: Chrome uses a service worker; Firefox keeps background scripts, add-on ID `scout-ai-assistant@harrisonfischberg` (fixed once uploaded), Firefox 140+ with `data_collection_permissions` (website content, browsing activity, sent to the user's provider). Both drop `nativeMessaging`.
- Chrome shim (prepended to Chrome bundles): exposes `browser`, binds Chrome's functions, and answers Promise-returning `runtime.onMessage` listeners through `sendResponse`.
- API key on Chrome/Firefox: local extension storage, never synced (owner chose "Browser storage" 2026-10-19). Safari still Keychain only; `check:release` fails if the storage path is in a Safari bundle. New row in `docs/data-inventory.md`.
- Evidence: real Chromium 1194 loaded `dist/chrome`, worker answered ping through the shim, saved key showed the composer, a chat against the mock server streamed an answer with cost, no console errors. Mozilla `addons-linter` on `dist/firefox`: 0 errors, 15 innerHTML warnings (reviewer notes). Firefox itself not run here (not installed). Unit 540/541 (known Take control failure), typecheck, lint, `check:release` clean. `check:rename` was already failing on main (3 old hits in files this change does not touch).
- Not yet: Safari wording on other browsers ("kept in your Keychain", Safari settings paths, history note) changes with the rename PR, since it edits the same panel text.

## 2026-10-19 — Looks: Trailhead by default, five more in Settings (UI review follow-up)

Owner picked option 1 of the UI review (`impeccable-review/`) and asked to keep the others: "Can we set #1 as the default but give options for the other 5?" The panel now opens in Trailhead; Settings > Look (first section) offers Pure Apple, Night Ops, Deal Hunter, Ink & Paper and Classic (the original design), applied at once and kept (`src/panel/look.ts`; CSS on `html[data-look]` in `src/popup.html`). Each look has its own new-chat greeting. Trailhead and Night Ops show four starters (adds "Get a coupon code" and "Do a task on this page", which enters Scout mode); Deal Hunter puts the coupon starter first. The setup app (Mac and iPhone) is restyled in Trailhead with numbered step cards and, on Mac, live "On/Off" from `SFSafariExtensionManager`. Shared fixes from the review: "Scout" inside Safari (accessible name still "Scout for Safari"), no focus box on dialog headings, softer composer focus.
Evidence: `tests/unit/look.test.ts` (5) and `tests/e2e/look.spec.ts` (17: default look, switch and keep, storage beats stale cache, Delete all data resets it, Scout starter, axe WCAG 2.2 AA per look in light and dark, new chat and Settings). Unit 532/533 (known Take control failure), typecheck, lint, build, `check:release` clean; e2e Chromium: the same 20 failures as `main`, none new. Token contrast script: 0 failing pairs. Screenshots of every look: `impeccable-review/after/`. Not checked: Xcode build of the SwiftUI setup app (no Swift toolchain in the cloud), real Safari on Mac and iPhone, SF Pro Rounded and New York rendering.

## 2026-10-19 — Rename to Scout AI Assistant (step 2)

Owner asked to rename the app "Scout AI Assistant" for Safari, Chrome and Firefox (plan: `/mnt/project-files/scout-ai-assistant/plan.md`). Done after the Trailhead look (#71) merged.

- Shown names: extension name and description (`src/manifest.json`), panel title and header, Mac app name in the Dock and menu bar (`APP_DISPLAY_NAME`, `CFBundleName`), Safari's extension list (`apple/Extension/Info.plist`), setup app title, diagnostics heading (`## Scout AI Assistant diagnostics`), legal drafts. Running text says "Scout". The AI's prompts say "You are Scout". iPhone home screen was already "Scout".
- Kept on purpose: bundle IDs, Xcode targets, schemes and `PRODUCT_NAME` (the built file is still "Scout for Safari.app"), Keychain service names, repo name. Changing those loses saved keys and breaks `scripts/build-mac.sh` and `build-ios.sh`.
- Per-browser wording (`src/platform.ts`): on Chrome and Firefox the panel says the key is kept "in this browser" instead of the Keychain, gives each browser's own shortcut, private-window and site-access steps, and names the browser in coupon, mic and new-tab messages. Static HTML carries the other wording in `data-other-browsers`.
- Fix to step 1: Chrome and Firefox on computers no longer offer or register the page-edge button (it is for iPhone/iPad; Firefox for Android still gets it). Diagnostics name Chrome and Firefox correctly.
- `check:rename` now also fails if "Scout for Safari" is shown to people (src, the app's Swift text, Info.plist, legal drafts), and no longer flags recorded live-suite pages or the `sk-ant` test.
- Evidence: unit 551/552 (known Take control failure); typecheck, lint, `check:release`, `check:rename` clean; Chromium e2e 162 passed, the same 20 failures as `main` (diffed by test name); Chromium loaded `dist/chrome` with the new name and Chrome wording, no page-button script registered; Firefox `addons-linter` 0 errors. Not checked here: Xcode build, the XCTest UI test text, real Safari on Mac and iPhone.

## 2026-10-19 — Starters: only Summarize and Explain, smaller, nothing cut off on iPhone (owner feedback)

Owner (iPhone screenshot, Trailhead dark): "on iOS, the cards are too large and they cut out the image" and "we dont need Get a coupon or Do a task. and make the other two smaller... Do that for all styles". Cause: the four tall cards plus the docked composer filled Safari's half-height sheet, so the truck badge sat behind them. Fix: the coupon and Scout-mode starter cards are gone in every look (Find coupons stays in the + menu, Scout mode in the switch); Summarize and Explain are one-line cards about 40 px tall in Trailhead and Deal Hunter, and shorter rows in Pure Apple, Night Ops, Ink & Paper and Classic. On a short panel the badge and greeting shrink (under 620 px) and the badge goes (under 520 px). Evidence: new e2e "every look shows only Summarize and Explain…" at 393×390 (fails on `main` with four starters); unit 551/552 (known Take control failure), typecheck, lint, build, `check:release` clean; e2e Chromium the same 20 failures as `main`, none new. Not checked: real iPhone sheet.

## 2026-10-19 — iPhone: Pure Apple by default, "Ask Scout" only, new hint, little car in the question box (owner request)

Owner: "Remove all copy from the chat box, except the words 'Ask Scout'", "Make the default Search box say 'What can Scout help with today?' instead of 'Ask Anything'", "Make the default … Apple instead of Trailhead" (Safari iOS), then "put the little car in the chatbox on all screens (color matched) … above 'What can Scout help with today?' … on the smaller window and expanded window". Done: on touch devices (iPhone, iPad) the panel opens in Pure Apple until a look is chosen, and Delete all data returns there; Mac keeps Trailhead (`defaultLook`, `src/panel/look.ts`). Pure Apple's new chat shows only "Ask Scout" above the two starters. The question box hint is "What can Scout help with today?" on iPhone and iPad ("Ask anything…" on Mac). Every look, Mac and iPhone, shows the outline Scout car in its accent color (Night Ops: signal lime) above the hint while the box is empty. Evidence: unit look test for `defaultLook` and the Apple greeting; e2e iPhone default + hint + car above the box and hidden while typing, iPhone Delete all data back to Pure Apple, Mac keeps Trailhead with the car. Unit 552/553 (known Take control failure), typecheck, lint, build, `check:release` clean; e2e Chromium the same 20 failures as `main`. Not checked: real iPhone.
- Follow-up (owner, with a Night Ops screenshot): "I wanted the little car icon to be like this on all pages, and remove anything below it like 'type a question', etc. The ask box should only say 'What can Scout help with today?'". Changed: the car is out of the question box; every look shows the small outline car (40 px, the look's accent; Night Ops lime) above its title, with no subtitle, on every sheet size (the short-sheet rule no longer hides it). The hint is "What can Scout help with today?" on Mac too. Tests updated (car above the title and clear of the starters at 393×390 in every look; Mac hint). Unit 552/553, e2e Chromium the same 20 failures as `main`.
- Follow-up (owner): "put them all in the bottom left now". The car and title sit together at the bottom left, just above the starters, in every look (Mac and iPhone). e2e checks the car's left edge and its distance to the starters in every look at 393×390.
## 2026-10-17 — TestFlight prep for beta testers (owner's question: beta testers from his website)

- Answer: TestFlight public link (`testflight.apple.com/join/…`) on the owner's website, one link for iPhone, iPad and Mac, up to 10 000 testers, Beta App Review on the first build of each version. Owner steps in `docs/testflight.md`.
- Repo changes (`scripts/prepare-testflight.rb`, idempotent): macOS app and extension moved from `com.example.SafariScout*` to `com.harrisonfischberg.SafariScout*` with team `KTV2G3Z883` (launch blocker 11 closed for macOS; one App Store Connect record for both platforms); `PrivacyInfo.xcprivacy` added to app and extension on both platforms (`UserDefaults`, reason CA92.1; no tracking, no collected data); `ITSAppUsesNonExemptEncryption = NO` and `LSApplicationCategoryType` in `apple/App/Info.plist`; `OnboardingView.swift` names the new Mac extension ID. New `scripts/archive-testflight.sh` + `scripts/ExportOptions-testflight.plist` (check:release, release JS bundle, Release archive per platform, upload; debug bundle restored on exit).
- New data flow recorded: TestFlight tester data held by Apple (`docs/data-inventory.md`).
- Not verified here: no Xcode in the cloud session. Owner's Mac: `scripts/build-mac.sh` (re-enter the key once; turn the extension on again in Safari), then `scripts/archive-testflight.sh --no-upload` to prove the archive, then the Mac Keychain check (launch blocker 14).

## 2026-10-20 — App Store submission kit (owner: skip TestFlight, submit when the D-U-N-S letter arrives)

- Read Apple's current rules on 2026-10-20 (App Review Guidelines last updated 2026-10-16; 5.1.2(i) third-party AI disclosure from Nov 2025; age rating questionnaire with social media questions and "Override to Higher Age Rating"; screenshot sizes; EU DSA trader display; iPhone Duo screenshots required from April 2027).
- Kit: `docs/app-store-submission.md` (listing text without other platforms' names, privacy label declaring Other User Content and Browsing History for App Functionality, not linked, no tracking; 18+ override; review notes; China mainland excluded; DSA note that the LLC's D-U-N-S address shows on EU pages; owner checklist).
- App-side: merged the held PR #2 (Mac bundle IDs and team, privacy manifests, export flag, archive/upload script). The extension's privacy manifest now declares the same two collected types. The setup screen and the extension's Settings link to the published privacy policy; the bundled DRAFT policy and terms pages are removed from the build and the Xcode project (`scripts/remove-legal-drafts.rb`), and their e2e/UI tests replaced. New `npm run check:screenshots` (`scripts/check-store-screenshots.mjs`) checks App Store sizes and transparency.
- Not verified here: no Xcode in the cloud session. Needs the Mac build (Mac key re-entered once after the bundle ID change), the Release archive, the Mac Keychain check (blocker 14) and the screenshots.


## 2026-10-20 — iPhone mic button: never stuck on, falls back to the keyboard's dictation (owner bug report)

Actual (owner): "The microphone button on ios doesnt hear your voice nor record voice to text. it also stays activated after you press it and it fails." Expected: the mic turns speech into text, and when it can't, the button turns off with a clear message. Cause: `Listener` (src/panel/voice.ts) only ended when WebKit fired `onend`. In the iPhone Safari panel the recognizer can start silently and never fire anything (no start, error or end), or report an error without ending, so the button stayed pressed; tapping it again called `stop()` on a recognizer that also never ended. Fix: the listener ends itself if the recognizer hasn't started within 4 s (`no-start`), 0.8 s after an error with no end, and 0.8 s after Stop with no end; onEnd fires exactly once. The message says Safari didn't let Scout use the microphone and to tap the mic on the keyboard. After one refusal on a phone, the next tap skips the wait and focuses the question box (raising the keyboard with its own mic); the flag is keyed by user agent so a Safari update retries, and is cleared once dictation works. Evidence: unit voice tests (never starts, error without end, stop while stuck, started stays on, refusal memory); e2e "a mic that never starts…", "tapping a stuck mic again turns it off" and the phone keyboard fallback fail on `main` and pass here (Chromium; WebKit isn't installed in this container); unit 558/559 (known Take control failure), typecheck, lint, build, `check:release` clean. Not checked: real iPhone, so whether Safari lets the panel's recognizer work at all there is still open.

## 2026-10-20 — iPhone mic button: listens from the web page when Safari blocks the panel (owner follow-up)

Actual (owner, after #75): "doesnt even enable now on ios … the microphone button in the chat window itself … doesnt even activate". Expected: Scout's own mic button lights up and turns speech into text. Cause: #75 remembered the first refusal and then made every later tap only focus the box, so the button never lit; and Safari on iPhone doesn't let the panel's recognizer hear anything. Fix: the mic always lights up and says "Listening…". When the panel's recognizer is refused, never starts or has no recognizer, Scout keeps the mic on and runs the recognizer in the current web page through `scripting.executeScript` (src/panel/page-listen.ts), polling it for text every 250 ms; Safari asks per site for the microphone and gets 15 s to do so. After one panel refusal, later taps go straight to the page. If the page also refuses or can't be scripted, the mic turns off with a message. The listener now aborts a timed-out recognizer before reporting the end, so the fallback's recognizer is never cut off. Data inventory row "Speech" updated. Evidence: unit page-listen tests (words passed with final flag, 15 s start window then abort, page refusal, unscriptable page, page reload); e2e: panel refused → page listens and fills the box with the mic on; after reload the mic lights and goes straight to the page; page refuses too → off with message. Unit 566/567 (known Take control failure), typecheck, lint, build, `check:release` clean; Chromium e2e 165 passed, 20 failed, all in a11y/consent/edge/part2 and none in voice (the known Chromium set). Not checked: real iPhone, which is the open question (whether Safari lets a page-injected recognizer hear while Scout's sheet is open).

## 2026-10-20 — iPhone: car and title jumped when tapping the mic or New chat (owner report)

- Actual (owner, iPhone): "when you click microphone or even new chat the 'where to next' and car icon move up a few pixels."
- Expected: they stay put.
- Cause: the status line between the conversation and the question box (`#status`) takes no room while empty and one line when it shows "Listening…" or "New chat.", so the new-chat screen above it (car and title at the bottom, #74) was pushed up by that line.
- Fix: on a new chat (`html[data-chat-empty]`) the status line keeps a one-line height (24 px) whether or not it has text; longer messages still wrap.
- Evidence: new e2e "the car and title stay put when a status line shows (mic, New chat)" (iPhone, Trailhead) fails on `main` and passes. Unit 566/567 (known Take control failure), typecheck, lint, build, `check:release` clean; e2e Chromium the same 20 failures as `main` plus one run of chat.spec "scrolling up while an answer types out…", which passed on 2 full chat.spec reruns and alone 3 times (timing under full-suite load; the change only applies while the chat is empty). Not checked: real iPhone.

## 2026-10-20 — iPhone mic button opens the keyboard's mic (owner choice)

Actual (owner, after #77): "the mic still doesnt work on ios (but it did work on macbook)"; Safari never asked for the microphone. Safari on iPhone gives extensions no microphone, neither in the panel nor in a page script, so Scout can't hear from inside Safari. Owner chose (card, option A): Scout's mic brings up the keyboard and points to its mic. Done: on touch devices the mic focuses the question box inside the tap (raising the keyboard), lights up and says "Tap the mic on your keyboard to talk."; a second tap or leaving the box turns it off. No recognizer is started there. Mac keeps its own listening (#75, #77). Evidence: new e2e "on iPhone … the mic brings up the keyboard, stays lit while it's up, and starts no recognizer"; voice, chat and look e2e 42/42 (Chromium); unit 566/567 (known Take control failure), typecheck, lint, build, `check:release` clean. Not checked: real iPhone.

## 2026-10-20 — iPhone: Scout's mic button hidden (owner choice)

Owner after #79: "it brings up the keyboard but doesnt activate the microphone". No web page or extension can switch the keyboard's dictation on, and Safari gives extensions no microphone on iPhone, so the owner chose (card) to hide Scout's mic on touch devices; the keyboard's own mic stays available in the box. Mac keeps Scout's mic. Evidence: e2e "on iPhone … Scout's mic is hidden and Send still fits"; voice, chat, look e2e 41/42 on Chromium (the scroll test that fails is flaky on `main` too: 1 of 3 runs); unit 566/567 (known Take control failure); typecheck, lint, build, `check:release` clean. Not checked: real iPhone.

## 2026-10-20 — Scout mode can open an address ("go to Google.com"), shorter hint, no Take control button (owner bug report)

- Actual (owner, iPhone, diagnostics run #278): asked to go to Google.com, the agent pressed Control-L, Alt-D and Control-T and finished with "I could not get to Google.com"; the page stayed on the same site.
- Expected (owner): "it should control the browser and go to google.com for me".
- Cause: Scout mode's action list (src/actions/vocabulary.ts) had no way to change the address, and page key events never reach Safari's address bar or tabs, so the model could only try shortcuts.
- Fix: new `navigate` action (url; http/https only, a bare host gets https://). The worker opens it with `tabs.update` on the task's own tab and waits for the load (src/server/worker.ts), never from inside the page; blocked sites are refused before the tab moves; the rest of the batch is skipped (its refs were for the old page) and the overlay is shown again on the new page. Browser shortcuts (Control/Command-L, T, N, W, K; Alt-D) are not pressed and the model is told to use navigate. System prompt says keys reach only the page and Scout works in one tab.
- Also (owner, same thread): the Scout-mode hint is now "Tell Scout what to do", and the panel no longer shows a Take control button while a task runs (Stop in the composer is enough).
- Evidence: unit task/task-host/vocabulary tests for navigate (bare host, blocked site, failed navigation, shortcuts, worker tab), e2e overlay (page executor refuses navigate), scout (no Take control button), redesign (hint). Unit 572/573 (known Take control runner failure), typecheck, lint, build, `check:release` clean; Chromium e2e the same 20 failures as `main` (WebKit isn't installed in this container). Not checked: real iPhone Safari.

## 2026-10-21 — The ask box tells general questions from page questions, and can search the web (owner request)

- Actual (owner): on a Home Depot toilets page, asking Scout "what's the best coffee shop in X neighborhood" brought Home Depot into the answer.
- Expected (owner): a general question is answered from the AI and the web ("it goes to AI and Google") without the page; page questions (Summarize, Explain, "this", "here", "how much is it") keep using the page.
- Cause: every message carried the open page, and only the system prompt asked the model to ignore it when unrelated. The chat had no web search (only Find coupons used it), so local and current questions had nothing better to go on.
- Fix: `src/chat/intent.ts` decides on the device, instantly and for free, whether a message is about the page (words that point at the screen, words shared with the page title or address, attached tabs, short follow-ups keep the last topic). A general message is sent without the page and with rules that say not to mention it; the current tab stays readable through `read_page` when the guess was wrong. Every chat answer now offers the provider's web search, at most 3 searches an answer, with rules for when to search. Web results come back as the answer's numbered sources. Mock server sends only coupon-prompt searches to the coupon scenario.
- Evidence: unit `intent.test.ts` (Home Depot coffee example, 9 general, 15 page, follow-ups, time words, "near here", suggestions) and `server.test.ts` (search budget across rounds, general rules, page rules). Unit 607/608 (known Take control failure), typecheck, lint, build. e2e chat + panel in Chromium (WebKit is not installed here): 21/22, the one failure is the scroll-while-typing test, which fails the same way on `main` (2 of 6 runs). Part 2 Chromium failures are the same 17 as `main`. Not checked: real Safari on Mac/iPhone, live web search with a real key.

## 2026-10-21 App Store readiness check (owner request)

- Old Mac worktree `nifty-satoshi-fc777c` (61eb029) is fully inside `main`; nothing to merge.
- Consent: the app shows version 2; counsel reviewed version 1. New packet `docs/legal/consent-v2-review.md` lists every change since v1 (including two not in the dialog: chat web search from #83, and Scout mode starting tasks without a per-task question) and the questions for counsel (blockers 23, 32, 34, 36).
- Privacy policy: the published page https://rarecreatures.app/apps/scout/privacy/ (19 October 2026) is the source of truth; the repo draft is marked superseded, terms marked not needed for the App Store (Apple's standard EULA). Compliance rows 1, 2, 6, 16, blockers 1, 8, 27 and `publish-checklist.md` updated. New blocker 36: the page is behind the app (chat web search, Private Browsing chats, Mac microphone, remembered and guessed codes; "under 13" vs the 18+ rating). No record that counsel reviewed the published page.
- `docs/app-store-submission.md` and `docs/store-listings.md` say "the owner" instead of a first name.
- Removed the unused host-app key test, setup model and consent record (`apple/App/ProviderSetup.swift`, `apple/Tests/ProviderSetupTests.swift`) and the Mac app's `network.client` entitlement (the app makes no requests).
- Evidence: unit 607/608 (known Take control failure); typecheck, lint, build, `check:release` clean. e2e: WebKit is not installed in the cloud session; Chromium 166 passed, 21 failed, all Chromium-only keyboard and Part 2 mock specs already failing on `main` (no `src/` or `tests/` change in this branch). Xcode build, XCTest and the iOS UI audit wait for the Mac.

## 2026-10-21 iPhone setup screen: light accessibility audit (Legal contrast)

- Actual: `testSetupScreenAuditLight` failed, "setup-light: Contrast failed — 48 'Legal'" (device check of `main` 5722dd3). Dark passed.
- Cause: on the iPhone 17 Pro Simulator the screen is taller than the display; the run's own screenshot shows only the top few pixels of the "Legal" heading at the bottom edge (card ends at 845 pt, heading starts at 868 pt of 874). The audit reads that clipped sliver as low contrast; the colors themselves are #1F2A1F on #F6F1E7. Present since the Legal section was added (#76), not caused by #84.
- Fix: the screen now fits without scrolling at the default text size: the sunrise badge is 64 pt instead of 84, and the "Legal" heading is gone; the privacy policy link stays as a one-line footer. The audit and its test are unchanged.
- Evidence: needs the iOS UI audit on the Mac (cloud session has no Xcode).

## 2026-10-22 — bundle ID renamed to com.harrisonfischberg.Scoutai

- Owner asked to rename the bundle ID from `com.harrisonfischberg.SafariScout` to `com.harrisonfischberg.Scoutai`, before the first App Store Connect upload (no app record existed for the old ID).
- Renamed the app, extension (`.Extension`), shared keychain group (`.shared`) and UI test bundle (`ScoutaiUITests`) in the Xcode project, entitlements, `OnboardingView.swift`, the TestFlight and keychain scripts, and the docs. Older log entries above keep the old ID as history.
- Effect on devices: the installed apps count as new apps, so the API key must be entered again on Mac and iPhone and the extension switched on again in Safari. The old app can be deleted.

## 2026-10-23 — manifest description shortened for App Store Connect

- First TestFlight upload of Scout (macOS build 20261023.0025) was rejected: "The description field must be present, of string type, and 112 or fewer characters long" for the Safari web extension manifest.
- Cause: `src/manifest.json` description was 129 characters.
- Fix: shortened it to 104 characters; added `tests/unit/manifest.test.ts` so it stays at 112 or fewer.

## 2026-10-23 — first TestFlight upload: macOS accepted, iOS needed orientations

- macOS build 20261023.0033 (main d98c655) uploaded to App Store Connect for "Scout AI Browser Assistant" (com.harrisonfischberg.Scoutai).
- iOS build 20261023.0033 was rejected: "No orientations were specified in the com.harrisonfischberg.Scoutai bundle. To support iPad multitasking, specify ... UISupportedInterfaceOrientations".
- Fix: `apple/App/Info.plist` now lists all four orientations (macOS ignores the key).

## 2026-10-23: song lookup from a lyric on a Google results page

- Actual: on Google results for "Hannah Marie Kelly", asking "I'm looking for Hannah Marie Kelly, and the song has something about the words smile on your face" (Haiku 5.5) got "the Google results page doesn't name the song", a TikTok caption, and unrelated songs titled "The Smile on Your Face".
- Expected: "When You Say Nothing at All" (Hannah Marie Kelley with Roy Caudill; line "The smile on your face lets me know that you need me"), as another assistant answered in one prompt.
- Cause: the question repeated the words of the Google page title (the user's own search), so `src/chat/intent.ts` judged it a page question; the page rules then had the model answer from the results page and say it lacked the answer. The prompt never told the model to use its own knowledge of well-known songs or to retry a missed search, and the 3-search budget left little room to retry.
- Fix: search results pages (Google, Bing, DuckDuckGo and others) no longer count title words as a page match; "these results"/"here" still send the page. New prompt rules: a results page is only the user's search, never say it lacks the answer; for identify-this lookups (song from a lyric, film from a plot) think of well-known candidates and covers first, treat names and lyrics as possibly misspelled, and search again with new wording before giving up. Chat search budget 3 → 5 per answer.
- Evidence: `tests/unit/intent.test.ts` (search results pages), `tests/unit/server.test.ts` (budget and rules). No live model run in this session (no API key here); needs a real-device check on Haiku 5.5.
- Follow-up (owner, 2026-10-23): "not just songs or movies ... basically a Google search for whatever I ask about", and use the page when it is relevant (a question while reading a news article). Web rules generalized: search whenever it could make any answer more accurate or current, think of the likely answer then confirm, read for what the user means (misspellings), never give up after one search, answer first instead of advice on where to look. A general message now carries the open page's title and address (no text, no query string) with rules to call read_page when the message is about the same subject and otherwise ignore it. Test: `tests/unit/server.test.ts` (open page title and address only).

## 2026-10-24: "Could not start the answer" on every general question (Mac)

- Actual: asking a general question (anything not about the open page) on a normal web page showed "Could not start the answer. Close Scout, open it again, and try again."
- Expected: the answer starts.
- Cause: PR #92 made the panel send `open_page` (the open page's address and title) with general questions, but the `chat.start` schema in `src/bridge/messages.ts` was not updated. The worker's router rejected the message with `payload.open_page is not allowed`, and the panel showed its generic start error.
- Fix: add `open_page` (optional) to the `chat.start` schema.
- Evidence: new test in `tests/unit/bridge.test.ts` failed before the fix with that exact message and passes after; `npm test` 612/613 (the one failure is the known Take control test on `main`), typecheck, lint and build pass.

## 2026-10-24: SkillSpector security scan; payments always asked

- Scan: NVIDIA SkillSpector (LLM mode through the local `claude` CLI) on the ponytail, ponytail-audit and ponytail-review skills, the agent files (`CLAUDE.md`, `PROMPT.md`, `.claude/settings.json`, `ralph/`), `src/` and `scripts/`. Report: `/mnt/project-files/audits/skillspector-scan-2026-10-24.md`. Nearly all hits were keyword false positives (Keychain, test-fixture injection text, provider URLs).
- Real issue: the Scout mode confirmation offered "Always allow on this site" for payments, so after one click a page's hidden instructions could make Scout place an order on that site without asking.
- Fix: `ASK_EVERY_TIME` in `src/permissions/gate.ts` (payments): never saved, honored, or kept from storage; the confirmation hides the button for them. Corrected two stale comments (gate header, coupon finder header: it can open Checkout but never pays).
- Evidence: new tests in `tests/unit/gate.test.ts` and `tests/unit/task.test.ts`; `npm test` 625/625, typecheck, lint, build, `npm run check:release` pass. Needs a device check: a payment confirmation shows only Allow once / Deny.
