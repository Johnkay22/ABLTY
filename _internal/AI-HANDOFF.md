# ABLTY: current beta handoff

Updated 2026-10-13 (UTC). Inspected main: `3cecab9`, version `2026.10.11.5` / `ablty-v96`. Recheck GitHub before resuming; this dated checkpoint does not prove deployment or phone behavior.

## Current work and review

Johnny authorized the first item in the October 13 readiness work order: reconcile status and open PRs. This is separate from numbered pre-beta step 1, whose website exclusions already merged in #135.

Branch `codex/beta-readiness-reconcile` starts at inspected main and proposes version `2026.10.13.1` / `ablty-v97`. Replacement [draft PR #147](https://github.com/Johnkay22/ABLTY/pull/147) is open against main and was checked as mergeable on October 13. Automated GitHub checks run separately; inspect their current result before review. It contains the useful priorities and handoff from #140, updated to current facts, plus the WBTB timer repair and tests from #145. Both original PRs and branches remain untouched. After approving and merging the replacement, Johnny can close #140 and #145 as superseded without merging them. Do not retarget, force-push or merge Cursor's branches automatically.

The WBTB fix keeps one countdown when an alarm opens the wake screen and its notification is then tapped. Closing stops that countdown; reopening after closing starts a fresh 25 minutes. No scheduling, push delivery, protocol length or Presentiment behavior changed. `sw.js` changes only the cache/header version.

## What is established

- Steps 1 to 7 are implemented. The step-6 entitlement migration was recorded applied and verified in production October 6. Preserve that evidence and do not reapply it.
- Account isolation #130, Academy Lesson 01 #132, sync/update work #139/#141/#142, Settings gestures #143, notification handling #144 and Presentiment #146 are merged. Replacement reconciliation #147 has since merged at `dc9437d` (`2026.10.13.1` / `ablty-v97`).
- A Settings pull-to-close polish follow-up is a draft PR from `claude/settings-pull-close-effects-y0g4pd` (`2026.10.13.2` / `ablty-v98`). It does not change the step 9 then step 8 priority. Its phone checklist is in the PR.
- Johnny's October 9 phone report showed the sync recovery offer appearing and clearing after Move. Return to the original account and close/reopen remain unconfirmed. Preserve all distinct results and the guarded content comparison; never clear storage to remove a sync warning.
- The two last #141 review issues (destination persistence and failed queue cleanup) are fixed in merged code. Do not reopen them because an older log calls them unresolved. The historical cause of pre-isolation mixed data is not established by the fix.
- Before this repair, three of #145's six timer checks fail on current main. On this branch all six pass; notification browser checks 12, notification intent 22 and update checks 11 also pass. The browser uses local fixtures and simulated notification taps. Actual installed-phone notifications remain untested.
- During the October 13 assessment, 226 existing account/sync/data-handling/update checks passed, plus app syntax and 48 local links. Those tests do not establish live database or phone readiness.
- Public website and Worker health requests are blocked by the environment's network policy (tunnel 403), including the read-only elevated attempt. GitHub API reads work. This is an access limitation, not a finding that the live app is broken.

## What Johnny needs to do for this checkpoint

1. Review the replacement draft and its checks. Merging deploys through the existing integrations, so only Johnny decides when to merge. After it merges, close the older #140 and #145 proposals as superseded without deleting their branches.
2. After the approved build, open Settings > About and confirm `2026.10.13.1` (or a later intentionally released version). Start a short WBTB timer and keep the app open until it ends. Tap its wake notification: the countdown should continue once per second without returning to 25:00. Close the wake screen; a later fresh wake should start one new countdown. Repeat on iPhone and Android before promising WBTB to beta testers.
3. For sync recovery, return to the original account, inspect Settings > Data Sync, close/reopen and confirm recovered entries do not return as waiting. Keep the diagnostic report if anything remains; do not delete local data.
4. To enable cloud read-only deployment checks, review/save the environment network draft adding `ablty.app` and `abltygrader.kayvideoproductions.workers.dev`, then publish the development environment. The saved addition preserves `api.github.com` and existing presets. It does not change application hosting or any production setting. Access must be retried afterward.

Record device, version, action and pass/fail/not run in the work log. The full release/phone pilot remains step 15. Remaining known WBTB copy issues from #145 (the end-label element and later wake titles after a return prompt) were not changed or declared fixed by this timer repair.

## Next implementation priority

Step 9: let grading see the trusted target photo as well as the sketch. Preserve blind assignment, response format, rubric and retry behavior. Verify current Gemini model names, request fields and prices against official documentation before choosing a model. Compare matched, mismatched, vague and repeated submissions, including latency and usage. Keep private examples out of the public repo; missing API access or examples means quality evaluation is unrun, not passed.

Then step 8: code-first signup, verification handling and 30-day beta Premium with server-enforced limits and expiry. Existing paid or manually granted Premium remains unchanged. No Stripe or card for the beta. Follow with steps 10, 11, 12 and 13; dashboard 14 is optional, pilot 15 precedes wider invites 16. Survey work waits for steps 17 and 18.

This reconciliation does not implement or authorize production rollout of those later steps. Read `CLAUDE.md`, both plans and the newest work-log entry; coordinate task ownership, use an isolated branch, and finish one task in a draft PR. No automatic merge, deployment, production migration, email or provider-setting changes.
