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

## 2026-10-04: Steps 1 to 5 in one pull request, plus plan revisions
- **Who:** Cursor (cloud agent)
- **Branch / PR:** `cursor/pre-beta-steps-1-5-bbab`, draft PR #135 (one PR for steps 1 to 5 at Johnny's request, one commit per step, one version bump: `2026.10.04.1` / `ablty-v82`)
- **What changed:**
  - Step 1: new `_config.yml` (exclude only) so GitHub Pages stops publishing `LAUNCH-PLAN.md`, `CLAUDE.md`, `tests/`, `supabase/`, `design/`, `wrangler.toml`, `ablty-worker.js` and the two prototype pages. The prototypes were included because Johnny had not said otherwise; remove those two lines if he wants them reachable.
  - Step 2: both `ablty.app/install.html` mentions in `earlybetaaccess.html` now say `/earlybetaaccess.html`; the app's GO TO INSTALL PAGE button opens `/earlybetaaccess.html` instead of the homepage. The new link check also found two leftover Cloudflare `email-decode.min.js` script tags in `app.html` that return 404 on GitHub Pages and had nothing to decode; removed.
  - Step 3: RV notes (results and detail), the grader's score reasoning (detail), the Hit / Noise / AOL rows (both views), the grading error reason, dimension labels and the email in the signup confirmation are now escaped before being placed in the page. No visual change.
  - Step 4: `saveDreamEntry` and background tagging capture the account, login and form before the first wait and touch the screen only while that same account and login are still active; a failed save is reported only to the account that pressed Save; tags are written only with the owner's own session.
  - Step 5: sessions are queued per account and uploaded from the queue; the Settings sync row now says "N results not saved to cloud yet. Tap to retry." when the database did not confirm, retries on the next save, on reconnect, on return to the foreground, at sign-in and on tap (5 automatic attempts per row). `renderSettingsState` and `completeSignIn` no longer claim "synced" unconditionally.
  - Step 5 review fixes (Johnny's review of PR #135, same day): the queue write now reports whether the phone's storage accepted it; if not, the queue is held in memory, the upload still happens, and "synced" appears only once the database confirmed. A duplicate-key answer is no longer taken as success: the row is looked up by id and owner; the owner's own row means an earlier attempt landed; someone else's row means the item stays queued as unresolved and that row is never touched. Found while fixing this: results table ids (`Date.now()`) are shared across all users and can collide; recorded as a later database change in the plan and in `LAUNCH-PLAN.md`.
  - Plan: the step 8 verification landing page must read the error Supabase attaches to the redirect (expired or used link), offer to request a new email instead of saying "verified", and carry install instructions.
  - Signup: the Check Your Email message now ends with "Don't see it within a few minutes? Check your junk or spam folder." (Before: "We sent a verification link to [email]. Tap it to activate your account.")
  - Docs: `LAUNCH-PLAN.md` Quick Reference corrected (website is GitHub Pages, Cloudflare only runs the Worker); plan step 8 rewritten to the code-first install page flow; Gemini 3.x request changes added to step 9; step 17 survey price changed to $5.99.
- **Tests:** passed: `node tests/check-app-syntax.js`, `node tests/check-page-links.js` (36 links, new), `node tests/safe-text-rendering.test.js` (6, new), `node tests/dream-save-isolation.test.js` (10, new), `node tests/cloud-sync-status.test.js` (15, new; includes the review regressions: refused queue write with a successful and a failed upload, duplicate key for the owner's own row, duplicate key for another account's row, duplicate key with a failed ownership check), `node tests/auth-consent.test.js` (107), `node tests/username-case-insensitive.test.js` (8), and the real-browser `tests/browser-account-isolation.test.js` (32, headless Chrome). Not run: the local-Supabase browser test (no Supabase stack in this environment) and anything on a phone.
- **Production:** nothing changed. Read-only checks only: live site headers (GitHub Pages), `LAUNCH-PLAN.html` returns 200 today, `_internal/` returns 404, live `version.json` is `2026.10.01.1`.
- **Johnny needs to:** review and merge; then after the Pages build, check `https://ablty.app/LAUNCH-PLAN.html` returns not found and `https://ablty.app/version.json` says `2026.10.04.1`; then the phone checks listed in the pull request.
- **Next:** Step 6, lock Premium so only the server can grant it (needs a new migration and Johnny's approval).

## 2026-10-04: Plan revision after second review
- **Who:** Claude chat
- **Branch / PR:** `claude/plan-revisions`, draft PR
- **What changed:** Revised `_internal/PRE-BETA-PLAN.md` after a second review. Added step 12 (account deletion must remove everything reliably) before the beta; privacy step now also fixes the 90-day retention wording and the "paid tier is not the same as never stored" point. Added a "What this beta includes" section and concrete pilot pass and stop criteria. Made the admin dashboard optional before the beta. Strengthened the grading test (mismatched pairs, vague submissions, repeat runs, cost and speed) and corrected the Gemini thinking setting (3.8 Flash cannot turn thinking off; use `low`). Broadened step 4 to protect the whole dream-save operation. Added basic cost and error alerts to the release step. Later steps renumbered: privacy is now 13, dashboard 14, release and pilot 15, invites 16, survey 17 and 18. Steps 1 to 11 keep their numbers.
- **Tests:** none needed (documents only).
- **Production:** nothing changed.
- **Johnny needs to:** review and merge. Confirm the beta scope section when convenient.
- **Next:** Step 1, stop the website publishing internal documents.

## 2026-10-03: Step 0, planning files
- **Who:** Claude chat
- **Branch / PR:** `claude/pre-beta-plan`, draft PR
- **What changed:** Added the pre-beta plan (`_internal/PRE-BETA-PLAN.md`), this work log, and a Cursor rules file (`.cursor/rules/ablty-workflow.mdc`) that tells Cursor to read the plan, work one step at a time, and log its work here. Added pointers in `CLAUDE.md` and `LAUNCH-PLAN.md`. No app, Worker or database code changed.
- **Tests:** none needed (documents only).
- **Production:** nothing changed. Read-only checks this session: confirmed the only live database policy that checks Premium is on `lucidity_readings`; confirmed `https://ablty.app/LAUNCH-PLAN.html` is publicly served (addressed by step 1).
- **Johnny needs to:** review the files, merge, then in Cursor open Source Control and click Sync Changes. Do not make the repository private on GitHub's free plan; that takes ablty.app offline.
- **Next:** Step 1, stop the website publishing internal documents.
