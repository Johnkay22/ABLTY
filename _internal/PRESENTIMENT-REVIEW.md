# Presentiment visual review

Branch: `codex/presentiment-visuals`. Version: `2026.10.11.4`, cache `ablty-v95`. Main base: `5d2ef424`. Introduction direction approved by Johnny before Stage 2 began. No merge, deployment, production data or service configuration changes.

## What changed

- `app.html`: scoped introduction and active-trial visuals, silent decorative footage, motion lifecycle/fallbacks, keyboard support for the existing trial tap area. The trial counter, countdown, ring, progress, average, tap/result flow and saved statistics use existing app data and handlers.
- `assets/presentiment/`: three small silent clips and their still fallbacks. See `PRESENTIMENT-ASSETS.md` for sources, sizes and regeneration.
- `sw.js` and `version.json`: required release/cache identifiers and six precache paths only. No new update mechanism or changes to fetch, notification or backend logic.
- Tests and project status documents: verification and outstanding issues.

## Verification and remaining issue

The new session browser suite passes the complete three-trial batch (two taps and one miss), repeated-tap protection, live countdown/ring/progress/counter/average, delta calculation, saving, reload, analysis/navigation, End during countdown and fast-forward, four phone sizes, tap targets, motion lifecycle and unrelated styles. It has one failing assertion: End during feedback must not start another trial or save another result. Running the same behavior checks against an extracted `origin/main:app.html` reproduces the same failure. The failure remains visible rather than being treated as a passing test.

Johnny was asked separately whether to include the small cancellation fix. Until that choice is supplied, this visual branch preserves the original protocol behavior. Do not treat this draft as having passed every functional acceptance check. In particular, End during feedback can schedule a later trial in the background and save an unwanted miss.

The introduction suite verifies empty/partial/populated history, controls, media failure, denied autoplay, reduced motion, and offline playback of all three clips through the real local service worker. All rendering uses isolated guest fixtures and blocked external requests. Trial-flow tests use a controlled browser clock and a fixed random draw; the recording also exercises the real-time countdown, tap, feedback and next-trial transition. No physical phone, live backend, billing or notification-device test was performed.

The original protocol questions remain separate: event time is selected before a tap, post-tap fast-forward displays the event sooner while scoring against that original time, and research wording requires its own review. Randomization, scoring, lengths, data definitions, persistence and analytics code are unchanged.

## Visual differences

The layout retains readable text and the actual ABLTY navigation, so the introduction card is taller than the reference on narrow phones and scrolls naturally. The trial header shows the real batch average instead of a nonfunctional three-dot menu. Decorative lighting comes directly from the supplied videos; live text and controls are not baked into video.

## Phone checklist for a test build of this branch

1. Check Settings shows version `2026.10.11.4`. Use an isolated guest test profile.
2. Open PSI, then Presentiment. Read the full instructions, scroll on a short screen, and check Back, Begin Trials and Full Analysis. New history should show zero trials and no analysis button.
3. Start a batch. Watch the countdown and ring, tap once during one trial, and let another pass without tapping. Repeated taps must not add results. Finish all three trials and reopen the app to check the saved results.
4. Check End during countdown and fast-forward. The feedback case is a known unresolved issue described above.
5. Enable Reduce Motion and check that the artwork becomes still. Leave/reopen the screen and background/resume the app. Once the updated app and assets are cached, check the screens offline.

Screenshots and silent 25 fps recordings were delivered in the chat. No public interactive preview was deployed.
