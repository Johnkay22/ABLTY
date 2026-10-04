# ABLTY WORK LOG

A running diary of pre-launch and beta work. **Newest entry at the top.** Every AI work session adds one entry in the same pull request as its work. Johnny can add entries too (for example phone test results).

Keep entries short and in plain English. Say what was actually done, not what was planned. Never paste secrets, keys, codes, user emails, dream text, sketches or notes here, and never describe how to exploit an open problem. This repository is public.

## Entry template

```
## YYYY-MM-DD: Step N, short title
- **Who:** Cursor / Claude Code / Claude chat / Johnny
- **Branch / PR:** branch-name, PR #number (draft / merged)
- **What changed:** one to three plain-English sentences.
- **Tests:** what passed, what failed, what was not run and why.
- **Production:** nothing changed / what Claude applied and verified.
- **Johnny needs to:** review and merge / test on phone / decide X / nothing.
- **Next:** the next step on the Status board.
```

---

## 2026-10-03: Step 0, planning files
- **Who:** Claude chat
- **Branch / PR:** `claude/pre-beta-plan`, draft PR
- **What changed:** Added the pre-beta plan (`_internal/PRE-BETA-PLAN.md`), this work log, and a Cursor rules file (`.cursor/rules/ablty-workflow.mdc`) that tells Cursor to read the plan, work one step at a time, and log its work here. Added pointers in `CLAUDE.md` and `LAUNCH-PLAN.md`. No app, Worker or database code changed.
- **Tests:** none needed (documents only).
- **Production:** nothing changed. Read-only checks this session: confirmed the only live database policy that checks Premium is on `lucidity_readings`; confirmed `https://ablty.app/LAUNCH-PLAN.html` is publicly served (addressed by step 1).
- **Johnny needs to:** review the files, merge, then in Cursor open Source Control and click Sync Changes. Do not make the repository private on GitHub's free plan; that takes ablty.app offline.
- **Next:** Step 1, stop the website publishing internal documents.
