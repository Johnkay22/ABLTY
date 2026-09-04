# ABLTY LAUNCH PLAN

**This is the one true pre-launch document. Every other status, handoff, audit, or checklist doc is dead. If another doc disagrees with this one, this one wins.**

**Created:** 2026-08-23, from a live audit of the repo, the deployed Worker, and the Supabase database.
**Rewritten:** 2026-09-03, after a second live audit of `main` (`54ec92f`) plus Johnny's product decisions. The 2026-08-23 claims that were wrong are corrected here, not left as history.
**App version at rewrite:** 2026.08.13.3 / sw cache ablty-v69
**Status:** Phase 0 not started. Task 0.1b is this PR.

---

## HOW TO USE THIS FILE

- Read this entire file before doing anything, every session. Update it as the final step of every task, in the same PR as the work.
- A task is done only when it is **merged and verified on device**. Written does not equal run. Run does not equal merged. Merged does not equal verified.
- Check the box, fill in the PR number, add a one-line note if anything surprising happened.
- If a task surfaces a new problem, add it to the DISCOVERED ISSUES section at the bottom. Do not start a side quest.
- One PR per task unless a task explicitly says otherwise. Every task starts on a fresh branch off updated main. Claude Code opens PRs and never merges them.
- Worker-only changes (`ablty-worker.js`) deploy independently and do not require bumps to `APP_VERSION`, `version.json`, or `CACHE_NAME`. Anything touching `app.html` that users must receive requires all three bumps.
- Do not send a fast/low-thinking model at 0.1 or 2.2/2.3. Those tasks fail silently if the matching or consent path is wrong.

---

## DEFINITION OF LAUNCH READY

The app is launch ready when all of the following are true:

1. **Nothing silently breaks.** Signups always create complete accounts (profile + settings + legal acceptance), a taken username is rejected with a clear message, password reset works, payments always land on the right account, and a full device QA pass is clean on iPhone and Android.
2. **Money works end to end.** Both plans purchasable live, correct pricing everywhere including all four legal copies, self-serve cancellation, a real purchase and cancellation verified with a real card.
3. **It feels full, not beta.** Two psi test modules (Zener, Presentiment), a complete Academy Stage I, an 80-target RV pool with unique images, Dream Lab with enough reading content to last, and no screen that promises something that does not exist.
4. **The front door matches reality.** The landing page sells installing a live app, not joining a waitlist.

Launch does not require: Daily Community RV Challenge, Signal Scanner, Academy voiceover, Academy Stages II through VI, Ganzfeld, rank-order judging, CRV structured session mode, the typography migration, Capacitor, or Play Store. Those are post-launch. See the parking lot.

---

## PHASE 0 - FOUNDATION (before any testers)

| # | Task | Why | Status | PR | Notes |
|---|---|---|---|---|---|
| 0.1 | Signup completeness, in one PR: (a) `auth.users` trigger that inserts `public.profiles` and `public.user_settings` with `ON CONFLICT DO NOTHING`; (b) change `onSignedIn` so legal-acceptance fields are written onto an existing profile when they are null (today they are written only inside `if (!profile)`, so a trigger-created row would never get consent); (c) a small RPC/function, callable by anon, that answers only whether a username is taken, and wire the signup form to show "That username is already being used. Try another."; (d) commit the live-but-untracked schema into `supabase/migrations` (`is_tester`, `community_rv_targets`, `public_usernames` view, and the three early migrations missing from the folder). No orphan backfill. | Profiles are created client-side today. Interrupted signups leave auth accounts with no profile. The username-taken check currently queries `profiles` as anon against an own-row SELECT policy, so it always returns empty and every name looks free. Collisions only surface later as `seeker_xxxx`. A trigger without the legal-write change silently drops consent recording. The repo migrations folder is not a full record of the live database; `community_rv_targets` and `public_usernames` must be tracked because the Daily Community RV Challenge is coming. | [ ] | | Trigger must derive a unique username from `raw_user_meta_data.username`, falling back to `seeker_<8 chars>` only for a same-second race. Do not backfill named orphans: live check on 2026-09-03 found 5 auth users, 5 profiles, 5 settings, 0 orphans. `coryy418` and `gogogonzoflow` no longer exist. Use `apply_migration`. Document that `public_usernames` is SECURITY DEFINER on purpose (leaderboard + availability). |
| 0.1b | Point `CLAUDE.md` at this file. Rename `LAUNCH-PLAN-3.md` → `LAUNCH-PLAN.md`. Strip stale `robots.txt` disallows for docs that were already deleted. | Claude Code reads `CLAUDE.md` automatically. The six superseded docs were already deleted from the repo; the pointer and the filename were the remaining work. | [x] | this PR | Docs already gone on `main` before this rewrite. |
| 0.2 | Verify the password reset loop on a real phone: request, receive email via Resend, tap link, modal opens, set new password, sign in with it. | Code exists (`resetPasswordForEmail` → `/app.html`, `PASSWORD_RECOVERY` opens the change-password modal) but has never been verified end to end. If broken, locked-out users leave. Verification only, no code unless it fails. | [ ] | n/a | |
| 0.3 | Remove the Academy "VOICE ON/OFF" toggle and all browser `speechSynthesis` narration. Keep lesson copy and Web Audio tones/haptics. Three version bumps. | The toggle promises produced narration and currently drives the phone's built-in TTS. Johnny is shipping Stage I silent at launch; ElevenLabs voiceover is post-launch. | [ ] | | Next PR after this rewrite. Keep empty `speak`/`hush` no-ops or delete call sites without changing lesson flow. Also drop `ACAD_VOICE_KEY` from `ACAD_STORAGE_KEYS`. |

