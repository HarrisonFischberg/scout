# Tool environment

Verified: 2026-10-15

| Tool | Available | Version | How verified |
| --- | --- | --- | --- |
| Replica | yes | replica-skill 1.0.0 | `~/.claude/plugins/installed_plugins.json`; `replica-recon` skill loaded and run this session |
| REA (MCP tools answer, not just skill installed) | partial | rea MCP (version not reported) | `mcp__rea__list_browser_targets` returned a structured `provider_unavailable` error: server answers, but no loopback CDP browser is running. Web capture tools BLOCKED until a Chrome with `--remote-debugging-port` is started with owner approval. |
| Claude Code `/goal` | yes | Claude Code 2.1.299 | Headless test 2026-10-15: `claude -p "/goal The file ok.txt exists..."` → "The goal is met." |
| Ralph fresh-context shell loop | yes (original reimplementation) | coleam00/ralph-loop-quickstart @ f6a7781 reviewed | Repo has no license, so `ralph/ralph.sh` is original code following its contract. Plugin `ralph-loop` 1.0.0 (same-context) not used. |
| Caveman | yes | caveman 3.2.0 | installed_plugins.json; SessionStart hook active |

## Platform toolchain

| Tool | Version | How verified |
| --- | --- | --- |
| Xcode | 27.0 (27A266a) | `xcodebuild -version` |
| iOS Simulator runtime | iOS 27.0 | `xcrun simctl list runtimes` |
| Node | v24.22.0 | `node --version` |
| Python | 3.9.6 | `python3 --version` |
| GitHub CLI | logged in as HarrisonFischberg | `gh auth status` |

## Section F — design, accessibility, quality layer

| Skill | Available | Version / source | How verified |
| --- | --- | --- | --- |
| ui-ux-pro-max (design decisions) | yes | nextlevelbuilder/ui-ux-pro-max-skill, MIT, vendored 2026-10-15 | PROVENANCE.txt present; not yet invoked |
| fixing-accessibility (edit-time a11y) | yes | ibelick/ui-skills, MIT, vendored 2026-10-15 | PROVENANCE.txt present; not yet invoked |
| web-quality-audit + siblings (evidence) | yes | addyosmani/web-quality-skills, MIT, vendored 2026-10-15 | PROVENANCE.txt present for web-quality-audit, accessibility, performance, best-practices |

Note: web-quality-audit targets rendered web pages. AssistAnt's UI is extension
HTML (popup/panel) plus SwiftUI host app. Audits run against the extension
pages served from a local dev harness; SwiftUI screens need Xcode Accessibility
Inspector checks instead.

Missing tool or credential = BLOCKED, never PASS.

Opt-in only, needs owner approval as a permission change: pbakaus/impeccable
downloads and runs a checksum-verified binary on first run and installs
SessionStart / PostToolUse / Stop hooks. Not adopted.
