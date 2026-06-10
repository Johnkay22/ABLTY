# ABLTY LAUNCH STATUS

**Last updated:** 2026-06-10  
**Current app version:** 2026.06.09.3 / ablty-v40  
**Status:** Pre-launch audit complete. Starting B1.

---

## HOW TO USE THIS FILE

This is the single source of truth for launch progress. Update it after every merged PR.

- Check the box when the task is **merged and verified on device**, not just written or committed.
- Fill in the PR number so you can trace back to the diff.
- Claude Code prompts should always start with: "Read LAUNCH-STATUS.md before doing anything."
- If a task surfaces a new issue, add it to the NOTES column, don't start a side quest.

---

## PRE-LAUNCH (in order, ends at "safe to soft launch")

| # | Task | Severity | Status | PR | Notes |
|---|---|---|---|---|---|
| B1 | Fix three statistical thresholds (Zener verdict hits>=9, cumulative Zener pool raw counts, Presentiment sigma 2.0) | BLOCKER | [ ] Not started | | |
| B2 | Fix legal/marketing copy: remove "objective," reframe unbuilt community features, fix cancel-in-settings promise, update both Terms copies and both Privacy copies | BLOCKER | [ ] Not started | | |
| B3 | Remove Photo Pair entirely (~16 code regions). Keep pp_sessions table and delete-account reference | BLOCKER | [ ] Not started | | |
| B4 | Rename T018b to T064 in Worker pool, fix parseInt target ID at app.html line ~12242 to store string | MEDIUM | [ ] Not started | | |
| B5 | Add client_reference_id (Supabase user ID) to Stripe Payment Link URL in handleUpgradeCTA | HIGH | [ ] Not started | | |
| B6 | Activate Stripe Customer Portal, add "Manage subscription" button in settings for premium users | HIGH | [ ] Not started | | |
| B7 | Verify password reset full loop on a real phone (request, email, tap link, modal opens, new password works) | BLOCKER | [ ] Not started | | Verification only, no code unless it fails |
| B8 | Remove dead /debug client panel and button from app.html | LOW | [ ] Not started | | |
| B9 | Fix WBTB alarm cleanup in delete-account (object keyed by endpoint ID, not array with userId) | LOW | [ ] Not started | | |
| B10 | Add login loading state ("Signing in..." on button) | LOW | [ ] Not started | | |
| B11 | Accept daily-reset asymmetry (client=local midnight, server=UTC midnight, guest limit client-only) | DECISION | [ ] Accepted | n/a | No code needed. Just confirm you're ok with it. |
| B12 | Full real-device QA pass (guest, free, premium, offline, update, abuse checks) on iPhone + Android | BLOCKER | [ ] Not started | | See test plan in Document 2 |
| B13a | Upgrade Supabase to Pro | BLOCKER | [ ] Not started | n/a | |
| B13b | Add Cloudflare Workers Paid ($5/mo) to remove KV write quota ceiling | BLOCKER | [ ] Not started | n/a | See Document 4 Section 3 |
| B13c | Create LIVE Stripe Payment Link, copy URL | BLOCKER | [ ] Not started | n/a | |
| B13d | Add LIVE webhook endpoint in Stripe, copy signing secret | BLOCKER | [ ] Not started | n/a | |
| B13e | Update Worker secret STRIPE_WEBHOOK_SECRET to live signing secret | BLOCKER | [ ] Not started | n/a | |
| B13f | Replace test Payment Link URL in app.html with live URL (keep client_reference_id + prefilled_email params) | BLOCKER | [ ] Not started | | |
| B13g | Bump APP_VERSION, sw.js CACHE_NAME to ablty-v41, update version.json, deploy | BLOCKER | [ ] Not started | | |
| B13h | Make one real $4.99 purchase, confirm tier flips, cancel via portal, confirm revert | BLOCKER | [ ] Not started | n/a | |

**After B13h passes: safe to soft launch.**

---

## POST-LAUNCH (recommended order)

| # | Task | Status | PR | Notes |
|---|---|---|---|---|
| C1 | Google sign-in (OAuth consent screen, Supabase provider, buttons, username-claim step for OAuth users, guest migration + legal acceptance for OAuth) | [ ] Not started | | Do before any public marketing push |
| C2 | Photo Pair replacement decision. If Precognition: integrate v6 prototype via the May 15 handoff doc | [ ] Not started | | |
| C3 | Daily Community RV Challenge (resolve 9 architectural decisions first, then 9-prompt build) | [ ] Not started | | Ship as "Week 1 update" |
| C4 | UX polish batch (any QA leftovers, empty states) | [ ] Not started | | |
| C5 | WBTB Re-Entry Protocol (7-step spec, sub-PRs D-1 through D-7) | [ ] Not started | | |
| C6 | Pre-Session Warm-Up integration (Box Breathing + Pink Noise prototype) | [ ] Not started | | |
| C7 | RV redesign screens (5 blue-direction prototypes, batch integration) | [ ] Not started | | |
| C8 | Target pool expansion to 75-100, fix carousel horse duplication | [ ] Not started | | |
| C9 | Legal acceptance server-side write (move from client to Worker route or Supabase function) | [ ] Not started | | |
| C10 | Landing page rebuild, then SEO plugin pass | [ ] Not started | | |
| C11 | Google Cloud/Firebase cleanup (after hours-tracker migration confirmed) | [ ] Not started | | |
| C12 | Ability Profile, leaderboards UI, Play Store TWA | [ ] Not started | | Play Store waits for validated web revenue |

---

## QUICK REFERENCE

**Repo:** Johnkay22/ABLTY  
**Worker:** abltygrader.kayvideoproductions.workers.dev  
**Supabase project:** ghjajyxcjfqidcmqdzdp  
**Stripe:** test mode until B13  
**Gemini model:** gemini-2.5-flash  

**Claude Code session starter:**  
"Read LAUNCH-STATUS.md first. That file is the current state of the project. Do not assume anything about what has or hasn't been done without checking it."

**Rule:** A task is not done until the box is checked here. Written does not equal run. Run does not equal merged. Merged does not equal verified on device.
