# ABLTY LAUNCH PLAN

**This is the one true pre-launch document. Every other status, handoff, audit, or checklist doc is dead. If another doc disagrees with this one, this one wins.**

**Created:** 2026-08-23, from a live audit of the repo, the deployed Worker, and the Supabase database. Not from any prior doc.
**App version at creation:** 2026.08.13.3 / sw cache ablty-v69
**Status:** Phase 0 not started.

---

## HOW TO USE THIS FILE

- Claude Code: read this entire file before doing anything, every session. Update it as the final step of every task, in the same PR as the work.
- A task is done only when it is **merged and verified on device**. Written does not equal run. Run does not equal merged. Merged does not equal verified.
- Check the box, fill in the PR number, add a one-line note if anything surprising happened.
- If a task surfaces a new problem, add it to the DISCOVERED ISSUES section at the bottom. Do not start a side quest.
- One PR per task unless a task explicitly says otherwise. Every task starts on a fresh branch off updated main. Claude Code opens PRs and never merges them.
- Worker-only changes (ablty-worker.js) deploy independently and do not require bumps to APP_VERSION, version.json, or CACHE_NAME. Anything touching app.html that users must receive requires all three bumps.

---

## DEFINITION OF LAUNCH READY

The app is launch ready when all of the following are true:

1. **Nothing silently breaks.** Signups always create complete accounts, password reset works, payments always land on the right account, and a full device QA pass is clean on iPhone and Android.
2. **Money works end to end.** Both plans purchasable live, correct pricing everywhere including all four legal copies, self-serve cancellation, a real purchase and cancellation verified with a real card.
3. **It feels full, not beta.** Three psi test modules (Zener, Presentiment, Signal Scanner), a complete Academy Stage I with voiceover, an 80-target RV pool, Dream Lab with enough reading content to last, and no screen that promises something that does not exist.
4. **The front door matches reality.** The landing page sells installing a live app, not joining a waitlist.

Launch does not require: Community RV Challenge, Ganzfeld, rank-order judging, CRV structured session mode, the typography migration, Capacitor, Play Store, or Academy Stages II through VI. Those are post-launch. See the parking lot.

---

## PHASE 0 - FOUNDATION (before any testers)

| # | Task | Why | Status | PR | Notes |
|---|---|---|---|---|---|
| 0.1 | Add a Supabase trigger on auth.users that auto-creates a public.profiles row (and a user_settings row if the app expects one) on signup. Backfill the 2 existing orphaned users: coryy418@gmail.com and gogogonzoflow@gmail.com. Use apply_migration, not raw SQL, so it is tracked. | Profiles are created client-side today. Interrupted signups leave auth accounts with no profile: no tier, no settings, half-broken app. 2 of 7 real users are already orphaned. With testers arriving, this is the top blocker. Also: tester provisioning SQL silently updates zero rows for orphaned users. | [ ] | | Trigger must be idempotent (on conflict do nothing) so backfill plus trigger cannot double-insert. |
| 0.1b | Add one line to CLAUDE.md pointing at LAUNCH-PLAN.md as the only status document, to be read in full at the start of every session. Delete the 6 superseded docs listed at the bottom of this file in the same PR. | Claude Code reads CLAUDE.md automatically. Without the pointer it will not know this file exists unless Johnny says so every time. Deleting the old docs in the same commit removes any chance of a future session acting on stale status. | [ ] | | Trivial PR, can ride along with 0.1 if convenient. |
| 0.2 | Verify the password reset loop on a real phone: request, receive email via Resend, tap link, modal opens, set new password, sign in with it. | Never verified end to end. If broken, locked-out users are permanently lost and will not email support, they will just leave. Verification only, no code unless it fails. | [ ] | n/a | |

---

## PHASE 1 - BETA (target: start within days of Phase 0, run about 2 weeks)