---

## PHASE 1 - BETA (target: start within days of Phase 0, run about 2 weeks)

| # | Task | Why | Status | PR | Notes |
|---|---|---|---|---|---|
| 1.1 | Reframe the Academy landing copy. Remove the "27 LESSONS" and "6 STAGES" tags. Present Stage I as the current training track and later stages as in the pipeline. Keep the declassified-method framing. The first-visit stage list currently shows I–IV while the tag says 6; make both honest. | The screen promises 27 lessons and 3 exist. Testers hit the wall in minutes and it reads as abandoned. Copy-only change plus version bumps. | [ ] | | After 3.1 ships lessons 04–06, update this copy again to "Stage I complete." |
| 1.2 | Fix then verify `earlybetaaccess.html`. Code fix first: two strings still say `ablty.app/install.html`, which 404s (iOS non-Safari step copy, and the QR `aria-label`). Point both at `/earlybetaaccess.html`. The desktop QR already decodes to that URL. Then device-verify on iPhone and Android: animated logo, per-device install instructions, QR on desktop, and the main button flipping to "OPEN ABLTY" after install (there is no separate "Already installed?" link). Confirm any tester-facing link actually points here. | The page is deployed, noindexed, and linked from nowhere except this plan. Testers arrive through it. | [ ] | | The `install.html` fix needs version bumps if it ships as its own PR; if bundled with 1.1, one bump covers both. |
| 1.3 | Provision each tester in Supabase using the corrected SQL in the QUICK REFERENCE section, after they have signed up. Then confirm each row updated (query it back). | `profiles` has no email column. Confirming the update is the last line of defense if 0.1 missed a signup. | [ ] | n/a | Two weeks unlimited premium. One-year extension on exit survey completion. |
| 1.4 | Seed `lucidity_readings` with 10 or more original pieces spanning mild, biology, and reality-check. Draft in chat with Johnny first, then insert via SQL. In the same small app change (or bundled with 1.1), stop picking `candidates[0]`: shuffle or pick randomly among unseen rows, otherwise ten rows still always serve in table order. | Live table has the 3 placeholder seed rows from the migration. Premium WBTB users run out on night four. | [ ] | | Selection lives at `app.html` ~11133. |
| 1.5 | Full device QA pass on iPhone and Android: guest, free, and premium accounts, offline behavior, the service worker update path, and abuse checks (daily limits, gated features). Include the WBTB checklist below. | The only way to find what real users will find. | [ ] | n/a | Log every finding in DISCOVERED ISSUES, fix in separate PRs. |

**WBTB QA sub-checklist (part of 1.5):**
- [ ] Step 3 (RC Drill) hidden for free, shown for premium
- [ ] Step 4 (Lucidity Reading) hidden for free, shown for premium
- [ ] "Skip this step" gate flow advances correctly in all combinations
- [ ] `gated_skip_3` and `gated_skip_4` recorded in `wbtb_sessions.completion_state` for a free account
- [ ] All 3 Step 2 paths (normal, groggy, no recall) produce valid Dream Lab entries
- [ ] Step 7 Morning Sync updates the previous night's row, does not create a new one
- [ ] Protocol survives app background/foreground
- [ ] Morning sync modal appears on open when `pendingSync` is true

