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