| # | Task | Why | Status | PR | Notes |
|---|---|---|---|---|---|
| 1.1 | Reframe the Academy landing copy. Remove the "27 LESSONS" and "6 STAGES" tags. Present Stage I as the current training track and later stages as in the pipeline. Keep the declassified-method framing. | The screen promises 27 lessons and 3 exist. Testers hit the wall in minutes and it reads as abandoned. Promise only what is real. Copy-only change plus version bumps. | [ ] | | After Phase 3.1 ships lessons 04-06, update this copy again to "Stage I complete." |
| 1.2 | Verify earlybetaaccess.html on a real iPhone and Android: animated logo, correct per-device install instructions, QR on desktop, the "Already installed? Open ABLTY" link. Confirm any in-app or off-app link that is supposed to point testers at this page actually does. | The page is deployed, noindexed, and linked from nowhere. Testers arrive through it. It has never been device-verified. | [ ] | n/a | |
| 1.3 | Provision each tester in Supabase using the corrected SQL in the QUICK REFERENCE section, after they have signed up. Then confirm each row updated (query it back). | profiles has no email column. The old provisioning SQL errors. The corrected version joins through auth.users. Confirming the update catches orphaned signups that 0.1 should now prevent. | [ ] | n/a | Two weeks unlimited premium. One-year extension on exit survey completion. |
| 1.4 | Seed lucidity_readings with 10 or more original pieces spanning mild, biology, and reality-check categories. Draft the content in chat with Johnny first, then insert via SQL. No app deploy needed. | The table has 3 placeholder rows. Premium WBTB users run out of reading content on night four, which is exactly the "feels empty" failure. | [ ] | n/a | |
| 1.5 | Full device QA pass on iPhone and Android: guest, free, and premium accounts, offline behavior, the service worker update path, and abuse checks (daily limits, gated features). Include the WBTB checklist below. | The only way to find what real users will find. Everything later builds on this being clean. | [ ] | n/a | Log every finding in DISCOVERED ISSUES, fix in separate PRs. |

**WBTB QA sub-checklist (part of 1.5):**
- [ ] Step 3 (RC Drill) hidden for free, shown for premium
- [ ] Step 4 (Lucidity Reading) hidden for free, shown for premium
- [ ] "Skip this step" gate flow advances correctly in all combinations
- [ ] gated_skip_3 and gated_skip_4 recorded in wbtb_sessions.completion_state for a free account
- [ ] All 3 Step 2 paths (normal, groggy, no recall) produce valid Dream Lab entries
- [ ] Step 7 Morning Sync updates the previous night's row, does not create a new one
- [ ] Protocol survives app background/foreground
- [ ] Morning sync modal appears on open when pendingSync is true

---

## PHASE 2 - MONEY (build while beta runs; stays in Stripe test mode until Phase 4)

| # | Task | Why | Status | PR | Notes |
|---|---|---|---|---|---|
| 2.1 | Pricing and annual plan PR. One PR containing all of: (a) replace all nine $4.99 strings with $5.99 across both Terms copies, both Privacy copies, and the upgrade modal; (b) add annual plan legal language: billed $39.99 USD per year, auto-renews annually until cancelled; (c) add a 14-day full-refund window clause for annual subscriptions only, and narrow the existing no-refund language to monthly; (d) update "Last updated" on all four legal docs; (e) bump the legal acceptance version stamp from 2026-07-19 to the ship date, in both places (app.html lines near 15107 and 15746 at time of writing); (f) rework the upgrade modal: monthly and annual options, annual pre-selected and highlighted, showing $39.99/yr, the $3.33/mo equivalent, and the 44% saving; (g) handleUpgradeCTA opens the correct Payment Link for the selected plan; (h) APP_VERSION, version.json, CACHE_NAME bumps. | Decided pricing is $5.99 monthly and $39.99 annual. Terms are a contract: a price mismatch with Stripe is free ammunition for chargebacks. The refund window exists because a no-refund annual plan generates bank disputes instead of support emails, and Stripe disputes threaten the whole account at low volume. Annual is pre-selected because churn, not conversion, kills $6 subscriptions. One PR because splitting forces two legal version bumps and two acceptance re-prompts. | [ ] | | Exact legal copy drafted in chat and approved by Johnny before the Claude Code prompt is written. Terms copies live near lines 7574 and 20144; the two copies must match exactly. |
| 2.2 | Create the annual price ($39.99/yr) on the premium product in Stripe TEST mode, and a test Payment Link for it. Add client_reference_id set to the Supabase user ID, plus prefilled_email, to BOTH Payment Link URLs in handleUpgradeCTA. | The Worker resolves payments by client_reference_id first, then a KV customer map, then email. Today only the email fallback works, which fails whenever someone pays with a different email than they signed up with: charged but never upgraded. client_reference_id makes matching deterministic. | [ ] | | Worker needs no changes for annual: processStripeTierEvent flips tier on subscription events regardless of billing interval. Verified 2026-08-23. |
| 2.3 | Add stripe_customer_id, stripe_subscription_id, subscription_status, and billing period columns to profiles via migration, and have the Worker webhook populate them. | Today tier is the only record of who pays. Support questions, refunds within the 14-day window, and any future billing UI all need to know which Stripe customer a profile is. Retrofitting after real customers exist is far messier. | [ ] | | Worker-only deploy plus a migration. No app version bumps needed unless app.html reads the new columns. |
| 2.4 | Activate the Stripe Customer Portal (test mode) and add a "Manage subscription" button in Settings, shown to premium users only. | Terms currently route cancellation through email. Self-serve cancellation means fewer support emails, fewer disputes, and it is what people expect from a real product. | [ ] | | |
| 2.5 | Test-mode purchase verification: buy monthly with a test card, confirm tier flips to premium; cancel via portal, confirm revert to free at period end; repeat for annual. Confirm stripe_* columns populate. | Proves the entire loop before any real money exists. Every payment bug found here is free. | [ ] | n/a | |