---

## PHASE 2 - MONEY (build while beta runs; stays in Stripe test mode until Phase 4)

Do 2.2 and 2.3 before 2.1. Matching and storage have to work or the pricing PR cannot be verified.

| # | Task | Why | Status | PR | Notes |
|---|---|---|---|---|---|
| 2.1 | Pricing and annual plan PR. One PR containing all of: (a) replace all nine `$4.99` strings with `$5.99` across both Terms copies, both Privacy copies, and the upgrade modal; (b) add annual plan legal language: billed $39.99 USD per year, auto-renews annually until cancelled; (c) add a 14-day full-refund window clause for annual subscriptions only, and narrow the existing no-refund language to monthly; (d) update "Last updated" on all four legal docs; (e) bump the legal acceptance version stamp from `2026-07-19` to the ship date, in both places (`app.html` near 15107 and 15746), for **new signups only**; (f) rework the upgrade modal: monthly and annual options, annual pre-selected and highlighted, showing $39.99/yr, the $3.33/mo equivalent, and the 44% saving; (g) `handleUpgradeCTA` opens the correct Payment Link for the selected plan; (h) `APP_VERSION`, `version.json`, `CACHE_NAME` bumps. Do **not** build an in-app re-acceptance prompt. | Decided pricing is $5.99 monthly and $39.99 annual. Existing users cannot be charged the new price without going through Stripe Checkout, which shows the price before they pay. A forced re-accept modal is engineering for a problem five accounts do not have. One PR because the four legal copies and nine price strings must match. | [ ] | | Exact legal copy drafted in chat and approved by Johnny before the prompt is written. Terms copies live near lines 7574 and 20144; the two copies must match exactly. 4 of 5 current profiles have `terms_version` null; leave them. |
| 2.2 | Create the annual price ($39.99/yr) on the premium product in Stripe TEST mode, and a test Payment Link for it. Add `client_reference_id` set to the Supabase user ID to **both** Payment Link URLs in `handleUpgradeCTA`. `prefilled_email` is already present; keep it. | Worker resolve order: metadata `supabase_user_id`/`user_id` → `client_reference_id` → KV `stripe_customer:` → admin email filter. Today the Payment Link only sends email, so a pay-with-different-email charge never upgrades. | [ ] | | Worker needs no changes for annual: `processStripeTierEvent` flips tier regardless of billing interval. `invoice.payment_failed` / `past_due` are intentionally unhandled: the user stays Premium until Stripe cancels. In the Stripe dashboard, Settings → Subscriptions and emails → Manage failed payments, the final action must be **cancel the subscription**, not leave as unpaid. |
| 2.3 | Add `stripe_customer_id`, `stripe_subscription_id`, `subscription_status`, and billing period columns to `profiles` via migration, and have the Worker webhook populate them. | Today `tier` is the only record of who pays. The KV customer map expires in a year. Support, the 14-day refund window, and the portal all need a durable link. | [ ] | | Worker deploy plus a migration. No app version bumps unless `app.html` reads the new columns. |
| 2.4 | Activate the Stripe Customer Portal (test mode) and add a "Manage subscription" button in Settings, shown to premium users only. | Terms currently route cancellation through email. Self-serve cancellation is what people expect. | [ ] | | |
| 2.5 | Test-mode purchase verification: buy monthly with a test card, confirm tier flips to premium; cancel via portal, confirm revert to free at period end; repeat for annual. Confirm `stripe_*` columns populate. | Proves the entire loop before any real money exists. | [ ] | n/a | |

---

## PHASE 3 - MAKE IT FEEL FULL (build while beta runs)

