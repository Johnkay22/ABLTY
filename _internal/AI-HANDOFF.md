# ABLTY: current beta handoff

Draft review: [PR #149](https://github.com/Johnkay22/ABLTY/pull/149). Do not merge until the evaluation and migration prerequisites below are complete.

Updated October 16, 2026 (Chicago). Inspected main `8a8e416`: #147 readiness/WBTB repair and #148 Settings polish are merged, version `2026.10.13.2` / `ablty-v98`. Recheck GitHub before resuming. Main status is not phone evidence.

## Current authorized task

Johnny approved the plan and implementation of **step 9, blind judging**. It compares all written impressions and any sketch with five candidate photos without giving Gemini the answer key. The October 16 follow-up implements seven-dimension sensory scoring with older-result compatibility, permanent finished receipts and private thinking/model comparisons. This replaces the older single-target/model-upgrade plan. See [BLIND-JUDGING-PLAN.md](BLIND-JUDGING-PLAN.md).

Branch `codex/rv-blind-judging` is a new isolated cloud branch at that main, proposing `2026.10.16.1` / `ablty-v100` after the approved audit follow-up. No Cursor branch was changed. #140 and #145 were checked and remain open; their useful work is already in #147. They overlap documentation and app files but do not contain competing blind-judging work. Johnny may close them as superseded; do not merge them.

## Implementation boundary and release gates

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
