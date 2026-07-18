# ABLTY LAUNCH STATUS

**Last updated:** 2026-07-18
**Current app version:** 2026.06.09.3 / ablty-v40
**Status:** B1, B8, B9, B10 complete (PR #104). WBTB Re-Entry Protocol complete (PRs #88-#100). Next up: B3.

---

## HOW TO USE THIS FILE

This is the single source of truth for launch progress. Update it after every merged PR.

- Check the box when the task is **merged and verified on device**, not just written or committed.
- Fill in the PR number so you can trace back to the diff.
- Claude Code prompts should always start with: "Read LAUNCH-STATUS.markdown before doing anything. Note the extension is .markdown."
- If a task surfaces a new issue, add it to the NOTES column, don't start a side quest.

---

## PRE-LAUNCH (in order, ends at "safe to soft launch")

| # | Task | Severity | Status | PR | Notes |
|---|---|---|---|---|---|
| B1 | Fix three statistical thresholds (Zener verdict hits>=9, cumulative Zener pool raw counts, Presentiment sigma 2.0) | BLOCKER | [x] Done | #104 | Also replaced normal approximation with exact binomial upper tail for cumulative Zener/Photo Pair verdicts |
| B2 | Fix legal/marketing copy: remove "objective," reframe unbuilt community features, fix cancel-in-settings promise, update both Terms copies and both Privacy copies | BLOCKER | [ ] Not started | | Chat-side drafting task, then small PR to apply approved text |
| B3 | Remove Photo Pair entirely (~16 code regions). Keep pp_sessions table and delete-account reference | BLOCKER | [ ] Not started | | |
| B4 | Rename T018b to T064 in Worker pool, fix parseInt target ID at app.html line ~12242 to store string | MEDIUM | [ ] Not started | | |
| B5 | Add client_reference_id (Supabase user ID) to Stripe Payment Link URL in handleUpgradeCTA | HIGH | [ ] Not started | | Do as one payments PR with B6 and B14 |
| B6 | Activate Stripe Customer Portal, add "Manage subscription" button in settings for premium users | HIGH | [ ] Not started | | |
| B7 | Verify password reset full loop on a real phone (request, email, tap link, modal opens, new password works) | BLOCKER | [ ] Not started | | Verification only, no code unless it fails |
| B8 | Remove dead /debug client panel and button from app.html | LOW | [x] Done | #104 | |
| B9 | Fix WBTB alarm cleanup in delete-account (object keyed by endpoint ID, not array with userId) | LOW | [x] Done | #104 | |
| B10 | Add login loading state ("Signing in..." on button) | LOW | [x] Done | #104 | |
| B11 | Accept daily-reset asymmetry (client=local midnight, server=UTC midnight, guest limit client-only) | DECISION | [ ] Accepted | n/a | No code needed. Just confirm you're ok with it. |
| B12 | Full real-device QA pass (guest, free, premium, offline, update, abuse checks) on iPhone + Android. Include WBTB QA checklist below | BLOCKER | [ ] Not started | | See test plan in Document 2 plus WBTB QA CHECKLIST section in this file |
| B14 | Gate the WBTB 5-tap dev skip. Wrap in `if (localStorage.getItem('ablty_dev'))` check | BLOCKER | [ ] Not started | | Until gated, any user tapping 5 times can skip protocol steps. Small fix, fold into B3 or B4 session |
| B15 | Seed 10+ rows in `lucidity_readings` table via Supabase dashboard (currently 3 placeholders) | HIGH | [ ] Not started | n/a | No code deploy. Content spans categories: mild, biology, reality-check. Draft content in chat first |
| B16 | Harden Stripe webhook: match users by client_reference_id, not email. Add stripe_customer_id, stripe_subscription_id, subscription_status, and billing period columns to profiles table | HIGH | [ ] Not started | | Customers paying with a different email than signup would otherwise be charged but never upgraded. Part of the payments PR with B5/B6 |
| B13a | Upgrade Supabase to Pro | BLOCKER | [ ] Not started | n/a | |
| B13b | Add Cloudflare Workers Paid ($5/mo) to remove KV write quota ceiling | BLOCKER | [ ] Not started | n/a | See Document 4 Section 3 |
| B13c | Create LIVE Stripe Payment Link, copy URL | BLOCKER | [ ] Not started | n/a | Verify live products/prices match intended pricing ($5.99/mo, $39.99/yr) before creating. Old tracker referenced $4.99, confirm which is correct |
| B13d | Add LIVE webhook endpoint in Stripe, copy signing secret | BLOCKER | [ ] Not started | n/a | |
| B13e | Update Worker secret STRIPE_WEBHOOK_SECRET to live signing secret | BLOCKER | [ ] Not started | n/a | |
| B13f | Replace test Payment Link URL in app.html with live URL (keep client_reference_id + prefilled_email params) | BLOCKER | [ ] Not started | | |
| B13g | Bump APP_VERSION, sw.js CACHE_NAME to ablty-v41, update version.json, deploy | BLOCKER | [ ] Not started | | |
| B13h | Make one real purchase, confirm tier flips, cancel via portal, confirm revert | BLOCKER | [ ] Not started | n/a | |

**After B13h passes: safe to soft launch.**

---

## WBTB QA CHECKLIST (fold into B12)

- [ ] Verify Step 3 (RC Drill) is hidden for free accounts and shown for premium
- [ ] Verify Step 4 (Lucidity Reading) is hidden for free accounts and shown for premium
- [ ] Verify "Skip this step" on gate cards advances correctly (free user skips 3, lands on 4, sees gate again; free user skips both, lands on Step 5)
- [ ] Verify gated_skip_3 and gated_skip_4 appear in wbtb_sessions.completion_state on Supabase for a free test account
- [ ] Verify all 3 Step 2 paths (A: normal, B: groggy, C: no recall) produce valid Dream Lab entries
- [ ] Verify Step 7 Morning Sync correctly updates the previous night's wbtb_sessions row (not creating a new one)
- [ ] Verify protocol resumes correctly after app background/foreground (localStorage state machine)
- [ ] Verify morning sync modal appears on app open when pendingSync: true

---

## POST-LAUNCH (recommended order)

| # | Task | Status | PR | Notes |
|---|---|---|---|---|
| C1 | Google sign-in (OAuth consent screen, Supabase provider, buttons, username-claim step for OAuth users, guest migration + legal acceptance for OAuth) | [ ] Not started | | Do before any public marketing push |
| C2 | Signal Scanner integration into app.html | [ ] Not started | | Decision made: Signal Scanner is the Photo Pair replacement. Standalone prototype merged in PRs #102 and #103. Preserve prototype scoring exactly: Poisson-binomial weighted lifetime test, 2-4 crypto-random target zones chosen post-lock, session hit count pre-baseline, lifetime rate vs. chance with significance-gated verdicts post-baseline |
| C3 | Daily Community RV Challenge (9 architectural decisions locked, needs 9-prompt build) | [ ] Not started | | Ship as "Week 1 update" |
| C4 | UX polish batch (any QA leftovers, empty states) | [ ] Not started | | |
| C5 | WBTB Re-Entry Protocol (7-step spec, sub-PRs D-1 through D-7) | [x] Done | #88-#100 | All 7 steps implemented, DB schema live, premium gates active. Remaining WBTB items promoted to B14 and B15 above |
| C6 | Pre-Session Warm-Up integration (Box Breathing + Pink Noise prototype) | [ ] Not started | | v3 single-flow spec drafted, awaiting sign-off |
| C7 | RV redesign screens (5 blue-direction prototypes, batch integration) | [ ] Not started | | |
| C8 | Target pool expansion to 75-100, fix carousel horse duplication | [ ] Not started | | Partially done: 27 targets (T037-T063) added in PR #83, orphan image removed in #84. Horse duplication still unverified |
| C9 | Legal acceptance server-side write (move from client to Worker route or Supabase function) | [ ] Not started | | |
| C10 | Landing page rebuild, then SEO plugin pass | [ ] Not started | | |
| C11 | Google Cloud/Firebase cleanup (after hours-tracker migration confirmed) | [ ] Not started | | |
| C12 | Ability Profile, leaderboards UI, Play Store TWA | [ ] Not started | | Play Store waits for validated web revenue |
| C13 | WBTB nice-to-haves: dim/warm CSS for Step 4 reading wrap, per-step drop-off analytics dashboard, expand readings to 10-15 original pieces | [ ] Not started | | Carried over from retired WBTB tracker, not blocking |

---

## QUICK REFERENCE

**Repo:** Johnkay22/ABLTY
**Worker:** abltygrader.kayvideoproductions.workers.dev
**Supabase project:** ghjajyxcjfqidcmqdzdp
**Stripe:** test mode until B13
**Gemini model:** gemini-2.5-flash

**Claude Code session starter:**
"Read LAUNCH-STATUS.markdown first (the .markdown extension, there is no other status file). That file is the current state of the project. Do not assume anything about what has or hasn't been done without checking it."

**Rule:** A task is not done until the box is checked here. Written does not equal run. Run does not equal merged. Merged does not equal verified on device.