| # | Task | Why | Status | PR | Notes |
|---|---|---|---|---|---|
| 3.1 | Build Academy lessons 04 (Phase I Practice), 05 (Phase II The Interface), and 06 (scope with Johnny: the natural Stage I capstone). Update the landing to show Stage I complete and mark later stages as upcoming. | A complete first stage is the difference between "premium course" and "abandoned demo." The lesson engine, aura engine, and localStorage progress system already exist. Stages II through VI are post-launch. | [ ] | | Lessons 04 and 05 already have ids and titles stubbed in the `LESSONS` array with `built:false`. Lesson copy editing for 01–03 is a separate Johnny chat, not this task. Progress is device-local; cloud sync is parking-lot item 2. |
| 3.4 | RV pool: delete the `T064` pool line from `ablty-worker.js` (do not delete `targets/5490-1738.jpg`; two historical `rv_sessions` rows reference it). Then expand to 80 targets. New entries follow the existing Worker pool format: random 4-4 numeric filenames, non-descriptive, 6 descriptors each, **20 per category**. Integrity check must assert unique ids, unique parsed integers, unique paths, unique **image hashes**, and every referenced file present. | The 2026-08-23 "pool clean at 64" claim was wrong. T042 (`9523-4616.jpg`, Painted Steed) and T064 (`5490-1738.jpg`, Carousel Form) are byte-identical. Live pool is 63 unique images, split 15/19/12/18. Deleting the T064 line is the one-line fix; the replacement carousel target is one of the 17 new images. | [ ] | | Worker deploy plus new images in `targets/`. Historical `rv_sessions` still contain the older T018 / T018b integer collision (one `target_id` with two `target_src` values); leave those rows. |
| 3.5 | Polish batch: empty states for every list and log, plus everything actionable from beta feedback and the 1.5 QA pass. | The gap between "works" and "feels finished" is entirely in these details. Scope this task from real findings, not speculation. | [ ] | | May be several small PRs. |

---

## PHASE 4 - GO LIVE (final week, strict order)

| # | Task | Why | Status | PR | Notes |
|---|---|---|---|---|---|
| 4.1 | Triage and fix launch-blocking beta feedback. Grant one-year premium extensions to testers who completed the exit survey (same corrected SQL pattern). | The point of the beta. Non-blocking feedback goes to the parking lot, not the critical path. | [ ] | | |
| 4.2 | Rebuild `index.html` for launch: replace the waitlist pitch and JOIN THE WAITLIST form with install-now, using the v5 landing brief. Rewrite `llms.txt` in the same PR. Email the existing waitlist (4 people plus any additions) their promised first-user bonus and install link. Describe only features that actually ship. If the Daily Community RV Challenge is not live on launch day, it must not be sold as live. Same for OBE. | The public site currently sells joining a waitlist. `llms.txt` tells AI crawlers ABLTY is pre-launch with a waitlist, and describes the daily community target and OBE training as existing features. | [ ] | | SEO pass can follow post-launch. |
| 4.3 | Upgrade Supabase to Pro and add Cloudflare Workers Paid ($5/mo). | Free-tier ceilings (Supabase pausing, KV write quotas) are fine for beta and fatal with real traffic. Timed last so paid plans are not burning during build weeks. | [ ] | n/a | |
| 4.4 | Stripe LIVE sequence, in order: (a) confirm live product has both prices, $5.99/mo and $39.99/yr; (b) create both live Payment Links; (c) add the live webhook endpoint, copy the signing secret; (d) update Worker secret `STRIPE_WEBHOOK_SECRET` to the live secret; (e) swap both Payment Link URLs in `app.html`, keeping `client_reference_id` and `prefilled_email`; (f) activate the live Customer Portal; (g) bump `APP_VERSION`, `version.json`, `CACHE_NAME`, deploy. | Sequenced so the webhook can receive before any live link exists, and links go into the app last. | [ ] | | |
| 4.5 | Make one real purchase of each plan with a real card. Confirm tier flips and `stripe_*` columns populate. Cancel monthly via the portal, confirm revert. Refund the annual purchase via the Stripe dashboard as a rehearsal of the 14-day window. | The only proof that live mode works is live money. | [ ] | n/a | |
| 4.6 | Final device pass: fresh install on both platforms via the public landing page, guest, signup, purchase path visible, every module opens. Then launch. | Last look through a brand-new user's eyes. | [ ] | n/a | |

---

## POST-LAUNCH PARKING LOT (do not touch before launch)

