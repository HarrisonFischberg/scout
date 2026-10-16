# Asset and code licenses

| Asset / package | Type | Source | License | Permitted uses | Attribution required | Where used |
| --- | --- | --- | --- | --- | --- | --- |
| esbuild 0.28.2 | npm devDependency (build tool) | registry.npmjs.org | MIT | build bundle; not shipped as code | no (license text kept in node_modules) | `scripts/build.mjs` |
| typescript 7.0.2 | npm devDependency (typecheck) | registry.npmjs.org | Apache-2.0 | typecheck; not shipped | no (license text kept in node_modules) | `tsconfig.json` |
| vitest 5.0.5 | npm devDependency (unit tests) | registry.npmjs.org | MIT | test only; not shipped | no | `vitest.config.ts`, `tests/unit/` |
| @playwright/test 1.64.1 | npm devDependency (e2e) | registry.npmjs.org | Apache-2.0 | test only; not shipped. WebKit build downloaded to `.cache/ms-playwright` (gitignored) | no | `playwright.config.ts`, `tests/e2e/` |
| @mdn/browser-compat-data 8.1.6 | reference data only, not in repo | registry.npmjs.org | CC0-1.0 | read for research; not vendored | n/a | `docs/safari-api-support.md` |

"Publicly downloadable" is not a license.
| @axe-core/playwright 4.14.0 (+ axe-core 4.14.0) | npm devDependency (test only, not shipped) | npm registry | MPL-2.0 | automated WCAG checks in e2e | keep license notice if redistributed; not bundled into the app | tests/e2e/a11y.spec.ts |
| Safari Scout binoculars (monochrome toolbar icons `design/icons/safari-scout-binoculars.svg` and the filled-lens active state `safari-scout-binoculars-active.svg`, rendered by `scripts/render-toolbar-icons.mjs`; extension tile `binoculars-icon.svg`, app icons `binoculars-appicon-mac.svg` / `binoculars-appicon-ios.svg`; PNGs in `src/icons/` and `apple/App/Assets.xcassets/AppIcon.appiconset/`) | image | original artwork drawn for this project by Claude, 2026-10-16 (monochrome toolbar set added the same day); replaces the earlier mascot artwork (see git history) | owned by the project owner; no third-party source, stock, or image service | all | none | Safari toolbar, Safari Settings → Extensions, macOS Dock/Command-Tab/Finder, iOS home screen |
