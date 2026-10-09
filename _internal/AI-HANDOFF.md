# ABLTY: current AI handoff

Last updated: 2026-10-09, Chicago. This is a dated checkpoint, not proof of the current deployed state. Fetch GitHub and inspect current PR heads before resuming. The repository is the source of truth; uploaded project-source copies may be old.

## Start here

Read `CLAUDE.md`, `.cursor/rules/ablty-workflow.mdc`, this file, `LAUNCH-PLAN.md`, `_internal/PRE-BETA-PLAN.md`, and the latest `_internal/WORK-LOG.md` entries. Check whether PRs #140 and #141 have changed or merged. This handoff is proposed in draft PR #140 on `docs/beta-priority-budget-20261009`; it is not on main until merged.

Johnny is conserving a small amount of expiring Cursor credit. Do not restart a broad audit or duplicate another agent's active work. Johnny chose to finish #141 first. Its code review now passes; next priority is Step 9, target-image grading. Sync deployment and phone verification remain pending. Step 8 follows as budget allows; do not start it automatically.

## Current status

- Steps 1 through 7: implemented in prior PRs. Step 6's production application has a separate recorded verification. Preserve the existing deployment and phone-test distinctions in the plan.
- PR #139: merged at `f25232b2a2c8096f2d9ce3069f167f11f70d94c4`. Johnny's supplied diagnostic report confirmed the installed version was `2026.10.06.2`. It did not prove the update banner or sync recovery worked on a phone.
- PR #141: OPEN DRAFT at reviewed head `a38ccc1ac760297e7798c7c2db4102462df7e904`, branch `cursor/sync-recovery-get-help-bbab`, proposed version `2026.10.09.3` / `ablty-v87`. Reviewed with no remaining blocker identified; recommended for Johnny to merge. This is a review recommendation, not an actual merge or device verification. No deployment or production change was made during this review.
- PR #140: documentation-only priority and handoff record. It does not release the sync changes. Reconcile dated status text if merging alongside newer documentation in #141.
- Steps 8 and 9: not started according to the supplied work reports at this checkpoint. Verify current branches before beginning.

## Sync: what is established

Three parked Zener results blocked checks of five other recent results. The blocked check and the misleading default "Last cloud check: ok" were fixed in #141. Read-only production investigation established that the three IDs are held by another account which Johnny also owns. The exact contents of the copies on the phone still require the guarded in-app comparison. Do not publish account identifiers, result IDs, or private result contents.

The new recovery feature is local-only and must preserve all distinct data, verify cloud ownership and contents, and never regenerate IDs or alter cloud rows. The first review found failures involving full RV history, conflicting destination contents, and refused source cleanup. The second review found the two persistence/retry gaps below. All five findings are addressed in the reviewed head; do not reopen them solely because older work-log entries describe them as open.

## Sync review complete; deployment and phone check remain

1. **Destination already in memory but not durable: fixed.** `moveLocalResult` now reads back the complete destination entry even when the planning step says no write is needed. It attempts to persist a memory-only entry before source cleanup and refuses the move if that write fails. The new regression preserves the source on failure and verifies the successful retry after reload, including the complete entry.
2. **Failed queue cleanup hidden in the current session: fixed.** A refused shortened-queue write now restores the full active queue. The new regression checks that the unfinished item remains in the current recovery offer and can be cleaned up in the same session, with reload verification afterwards.

No remaining merge blocker was identified in this review at `a38ccc1`. Johnny must still authorize/perform the merge. Do not merge or deploy automatically. Do not equate passing automated tests with completed phone recovery or external-beta readiness.

### Evidence at reviewed head

- Independently run: cloud-sync-status 47 passed, update-detection 11 passed, app syntax 2 script blocks passed; whitespace check passed.
- GitHub workflow `PR 127 browser and local Supabase integration`: success on this exact head, run `37911993479`.
- Source review confirms the two final corrections address the synthetic failures reproduced at `773ced0`. The added tests exercise failed persistence, same-session retry and reload behavior. Cursor additionally reports both tests fail on the earlier code; this final review did not repeat the old-head comparison.
- Cursor reports the remaining suites and browser recovery walk-through passing. This review did not repeat that entire suite locally.
- Phone recovery and deployment: not tested. After Johnny merges and Pages builds, confirm installed version `2026.10.09.3` (or a later intentionally released version). Under the original account, verify the other recent results are checked. Under the account holding the cloud rows, open Details and use the recovery offer only if contents match. Return to the original account, then close/reopen and confirm the recovered items do not reappear as waiting. If recovery reports a partial cleanup, retry through Details; if it persists, retain the diagnostic report and stop. Do not promise exact found/re-queued counts before the device reports them. Do not clear app storage or delete results to remove warnings.

## Next credit priority: Step 9, Gemini target image

Start a separate branch based on current main, not the unmerged sync implementation. Review the current Worker and Step 9 before editing. At the prior audit, the grader sent the user's sketch plus target label/descriptors, but not the target photo. Confirm that remains true.

Implement target-image input using the server's trusted target metadata, clearly distinguish the sketch and target in the request, preserve the grading rubric and response contract, and keep the target hidden until submission. Handle image-fetch failure with the planned explicit fallback. Verify current model names and request parameters against official Gemini documentation; model names in older planning notes are not verified current facts.

Use focused request/failure tests and the plan's grading comparison, including mismatched targets, vague submissions and repeat runs. Higher scores alone do not show improvement. Record latency and usage where measurable. If credentials, private examples or API access block evaluation, save a precise checkpoint and do not claim quality validation passed. Keep private notes and sketches out of the public repo. Draft PR only; no automatic merge or Worker deployment.

## Step 8 decision that must survive the handoff

All existing Premium accounts remain unchanged. Do not convert them to expiring beta Premium, add an end date to their existing entitlement, or let beta expiry logic or banners remove that access. New beta access needs server-enforced redemption, limits, expiry, signup/verification handling and consistent entitlement checks. It is separate work after the target-image priority unless Johnny changes the order.

## Working boundaries

Repo-backed notes are the handoff, not an assumption that another AI remembers this chat. After each task, update this file's date, reviewed commit, outstanding issues, next action and device evidence, alongside the plan and work log. Keep explanations brief and plain. No production changes, messages to others, or automatic merges. A Get help email draft still requires the user to press Send; creating a draft is not a support response or confirmation that someone has read it.