---

## PHASE 3 - MAKE IT FEEL FULL (build while beta runs)

| # | Task | Why | Status | PR | Notes |
|---|---|---|---|---|---|
| 3.1 | Build Academy lessons 04 (Phase I Practice), 05 (Phase II The Interface), and 06 (scope with Johnny: the natural Stage I capstone). Update the landing to show Stage I complete and mark later stages as upcoming. | A complete first stage is the difference between "premium course" and "abandoned demo." The lesson engine, aura engine, and progress system already exist, so this is content build, not architecture. Stages II through VI are explicitly post-launch. | [ ] | | Lessons 04 and 05 already have ids and titles stubbed in the LESSONS array with built:false. |
| 3.2 | Academy voiceover: generate the produced 31-file script through ElevenLabs (female voice, neutral American accent, low pitch, deliberate pacing, close-mic), name files rv-001.mp3 through rv-038.mp3, add them under audio/rv/, and wire playback into the lessons. | Narration is the single biggest perceived-production-value upgrade available. The script already exists; this is generation and wiring. Pre-generated files, never live API: key exposure, per-playback cost, latency, and offline breakage ruled that out. | [ ] | | The repo has no audio directory yet. Cache strategy decision needed: audio files are large, consider network-first or on-demand caching rather than precache. |
| 3.3 | Integrate Signal Scanner into app.html as the third psi test. Preserve the prototype scoring exactly: Poisson-binomial weighted lifetime test, 2 to 4 crypto-random target zones chosen post-lock, session hit count pre-baseline, lifetime rate vs chance with significance-gated verdicts post-baseline. | Verified 2026-08-23: Signal Scanner appears zero times in app.html. A finished, statistically sound module is sitting unused in signal-scanner-prototype.html. Integrating it grows the psi area to three tests, the cheapest large "more to do" win in the codebase. | [ ] | | Prototype merged standalone in PRs 102 and 103. |
| 3.4 | Expand the RV target pool to 80 targets. New entries follow the existing Worker pool format: random 4-4 numeric filenames, non-descriptive, balanced across the four categories, 6 descriptors each. Verify every new id parses to a unique integer and every referenced file exists in targets/. | 64 targets is thin for daily premium use: repeats surface fast and repeats are deadly for blind protocol credibility. 80 clears the recommended floor. Pool integrity was verified clean at 64 on 2026-08-23; keep it that way. | [ ] | | Worker-only deploy plus new images in targets/. Also verify the carousel horse duplication issue from the old tracker while in here. |
| 3.5 | Polish batch: empty states for every list and log, plus everything actionable from beta feedback and the 1.5 QA pass. | The gap between "works" and "feels finished" is entirely in these details. Scope this task from real findings, not speculation. | [ ] | | May be several small PRs. |

---

## PHASE 4 - GO LIVE (final week, strict order)

