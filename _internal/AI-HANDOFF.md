# ABLTY: current AI handoff

Last updated: 2026-10-09, Chicago. This is a dated checkpoint, not proof of the current deployed state. Fetch GitHub and inspect current PR heads before resuming. The repository is the source of truth; uploaded project-source copies may be old.

## Start here

Read `CLAUDE.md`, `.cursor/rules/ablty-workflow.mdc`, this file, `LAUNCH-PLAN.md`, `_internal/PRE-BETA-PLAN.md`, and the latest `_internal/WORK-LOG.md` entries. Check whether PRs #140 and #141 have changed or merged. This handoff is proposed in draft PR #140 on `docs/beta-priority-budget-20261009`; it is not on main until merged.

Johnny is conserving a small amount of expiring Cursor credit. Do not restart a broad audit or duplicate another agent's active work. Next priority is Step 9, target-image grading. Keep the sync follow-up below parked, accurately marked unfinished. Step 8 follows as budget allows; do not start it automatically.

## Current status

- Steps 1 through 7: implemented in prior PRs. Step 6's production application has a separate recorded verification. Preserve the existing deployment and phone-test distinctions in the plan.
- PR #139: merged at `f25232b2a2c8096f2d9ce3069f167f11f70d94c4`. Johnny's supplied diagnostic report confirmed the installed version was `2026.10.06.2`. It did not prove the update banner or sync recovery worked on a phone.
- PR #141: OPEN DRAFT at reviewed head `773ced097fcc40d0ad548d151627a5be18346ddf`, branch `cursor/sync-recovery-get-help-bbab`, proposed version `2026.10.09.2` / `ablty-v86`. Not approved for merge by this review. No deployment or production change was made during this review.
- PR #140: documentation-only priority and handoff record. It does not release the sync changes. Reconcile dated status text if merging alongside newer documentation in #141.
- Steps 8 and 9: not started according to the supplied work reports at this checkpoint. Verify current branches before beginning.

## Sync: what is established

Three parked Zener results blocked checks of five other recent results. The blocked check and the misleading default "Last cloud check: ok" were fixed in #141. Read-only production investigation established that the three IDs are held by another account which Johnny also owns. The exact contents of the copies on the phone still require the guarded in-app comparison. Do not publish account identifiers, result IDs, or private result contents.

The new recovery feature is local-only and must preserve all distinct data, verify cloud ownership and contents, and never regenerate IDs or alter cloud rows. The first review found failures involving full RV history, conflicting destination contents, and refused source cleanup. The updated tests cover those original cases, but the follow-up review found two remaining gaps.

## Resume sync here, before merging #141

1. **Destination already in memory but not durable.** `planLocalMove` can return `write: false` for an RV entry already present in `STATE.sessions`. `moveLocalResult` then skips its destination persistence check. Independently reproduced with a synthetic source entry, a matching cloud row and matching destination memory, but a refused destination history save: recovery reports success, removes the source and its queue, and after reload neither local history contains the entry. Cloud data remains, but local-only fields can be lost. Require durable verification of the complete destination entry on every path, including the no-write path, before source cleanup. Test failed saves and previously pruned destination entries with reloads.
2. **Failed queue cleanup is hidden in the current session.** `writePendingSync(fromOwner, rest)` installs `rest` in `_syncMemoryQueue` when persistence fails. Recovery returns `partial`, but the removed item is no longer visible to `readPendingSync` or `findRecoverableResults` until reload. Independently reproduced with two synthetic parked items: persistent queue still has both, current queue and the recovery offer contain only the second. Preserve unfinished cleanup in the live queue and keep it actionable without reloading. Add a same-session retry test as well as reload coverage.

Do not mark either issue fixed on the strength of this document. Correct them on the existing #141 branch, rerun targeted regressions, and have the new head reviewed. Do not merge or deploy without Johnny's approval. Leaving #141 as a draft allows the separate grading task to proceed; it does not clear sync readiness for beta testers.

### Evidence at reviewed head

- Independently run: cloud-sync-status 45 passed, update-detection 11 passed, app syntax 2 script blocks passed.
- GitHub workflow `PR 127 browser and local Supabase integration`: success on this exact head, run `37908404333`.
- Two additional synthetic experiments reproduced the outstanding gaps above using the real functions through the existing test harness. They were read-only with respect to the repository and production; no fix was committed.
- Cursor reports the remaining suites and browser recovery walk-through passing. This review did not repeat that entire suite locally.
- Phone recovery and deployment: not tested. After an approved fix is merged and Pages builds, verify the actual released version, checks of recent results, guarded recovery under the cloud-owning account, return to the original account, and persistence after closing/reopening. Do not promise exact found/re-queued counts before the device reports them. Do not clear app storage or delete results to remove warnings.

## Next credit priority: Step 9, Gemini target image

Start a separate branch based on current main, not the unmerged sync implementation. Review the current Worker and Step 9 before editing. At the prior audit, the grader sent the user's sketch plus target label/descriptors, but not the target photo. Confirm that remains true.

Implement target-image input using the server's trusted target metadata, clearly distinguish the sketch and target in the request, preserve the grading rubric and response contract, and keep the target hidden until submission. Handle image-fetch failure with the planned explicit fallback. Verify current model names and request parameters against official Gemini documentation; model names in older planning notes are not verified current facts.

Use focused request/failure tests and the plan's grading comparison, including mismatched targets, vague submissions and repeat runs. Higher scores alone do not show improvement. Record latency and usage where measurable. If credentials, private examples or API access block evaluation, save a precise checkpoint and do not claim quality validation passed. Keep private notes and sketches out of the public repo. Draft PR only; no automatic merge or Worker deployment.

## Step 8 decision that must survive the handoff

All existing Premium accounts remain unchanged. Do not convert them to expiring beta Premium, add an end date to their existing entitlement, or let beta expiry logic or banners remove that access. New beta access needs server-enforced redemption, limits, expiry, signup/verification handling and consistent entitlement checks. It is separate work after the target-image priority unless Johnny changes the order.

## Working boundaries

Repo-backed notes are the handoff, not an assumption that another AI remembers this chat. After each task, update this file's date, reviewed commit, outstanding issues, next action and device evidence, alongside the plan and work log. Keep explanations brief and plain. No production changes, messages to others, or automatic merges. A Get help email draft still requires the user to press Send; creating a draft is not a support response or confirmation that someone has read it.
