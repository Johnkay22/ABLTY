# ABLTY Project Instructions

**Current handoff (2026-10-09):** read [`_internal/AI-HANDOFF.md`](_internal/AI-HANDOFF.md) before choosing work. PR #141 at `a38ccc1` passes code review and is recommended for Johnny to merge; deployment and phone recovery remain unverified. Johnny's next credit priority is Step 9 target-image grading, then Step 8 as budget allows.

## Workflow
- Read `LAUNCH-PLAN.md` in full at the start of every session. It is the overall launch status document. Update it in the same PR as your work.
- For the private beta, also read `_internal/PRE-BETA-PLAN.md` (the step-by-step pre-beta plan and its Status board) and the newest entries in `_internal/WORK-LOG.md`. For pre-beta work, the plan's Status board is the checklist: update that step's row and add a work log entry in the same PR as your work. Follow the rules at the top of the plan (one step at a time, audit first, draft PRs only, never touch production).
- Always create a pull request after pushing changes. If a PR already exists for the current branch, note that the new commits are included in the existing PR.
- Always bump `APP_VERSION` in `app.html`, `version` in `version.json`, and `CACHE_NAME` in `sw.js` together when making changes that need to be deployed.
