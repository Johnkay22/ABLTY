# ABLTY: current beta handoff

Draft review: [PR #149](https://github.com/Johnkay22/ABLTY/pull/149). Do not merge until the evaluation and migration prerequisites below are complete.

Updated October 16, 2026 (Chicago). Inspected main `8a8e416`: #147 readiness/WBTB repair and #148 Settings polish are merged, version `2026.10.13.2` / `ablty-v98`. Recheck GitHub before resuming. Main status is not phone evidence.

## Current authorized task

Johnny approved the plan and implementation of **step 9, blind judging**. It compares all written impressions and any sketch with five candidate photos without giving Gemini the answer key. The October 16 follow-up implements seven-dimension sensory scoring with older-result compatibility, permanent finished receipts and private thinking/model comparisons. This replaces the older single-target/model-upgrade plan. See [BLIND-JUDGING-PLAN.md](BLIND-JUDGING-PLAN.md).

Branch `codex/rv-blind-judging` is a new isolated cloud branch at that main, proposing `2026.10.16.1` / `ablty-v100` after the approved audit follow-up. No Cursor branch was changed. #140 and #145 were checked and remain open; their useful work is already in #147. They overlap documentation and app files but do not contain competing blind-judging work. Johnny may close them as superseded; do not merge them.

## Implementation boundary and release gates

- October 19: every session is now judged five times with the photos rotated through the five slots and the ratings averaged, after a private evaluation found the judge favors slot A. A match strength label ("Strong", "Moderate" or "Weak match") sits next to the rank in results, history and export. Protocol name unchanged (`blind-five-v1`); the never-applied migration was edited in place. Cloudflare Workers Paid is active as of October 19; Supabase Pro is not.
- Code covers the five-photo protocol, metadata-free 768px derivatives with pinned hashes, complete-submission locking, server-calculated scores/ties, written-only submissions and rank display/history/export. Existing historical records stay intact and labelled legacy. Charts separate methods.
- A new migration adds server-only numeric receipts and a conditional completion function for an owner's previously saved ungraded session. It stores no raw session content in receipts. Existing app-owned history stores rankings in a nullable JSON column.
- Migration file only: **not applied**. An authorized operator must verify the live base schema, apply it separately and verify its permissions before the app/Worker release. No Supabase, Stripe or Cloudflare configuration has been changed.
- Production Gemini 2.5 Flash, thinking budget 0 and dream tagging remain unchanged. Official Google documentation was checked on October 16; the private evaluator supports 2.5 Flash budgets and 3.8 Flash thinking levels. Actual compatibility, quality, latency and cost remain unverified by paid calls. The evaluator defaults to no API calls and requires `--run-paid`, a securely supplied `ABLTY_GEMINI_TEST_KEY` and owner-approved private cases. No environment or provider settings were changed in this follow-up.
- Automated tests use local fixtures and disposable PostgreSQL/Chromium. They do not establish AI accuracy, production schema compatibility, deployment, billing or physical-phone readiness. Keep the PR draft until the evaluation and migration ordering are resolved.
- Finished numeric receipts in state `done` are retained permanently with creation/completion timestamps and no user IDs or raw session content. Only expired unfinished receipts are pruned on subsequent assignment creation. The two-hour claim/retry window is unchanged; permanent retention does not allow late replay. An interrupted model request with uncertain outcome stays blocked rather than producing a second judgment. This beta implementation is not a tamper-proof research platform.

## Earlier checks and remaining phone work

The October 14 read-only checks reached `ablty.app/version.json` at `2026.10.13.2`; `/LAUNCH-PLAN.html` and `/CLAUDE.html` returned 404. The Worker `/ping` returned Cloudflare 403 / error 1010. Do not describe it as verified healthy or assume the website result verifies phone caches.

Steps 1 to 7 are implemented. Step 6's entitlement migration was recorded applied and verified October 6; do not reapply it. Johnny's October 9 sync report showed the recovery offer clearing after Move, but return to the original account and close/reopen are still unconfirmed. Preserve all distinct results and the guarded content comparison; never clear storage to remove a warning.

Phone checks still required: WBTB alarm followed by its notification continues one countdown; sync recovery stays recovered after switching back/reopening; Reality Check cold/background notification; Settings gestures; Presentiment; signup/verification/reset; installed-app updates. The WBTB end-label and later wake-title copy issues were not included in #147.

After blind-judging release approval, test a written-only and sketch-plus-impressions session, ties, missing-photo/service failure, retry, cloud restore and two-account isolation on iPhone and Android. Record device, version and pass/fail/not run. No new beta invitations until step 15's pilot gates pass.

## Next priority

Complete the step 9 review/evaluation/release gates, then step 8: code-first signup, verification handling and 30-day beta Premium with server-enforced limits and expiry. Existing paid or manually granted Premium stays unchanged. No Stripe/card for beta. Steps 10, 11, 12 and 13 follow; dashboard 14 is optional; pilot 15 precedes wider invites 16.

Keep one task per isolated branch and draft PR. No automatic merge, deployment, production migration, email or provider-settings change.

## Upcoming features and their requirements

Agents must judge every change against where ABLTY is going, not only where it is today. These features are planned. Any code that touches scores, sessions, or user data must stay compatible with them.

Same-target sessions (next feature after blind judging, once the pre-beta steps are done): after an RV session, the results screen will offer a button to view other users' best sessions on the same target. It shows the top 3 to 5 highest-scored sessions, the viewer's place among people who viewed that target, and a "learn from the best" angle. Sharing is anonymous and on by default. Credited usernames and public profiles showing a user's best sessions may be added later as an opt-in.

Later: leaderboards, a Daily Community RV Challenge, a live public stats page, an Ability Profile, and Ganzfeld Link (paired telepathy).

Requirements these features create:

1. Scores shown to other users must be recomputed from rv_blind_receipts on the server. rv_sessions.score is written by the user's device and is not trustworthy for ranking.
2. Nothing shown to other users may include user_id, email, or any value that identifies the author, unless that author has opted in to credit.
3. Other users' written impressions and sketches will be visible to strangers, so a report or moderation path is required before launch of any sharing feature.
4. Whether beta tester sessions (profiles.is_tester) appear in other users' results is undecided. Do not hard-code either choice.
5. The blind protocol is non-negotiable. Other users' sessions on a target may only be shown after the viewer's own session is submitted and the target is revealed.
6. rv_sessions.dimension_scores, blind_judging, the target fields and summary are all written by the user's device, just like rv_sessions.score. Any feature shown to other users must recompute all of them, including the match strength label, from the receipt (rv_blind_receipts.rotation_matrices).

Standing rule for every agent: if you notice a security, data integrity, privacy, or cheating risk outside your task, list it in your report under "Noticed but not touched." Never fix it without approval.
