# Presentiment visual review

Branch: `codex/presentiment-visuals`. Version: `2026.10.11.5`, cache `ablty-v96`. Main base: `5d2ef424`. Introduction direction approved by Johnny before Stage 2 began. PR #146 merged October 11 at `3cecab9`; deployment and physical-phone verification were not established by that merge. This review records the original visual release.

## What changed

- `app.html`: scoped introduction and active-trial visuals, silent decorative footage, motion lifecycle/fallbacks, keyboard support for the existing trial tap area, and the separately approved End cancellation fix. The trial counter, countdown, ring, progress, average, tap/result flow and saved statistics use existing app data and handlers.
- `assets/presentiment/`: three small silent clips and their still fallbacks. See `PRESENTIMENT-ASSETS.md` for sources, sizes and regeneration.
- `sw.js` and `version.json`: required release/cache identifiers and six precache paths only. No new update mechanism or changes to fetch, notification or backend logic.
- Tests and project status documents: verification and outstanding issues.

## Verification

Passed: introduction 16 browser checks and session 18 browser checks. The session suite covers a complete three-trial batch (two taps and one miss), repeated-tap protection, live countdown/ring/progress/counter/average, delta calculation, saving, reload, analysis/navigation, four phone sizes, tap targets, motion lifecycle and unrelated styles. Existing account isolation (32), Settings gestures (12), update detection (11) and notification intent (22) checks also passed during this visual task. App syntax (two script blocks), all 48 local links and whitespace checks pass.

Verification found a pre-existing bug: End during feedback could start another trial in the background and save an unwanted miss. The same check failed against main before the fix. Johnny separately approved cancellation of the pending callbacks. End and opening a new batch now clear the flash-to-result, feedback and next-trial timers. Their normal delays stay 400 ms, 2 seconds and 200 ms. Completed results remain saved. Regression checks cover End during countdown, fast-forward, tapped flash, missed flash, feedback and the transition gap, plus an immediate new batch after early and final feedback/transitions. The original failing feedback check now passes.

The introduction suite verifies empty/partial/populated history, controls, media failure, denied autoplay, reduced motion, and offline playback of all three clips through the real local service worker. All rendering uses isolated guest fixtures and blocked external requests. Trial-flow tests use a controlled browser clock and a fixed random draw; the recording also exercises the real-time countdown, tap, feedback and next-trial transition. No physical phone, live backend, billing or notification-device test was performed.

The original protocol questions remain separate: event time is selected before a tap, post-tap fast-forward displays the event sooner while scoring against that original time, and research wording requires its own review. Randomization, event timing, scoring, lengths, data definitions, persistence and analytics code are unchanged. The approved timer cancellation is the only trial-flow behavior change.

## Visual differences

The layout retains readable text and the actual ABLTY navigation, so the introduction card is taller than the reference on narrow phones and scrolls naturally. The trial header shows the real batch average instead of a nonfunctional three-dot menu. Decorative lighting comes directly from the supplied videos; live text and controls are not baked into video.

## Phone checklist for a test build of this branch

1. Check Settings matches the intentionally merged release (`2026.10.11.5` for the original visuals, or a later release containing them). Use an isolated guest test profile.
2. Open PSI, then Presentiment. Read the full instructions, scroll on a short screen, and check Back, Begin Trials and Full Analysis. New history should show zero trials and no analysis button.
3. Start a batch. Watch the countdown and ring, tap once during one trial, and let another pass without tapping. Repeated taps must not add results. Finish all three trials and reopen the app to check the saved results.
4. Check End during countdown, fast-forward and feedback. Wait at least 30 seconds on results; no extra trial or miss should appear. Start a new batch immediately after ending during feedback and confirm it stays on Trial 1 until you complete that trial.
5. Enable Reduce Motion and check that the artwork becomes still. Leave/reopen the screen and background/resume the app. Once the updated app and assets are cached, check the screens offline.

Screenshots and silent 25 fps recordings were delivered in the chat. No public interactive preview was deployed.

## Publication and parallel work

PR #146 is merged, confirmed on GitHub October 13. The earlier GitHub API Forbidden response happened during initial publication and is historical. The current main includes all visual work and the approved End fix.

PR #140's handoff and PR #145's WBTB timer repair are being reconciled separately in [draft PR #147](https://github.com/Johnkay22/ABLTY/pull/147) on `codex/beta-readiness-reconcile`, based on main `3cecab9`. That work preserves the Presentiment implementation and media. Cursor's branches and the earlier `codex/settings-pull-dismiss` branch remain untouched. See `AI-HANDOFF.md` for the current status and phone checks.