| # | Task | Why | Status | PR | Notes |
|---|---|---|---|---|---|
| 4.1 | Triage and fix launch-blocking beta feedback. Grant one-year premium extensions to testers who completed the exit survey (same corrected SQL pattern). | The point of the beta. Non-blocking feedback goes to the parking lot, not the critical path. | [ ] | | |
| 4.2 | Rebuild index.html for launch: replace the waitlist pitch and JOIN THE WAITLIST form with install-now, using the v5 landing brief. Rewrite llms.txt in the same PR. Email the existing waitlist (4 people plus any additions) their promised first-user bonus and install link. | The public site currently sells joining a waitlist for an app that will be live, which is an instant credibility hit. llms.txt has the same problem and worse: it tells AI crawlers ABLTY is pre-launch with a waitlist, and describes the daily community target and OBE training as existing features when neither ships at launch. That is what LLMs will repeat about the product. The waitlist made a bonus promise; honoring it is cheap and breaking it is not. Also reconcile the landing page's OBE-in-development claim with reality. | [ ] | | SEO pass can follow post-launch. |
| 4.3 | Upgrade Supabase to Pro and add Cloudflare Workers Paid ($5/mo). | Free-tier ceilings (Supabase pausing, KV write quotas) are fine for beta and fatal with real traffic. Timed last so paid plans are not burning during build weeks. | [ ] | n/a | |
| 4.4 | Stripe LIVE sequence, in order: (a) confirm live product has both prices, $5.99/mo and $39.99/yr; (b) create both live Payment Links; (c) add the live webhook endpoint, copy the signing secret; (d) update Worker secret STRIPE_WEBHOOK_SECRET to the live secret; (e) swap both Payment Link URLs in app.html, keeping client_reference_id and prefilled_email; (f) activate the live Customer Portal; (g) bump APP_VERSION, version.json, CACHE_NAME, deploy. | The exact live cutover. Sequenced so the webhook can receive before any live link exists, and links go into the app last. | [ ] | | |
| 4.5 | Make one real purchase of each plan with a real card. Confirm tier flips and stripe_* columns populate. Cancel monthly via the portal, confirm revert. Refund the annual purchase via the Stripe dashboard as a rehearsal of the 14-day window. | The only proof that live mode works is live money. The annual refund doubles as a dry run of the exact support action the refund clause commits to. | [ ] | n/a | |
| 4.6 | Final device pass: fresh install on both platforms via the public landing page, guest, signup, purchase path visible, every module opens. Then launch. | Last look through a brand-new user's eyes, entering the same way they will. | [ ] | n/a | |

---

## POST-LAUNCH PARKING LOT (do not touch before launch)

In recommended order:
1. Daily Community RV Challenge (9 architectural decisions locked) as the Week 1 update
2. Academy Stage II onward, releasing stage by stage
3. Ganzfeld Link paired telepathy protocol
4. Rank-order blind judging rebuild
5. CRV structured session mode
6. Pre-Session Warm-Up integration (Box Breathing plus Pink Noise, v3 spec drafted)
7. Legal acceptance server-side write (move off the client)
8. Landing page SEO pass
9. App-wide typography migration (Saira, Saira Condensed, Share Tech Mono)
10. Google Cloud/Firebase cleanup
11. Capacitor native app, Ability Profile, leaderboards, Play Store TWA (Play Store waits for validated web revenue)
12. OBE module (currently teased on the landing page; either build or stop teasing)

---

## DISCOVERED ISSUES

Add new findings here with date found. Move to a phase table only if launch-blocking.

- 2026-08-23: mapRVSessionRow still stores target_id as a parsed integer. Harmless now that all pool ids are unique integers (verified), but brittle if id formats ever change. Post-launch cleanup candidate.
- 2026-08-23: pp_sessions table retained with 78 rows after Photo Pair removal. Intentional, keep for delete-account coverage.

---

## QUICK REFERENCE

**Repo:** Johnkay22/ABLTY. Deploys by merging to main via Cloudflare Git integration.
**Worker:** abltygrader (deploys independently of app.html and the PWA cache)
**Supabase project:** ghjajyxcjfqidcmqdzdp
**Stripe:** TEST mode until task 4.4
**Gemini model:** gemini-2.5-flash (grading and dream tagging)
**Email:** Resend, smtp.resend.com:465

**Tester provisioning SQL (profiles has NO email column, must join auth.users):**
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

**Claude Code session starter:**
"Read LAUNCH-PLAN.md in full before doing anything. It is the only status document. Update it in the same PR as your work."

**Docs superseded by this file, delete from the repo:** LAUNCH-STATUS.markdown, CLAUDE_HANDOFF.md, CURRENT_STATE_BASELINE.md, LAUNCH_READINESS_AUDIT.txt, KNOWN_ISSUES.md, MOBILE_QA_CHECKLIST.md (its content lives in 1.5 above). Also replace the stale copies uploaded to the Claude Project (LAUNCH-STATUS.md, 1-ABLTY-MASTER-LAUNCH-TODO.md, 3-ABLTY-AI-HANDOFF.md) with this file.