In recommended order:
1. Daily Community RV Challenge (9 architectural decisions locked) as the Week 1 update. Keep `community_rv_targets` and `public_usernames`; 0.1 just tracks them in the repo.
2. Academy progress cloud sync (today device-local `ablty_academy_progress`; loss on app-delete becomes real once Stage II ships)
3. Academy Stage II onward, releasing stage by stage
4. Signal Scanner as a third psi test. **Do not treat `signal-scanner-prototype.html` as a finished module.** It is a 15-second UI shell: exactly 3 zones, zone positions from `Math.random()`, unused crypto seed, no hit detection, no chance baseline, no lifetime stats, no storage, sync, analytics, export, or delete-account coverage. Needs a scoring spec from Johnny (hit definition, zone count, RNG, baseline, verdicts) before any build.
5. Academy voiceover via ElevenLabs (pre-generated files, never live API). The browser TTS path is being removed in 0.3.
6. Ganzfeld Link paired telepathy protocol
7. Rank-order blind judging rebuild
8. CRV structured session mode
9. Pre-Session Warm-Up integration (Box Breathing plus Pink Noise, v3 spec drafted)
10. Legal acceptance server-side write (move off the client). Not needed for the 2.1 price change.
11. Landing page SEO pass
12. App-wide typography migration (Saira, Saira Condensed, Share Tech Mono)
13. Google Cloud/Firebase cleanup
14. Capacitor native app, Ability Profile, leaderboards, Play Store TWA (Play Store waits for validated web revenue)
15. OBE module (currently teased on the landing page; either build or stop teasing)

---

## DISCOVERED ISSUES

Add new findings here with date found. Move to a phase table only if launch-blocking.

- 2026-08-23: `mapRVSessionRow` still stores `target_id` as a parsed integer. Live data still has the T018 / T018b collision (one integer, two `target_src` values). Pool ids are unique integers after the T064 rename, but the column type is still brittle. Post-launch cleanup candidate.
- 2026-08-23 / confirmed 2026-09-03: `pp_sessions` table retained with 78 rows after Photo Pair removal. Intentional. Worker `userIdTables` must keep deleting it: the FK to `auth.users` is `NO ACTION`, so skipping it would fail account deletion for that user. App UI has no Photo Pair left; only two localStorage purge-list keys remain.
- 2026-09-03: T042 and T064 are the same image. Handled by 3.4.
- 2026-09-03: `confirmDeleteAccount` local purge omits `ablty_rc`, `ablty_rc_streak`, `ablty_rc_sessions`, `ablty_wbtb`, `ablty_wbtb_protocol`, `ablty_wbtb_guest_sessions`, and lists a non-existent `ablty_rc_settings`. Worker delete-account omits `wbtb_sessions` (safe only because that FK is CASCADE). Fold into a polish/delete-account PR, not a side quest.
- 2026-09-03: Supabase advisors: `public_usernames` SECURITY DEFINER (keep, document in 0.1), mutable `search_path` on both profile trigger functions (WARN, fix when touching those functions), leaked-password protection off (enable in the Auth dashboard, no code).
- 2026-09-03: `sw.js` line 1 comment still says "v53" while `CACHE_NAME` is `ablty-v69`. Harmless; fix whenever the cache is bumped.

---

## QUICK REFERENCE

**Repo:** Johnkay22/ABLTY. Deploys by merging to main via Cloudflare Git integration.
**Worker:** `abltygrader` (`abltygrader.kayvideoproductions.workers.dev`; deploys independently of `app.html` and the PWA cache)
**Supabase project:** `ghjajyxcjfqidcmqdzdp`
**Stripe:** TEST mode until task 4.4
**Gemini model:** `gemini-2.5-flash` (grading and dream tagging)
**Email:** Resend, smtp.resend.com:465
**Live app version (2026-09-03):** 2026.08.13.3 / `ablty-v69`

**Tester provisioning SQL (`profiles` has NO email column, must join `auth.users`):**
```sql
update public.profiles p
set tier = 'premium', is_tester = true
from auth.users u
where u.id = p.id and u.email = 'tester@example.com';
```
Then verify:
```sql
select u.email, p.tier, p.is_tester
from auth.users u
join public.profiles p on p.id = u.id
where u.email = 'tester@example.com';
```

**Orphan check (run any time signups look odd):**
```sql
select u.email, u.created_at
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;
```

**Settings-row check:**
```sql
select u.email
from auth.users u
left join public.user_settings s on s.user_id = u.id
where s.user_id is null;
```

**Claude Code session starter:**
"Read LAUNCH-PLAN.md in full before doing anything. It is the only status document. Update it in the same PR as your work."
