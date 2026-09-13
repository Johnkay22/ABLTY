# ABLTY LAUNCH PLAN

**This is the one true pre-launch document. Every other status, handoff, audit, or checklist doc is dead. If another doc disagrees with this one, this one wins.**

**Created:** 2026-08-23, from a live audit of the repo, the deployed Worker, and the Supabase database.
**Rewritten:** 2026-09-03, after a second live audit of `main` (`54ec92f`) plus Johnny's product decisions. The 2026-08-23 claims that were wrong are corrected here, not left as history.
**Status synced:** 2026-09-11, task 0.1 written and opened as [#125](https://github.com/Johnkay22/ABLTY/pull/125), revised three times the same day (view grants + consent ownership; per-account consent storage + the sign-in consent gate; user-bound local account cache). Rollout step 1 is done: `20260911000001` and `20260911000002` are applied live. Not merged; `20260911000003` not applied.
**App version on main:** 2026.09.03.1 / sw cache ablty-v70 (#125 carries 2026.09.11.1 / ablty-v71)
**Status:** Phase 0 in progress. 0.1 is in PR #125 awaiting: merge, confirm 2026.09.11.1 is serving, apply `20260911000003`, device verification. Done: 0.1b (#122), 0.3 (#123). 0.2 is verification-only and can run any time.

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

Launch does not require: Daily Community RV Challenge, Signal Scanner, PK Arena, Academy voiceover, Academy Stages II through VI, Ganzfeld, rank-order judging, CRV structured session mode, the typography migration, Capacitor, or Play Store. Those are post-launch. See the parking lot.

---

## PHASE 0 - FOUNDATION (before any testers)

| # | Task | Why | Status | PR | Notes |
|---|---|---|---|---|---|
| 0.1 | Signup completeness, in one PR: (a) `auth.users` trigger that inserts `public.profiles` and `public.user_settings` with `ON CONFLICT DO NOTHING`; (b) change `onSignedIn` so legal-acceptance fields are written onto an existing profile when they are null (today they are written only inside `if (!profile)`, so a trigger-created row would never get consent); (c) a small RPC/function, callable by anon, that answers only whether a username is taken, and wire the signup form to show "That username is already being used. Try another."; (d) commit the live-but-untracked schema into `supabase/migrations` (`is_tester`, `community_rv_targets`, `public_usernames` view, and the three early migrations missing from the folder). No orphan backfill. | Profiles are created client-side today. Interrupted signups leave auth accounts with no profile. The username-taken check currently queries `profiles` as anon against an own-row SELECT policy, so it always returns empty and every name looks free. Collisions only surface later as `seeker_xxxx`. A trigger without the legal-write change silently drops consent recording. The repo migrations folder is not a full record of the live database; `community_rv_targets` and `public_usernames` must be tracked because the Daily Community RV Challenge is coming. | [ ] | [#125](https://github.com/Johnkay22/ABLTY/pull/125) | Written 2026-09-11, tested on a local PostgreSQL 17.5 replica of the relevant live schema (45 SQL assertions) plus 61 Node tests running the real `onSignedIn`/`hydrateProfileFromSession`/`handleSignup`/Google callback/consent gate against a mock client; not merged, not device-verified. Live re-check 2026-09-11: still 5 users / 5 profiles / 5 settings / 0 orphans, so no backfill. Revision 2 (same day): `public_usernames` write grants revoked in `20260911000001`; consent removed from localStorage only after a confirmed write. Revision 3 (same day): consent storage split into an unsubmitted draft (`ablty_pending_legal_acceptance`, signup form only) and a per-account record (`ablty_legal_acceptance_pending:<userId>`) that only that user id can consume; plus a **sign-in consent gate** so no account with null `terms_accepted_at`/`privacy_accepted_at` enters the app (needed because Google `signInWithIdToken` creates accounts with no Terms step). Revision 4 (same day): the local username/tier/`username_changed_at` cache is bound to the Supabase user id (`ablty_cache_user_id`); when the profile is temporarily unreadable and the offline verification lets the user in, their own cached state is kept instead of being overwritten with Seeker/free, and another user id never sees it. The database profile still wins whenever it loads. **Rollout status:** step (1) DONE 2026-09-11: `20260911000001` applied live as version `20260911224746` and `20260911000002` as `20260911224850` (Supabase `apply_migration` assigns its own version stamp; the file names stay as they are in the repo). Verified live: anon/authenticated SELECT on `public_usernames` still works, INSERT/UPDATE/DELETE denied (42501), `username_is_taken` true/false correct via SQL and via the REST RPC with the anon key. **Do not edit those two files again; any further database change is a new migration.** Remaining: (2) merge #125 and confirm app 2026.09.11.1 is serving; (3) `20260911000003` (auth trigger) last, because the old `onSignedIn` skips the consent write when a profile already exists. Expect the 4 existing profiles with null consent (including Johnny's and the testers') to see the acceptance screen once on their next sign-in or app open after 2026.09.11.1 ships. Do NOT re-apply the four record-only files (`20260322070144`, `20260406073925`, `20260422061145`, `20260815131016`); their versions are already in the live history. Availability check is exact-match, case-sensitive, matching the live `UNIQUE (username)` constraint (see DISCOVERED ISSUES). Trigger fallback is `seeker_` + first 8 alphanumerics of the user id, identical to the client's `fallbackUsername`. Trigger rollback: `DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;`. `public_usernames` SECURITY DEFINER intent is documented in `20260911000001`. Check `[x]` only after the trigger is live and a real signup on a phone shows profile + settings + consent recorded. |
| 0.1b | Point `CLAUDE.md` at this file. Rename `LAUNCH-PLAN-3.md` → `LAUNCH-PLAN.md`. Strip stale `robots.txt` disallows for docs that were already deleted. | Claude Code reads `CLAUDE.md` automatically. The six superseded docs were already deleted from the repo; the pointer and the filename were the remaining work. | [x] | [#122](https://github.com/Johnkay22/ABLTY/pull/122) | Merged 2026-09-04. |
| 0.2 | Verify the password reset loop on a real phone: request, receive email via Resend, tap link, modal opens, set new password, sign in with it. | Code exists (`resetPasswordForEmail` → `/app.html`, `PASSWORD_RECOVERY` opens the change-password modal) but has never been verified end to end. If broken, locked-out users leave. Verification only, no code unless it fails. | [ ] | n/a | |
| 0.3 | Remove the Academy "VOICE ON/OFF" toggle and all browser `speechSynthesis` narration. Keep lesson copy and Web Audio tones/haptics. Three version bumps. | The toggle promised produced narration and drove the phone's built-in TTS. Stage I ships silent at launch; ElevenLabs voiceover is post-launch. | [x] | [#123](https://github.com/Johnkay22/ABLTY/pull/123) | Merged 2026-09-04. Toggle, TTS, and `ablty_academy_voice` are gone. `speak`/`hush` remain no-ops. Version `2026.09.03.1` / `ablty-v70`. Not device-verified (headless Chrome only). |

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
| 2.1 | Pricing and annual plan PR. One PR containing all of: (a) replace all nine `$4.99` strings with `$5.99` across both Terms copies, both Privacy copies, and the upgrade modal; (b) add annual plan legal language: billed $39.99 USD per year, auto-renews annually until cancelled; (c) add a 14-day full-refund window clause for annual subscriptions only, and narrow the existing no-refund language to monthly; (d) update "Last updated" on all four legal docs; (e) bump the legal acceptance version stamp from `2026-07-19` to the ship date, now in one place (`LEGAL_VERSION` in `app.html`, since #125; note it also keys the offline verification cache, so bumping it makes every device re-verify against the database once while online), for **new signups only**; (f) rework the upgrade modal: monthly and annual options, annual pre-selected and highlighted, showing $39.99/yr, the $3.33/mo equivalent, and the 44% saving; (g) `handleUpgradeCTA` opens the correct Payment Link for the selected plan; (h) `APP_VERSION`, `version.json`, `CACHE_NAME` bumps. Do **not** build an in-app re-acceptance prompt. | Decided pricing is $5.99 monthly and $39.99 annual. Existing users cannot be charged the new price without going through Stripe Checkout, which shows the price before they pay. A forced re-accept modal is engineering for a problem five accounts do not have. One PR because the four legal copies and nine price strings must match. | [ ] | | Exact legal copy drafted in chat and approved by Johnny before the prompt is written. Terms copies live near lines 7574 and 20144; the two copies must match exactly. 4 of 5 current profiles have `terms_version` null; the 0.1 consent gate (#125) asks those accounts to accept once at their next sign-in, so by the time 2.1 ships they will carry the `2026-07-19` stamp. The gate only fires on **null** acceptance, never on a version mismatch, so (e) still does not re-prompt anyone. |
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
5. PK Arena. Standalone prototype at `pk-arena-prototype.html` (Cascade, Drift, Emerge), merged in [#121](https://github.com/Johnkay22/ABLTY/pull/121). Zero references in `app.html`. Same class of work as Signal Scanner: do not treat the prototype as a shippable module. Johnny has not scoped it for launch.
6. Academy voiceover via ElevenLabs (pre-generated files, never live API). Browser TTS was removed in 0.3 (#123).
7. Ganzfeld Link paired telepathy protocol
8. Rank-order blind judging rebuild
9. CRV structured session mode
10. Pre-Session Warm-Up integration (Box Breathing plus Pink Noise, v3 spec drafted)
11. Legal acceptance server-side write (move off the client). Not needed for the 2.1 price change.
12. Landing page SEO pass
13. App-wide typography migration (Saira, Saira Condensed, Share Tech Mono)
14. Google Cloud/Firebase cleanup
15. Capacitor native app, Ability Profile, leaderboards, Play Store TWA (Play Store waits for validated web revenue)
16. OBE module (currently teased on the landing page; either build or stop teasing)

---

## DISCOVERED ISSUES

Add new findings here with date found. Move to a phase table only if launch-blocking.

- 2026-08-23: `mapRVSessionRow` still stores `target_id` as a parsed integer. Live data still has the T018 / T018b collision (one integer, two `target_src` values). Pool ids are unique integers after the T064 rename, but the column type is still brittle. Post-launch cleanup candidate.
- 2026-08-23 / confirmed 2026-09-03: `pp_sessions` table retained with 78 rows after Photo Pair removal. Intentional. Worker `userIdTables` must keep deleting it: the FK to `auth.users` is `NO ACTION`, so skipping it would fail account deletion for that user. App UI has no Photo Pair left; only two localStorage purge-list keys remain.
- 2026-09-03: T042 and T064 are the same image. Handled by 3.4.
- 2026-09-03: `confirmDeleteAccount` local purge omits `ablty_rc`, `ablty_rc_streak`, `ablty_rc_sessions`, `ablty_wbtb`, `ablty_wbtb_protocol`, `ablty_wbtb_guest_sessions`, and lists a non-existent `ablty_rc_settings`. Worker delete-account omits `wbtb_sessions` (safe only because that FK is CASCADE). Fold into a polish/delete-account PR, not a side quest.
- 2026-09-03: Supabase advisors: `public_usernames` SECURITY DEFINER (keep, document in 0.1), mutable `search_path` on both profile trigger functions (WARN, fix when touching those functions), leaked-password protection off (enable in the Auth dashboard, no code).
- 2026-09-03: `sw.js` line 1 comment still said "v53" while `CACHE_NAME` was `ablty-v69`. Fixed in #123 (`ablty-v70`).
- 2026-09-11: `public_usernames` was writable by client roles (Supabase default grants on a plain, auto-updatable view owned by a BYPASSRLS role, so writes reached `profiles` past its own-row RLS). **Fixed in #125**: `20260911000001` revokes INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER from `anon` and `authenticated`, keeps SELECT. **Live since 2026-09-11** (applied as version `20260911224746`, verified with SQL as `anon`/`authenticated`). A read-only audit of every view in the live database on 2026-09-11 found it was the only view with any `anon`/`authenticated` grants; `extensions.pg_stat_statements*` are not updatable and `vault.decrypted_secrets` is not granted to client roles.
- 2026-09-11: Username uniqueness is **case-sensitive** (`UNIQUE (username)`, so `Johnny` and `johnny` are two accounts). The 0.1 availability RPC mirrors that exactly so check and constraint never disagree. 0 case-collisions among live profiles today. Decide before leaderboards ship whether this should be case-insensitive; if so, add a unique index on `lower(username)` and change the RPC predicate in the same migration, never one without the other.
- 2026-09-11: Consent recording is still device-bound. `ablty_pending_legal_acceptance` lives in localStorage, so a user who signs up on one device and taps the confirmation email on another gets a profile (trigger) but no `terms_accepted_at`. Pre-existing behavior, not introduced by 0.1; parking lot item 11 (server-side legal write) is the fix. Since #125 the cross-device case is no longer a silent gap: the account lands in the consent gate on the other device and accepts there, so the profile still ends up with a recorded acceptance (dated to that moment rather than the original tick). #125 client-side hardening: the unsubmitted tick is a draft that only the signup form touches; once an account exists the acceptance moves to `ablty_legal_acceptance_pending:<userId>`, is written only by a sign-in of that exact user id, and is removed only after a confirmed write (failed writes retry on every sign-in, session restore, and token refresh). Opening the signup screen, unticking the box, or another account signing up on the same device can neither delete nor inherit it. Ownerless records from older app versions are discarded with a console warning, never written.
- 2026-09-11: **Google sign-in created accounts with no Terms acceptance** (launch-blocking, fixed in #125). Supabase `signInWithIdToken` signs in an existing user or creates a new one; the Google buttons on the login screen and onboarding have no Terms checkbox, and live data showed a Google-only account with null consent. Fix: a consent gate (`ensureLegalConsent` in `app.html`) runs inside `onSignedIn` and `hydrateProfileFromSession` before the signed-in experience and before any guest-data merge. Profile legal fields are the source of truth after auth. Null fields → one-time acceptance screen (`#screen-legal-gate`, styled like the auth screens, links open the existing legal modal); the write is read back before the user is let in. Profile unreadable (offline) → allowed only if `ablty_legal_verified` matches this exact user id and `LEGAL_VERSION`, otherwise a connection-required screen with Try Again and Sign out. The gate is raised synchronously at boot (`preflightLegalGate`, reads the stored Supabase session) so the home screen is never shown first. Side effect on first launch after 2026.09.11.1: every signed-in device re-verifies against the database once; a device that is offline at that exact moment sees the connection screen until it is online. Accounts with a valid acceptance are never asked again. The password-reset prompt (`PASSWORD_RECOVERY`) is queued behind the gate: it opens once, only after the account has actually entered, and is cancelled by signing out (Codex P1 on #125, fixed same PR).
- 2026-09-11: The repo copy of `enforce_profiles_tier_lock()` in `20260519000003` is superseded live by `20260815131016` (also locks `is_tester`), now tracked. Both profile trigger functions still have the mutable `search_path` advisor WARN; fix when they are next changed for real. Table creation for `profiles`, `user_settings`, `rv_sessions`, `zener_runs`, `ts_trials`, and `pp_sessions` predates the migration history and remains untracked; not required by 0.1.

---

## QUICK REFERENCE

**Repo:** Johnkay22/ABLTY. Deploys by merging to main via Cloudflare Git integration.
**Worker:** `abltygrader` (`abltygrader.kayvideoproductions.workers.dev`; deploys independently of `app.html` and the PWA cache)
**Supabase project:** `ghjajyxcjfqidcmqdzdp`
**Stripe:** TEST mode until task 4.4
**Gemini model:** `gemini-2.5-flash` (grading and dream tagging)
**Email:** Resend, smtp.resend.com:465
**Live app version (2026-09-11, repo `main`):** 2026.09.03.1 / `ablty-v70`. #125 (unmerged) carries 2026.09.11.1 / `ablty-v71`.
**Username availability RPC (live since 2026-09-11):** `select public.username_is_taken('name');` exact, case-sensitive, anon-callable.
**Local account cache:** `ablty_username`/`ablty_tier`/`ablty_username_changed_at` are bound to `ablty_cache_user_id`; reused offline only for that user id, overwritten whenever the profile loads.
**Consent gate localStorage keys:** `ablty_pending_legal_acceptance` (unsubmitted signup draft), `ablty_legal_acceptance_pending:<userId>` (bound, awaiting confirmed write), `ablty_legal_verified` (`{userId, version}` offline cache). Legal version stamp: `LEGAL_VERSION` in `app.html`.

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
