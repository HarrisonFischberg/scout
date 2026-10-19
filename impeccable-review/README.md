# Scout UI/UX review (2026-10-19)

Open `index.html` for the review, the top problems, and the five refresh
directions side by side with the current app. Nothing in `src/` or `apple/`
was changed.

- `before/`: every panel state on `main` (Mac 400×600 and iPhone 393 wide, light
  and dark), the Scout page, page button, Scout-mode glow, and the setup app
  (HTML recreation of `OnboardingView.swift`).
- `option-1` … `option-5/`: four key panel screens plus the setup app per
  direction. `prototype/theme.css` + `theme.js` are the layers injected over
  the real panel to make them.
- `tools/`: capture scripts (review only, not part of the test suite).

Rerun (after `npm run build`):

```
npx playwright test -c impeccable-review/tools/pw.config.ts panel.capture page.capture   # before/
impeccable-review/tools/run-option.sh 1                                                   # one option
node impeccable-review/tools/native.mjs                                                   # setup app mocks
```

Screens use Inter, Charter and Nunito as stand-ins for SF Pro, New York and SF
Rounded (no Apple fonts on Linux). Fonts in `tools/fonts/` are OFL, review only.
