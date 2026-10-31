# Contributing

Thanks for helping. Small, focused pull requests are easiest to review.

## Ground rules
- The Studio only reads and writes inside the user's studio folder. Every backend path goes
  through `safe()`; keep it that way.
- Never upload audio anywhere. Recording stays local.
- Never grant permissions silently. The mic prompt is always the user's choice.
- Desktop code is plain ESM loaded without a build step: no JSX, and import only
  `@hermes/plugin-sdk` and `react`.
- Use the app's theme variables (`--ui-*`) so the Studio matches every Hermes theme.

## Before you open a PR
1. Run the end-to-end test (see README, Develop). It should report 0 failed.
2. Add a check to `dev/e2e.mjs` for anything you add.
3. Update `CHANGELOG.md` under "Unreleased".
4. For UI changes, attach a screenshot of the wide page and the narrow right-side panel.

## Commit style
Short imperative subject, for example `Add voice-follow scrolling`.
