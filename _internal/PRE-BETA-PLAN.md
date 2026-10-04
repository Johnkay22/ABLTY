# ABLTY PRE-BETA PLAN

**Owner:** Johnny (founder, non-technical). **Written:** 2026-10-03 (Chicago) by Claude, from the October 3 read-only audit of `main` at `8d2efb8` (app version `2026.10.01.1`, cache `ablty-v81`) plus Johnny's decisions in the same conversation.

**Goal:** get ABLTY safe and useful enough to hand to about 20 private beta testers, who get free Premium for 30 days with no credit card and no Stripe.

**Where this file lives and why:** it sits in the `_internal/` folder because the website (GitHub Pages) never publishes folders whose names start with an underscore. The repository itself is public on GitHub, so nothing in this folder may describe how to exploit a problem that is still open. Describe what to fix and what "done" looks like, never how to abuse it.

---

## HOW TO USE THIS FILE

### For Johnny

- The **Status board** below shows every step and where it stands. Read it top to bottom.
- To start work in Cursor, open a new chat and type: **"Do the next step in `_internal/PRE-BETA-PLAN.md`."** Cursor will read this file, look at the code, report what it found, and stop before changing anything.
- Every step ends as a **draft pull request** that you review and merge yourself. Nothing reaches the live app until you merge.
- Steps marked **YOU DECIDE** need an answer from you before the AI builds them. Steps marked **YOU TEST** need your phone.
- `_internal/WORK-LOG.md` is the diary: one short entry per work session, newest at the top, saying what was done and what is left.

### For the AI doing the work (Cursor, Claude Code, or anyone else)

1. Read `CLAUDE.md`, the top of `LAUNCH-PLAN.md`, this whole file, and the latest entries in `_internal/WORK-LOG.md` before doing anything.
2. Work on **one step only**: the first step on the Status board that is not done, unless Johnny names a different one. Do not combine steps.
3. **Audit first.** Read the live code the step touches, confirm the problem still exists exactly as described, and report back in plain English before editing. If the code no longer matches this plan, stop and say so. Line numbers in this file come from `8d2efb8` and will drift, so search by function name.
4. Make the change on a new branch, add or update tests, and open a **draft** pull request. Never merge. Never push to `main`.
5. **Never touch production.** Do not run migrations against the live Supabase project, change Cloudflare, Stripe, Google or Resend settings, read or print secrets, or send emails. New database changes go in a new migration file in `supabase/migrations/`; Johnny approves it and Claude applies it to production separately with its Supabase tools.
6. In the same pull request: update this step's row on the Status board, and add an entry at the top of `_internal/WORK-LOG.md` (template is in that file).
7. App changes (anything in `app.html`, `sw.js`, `earlybetaaccess.html`, `index.html`) must bump `APP_VERSION` in `app.html`, `version` in `version.json` and `CACHE_NAME` in `sw.js` together. Worker-only changes (`ablty-worker.js`) and docs-only changes do not.
8. Report test results honestly: **passed**, **failed**, or **not run**, and say why something was not run. Source review and mocked tests are not phone evidence.
9. Write for Johnny: plain English, no jargon without a one-line explanation, and no em dashes anywhere (code comments, copy, docs, pull request text).

### What "done" means

A step moves through: **Not started → In progress → PR open (#number) → Merged → Verified**. "Verified" means it was checked on the live app (and on a phone where the step says so). Written is not merged, and merged is not verified.

---

## STATUS BOARD

| # | Step | Type | Needs Johnny | Status |
|---|---|---|---|---|
| 0 | Planning files (this file, work log, Cursor rules) | Docs only | Merge | PR open |
| 1 | Stop the website publishing internal documents | Site config | Merge | Not started |
| 2 | Fix the beta install links | App | Merge, YOU TEST | Not started |
| 3 | Show user and AI text safely | App | Merge | Not started |
| 4 | Keep dream saves in the right account | App | Merge | Not started |
| 5 | Honest "saved to cloud" status | App | Merge | Not started |
| 6 | Lock Premium so only the server can grant it | Database | Approve migration | Not started |
| 7 | Turn off the test-mode upgrade checkout for the beta | App | Merge | Not started |
| 8 | Beta codes, automatic expiry and expiry banner | Database + App + Worker | Approve migration, choose codes | Not started |
| 9 | Grading upgrade: show the AI the target photo, newer model | Worker only | Review score comparison | Not started |
| 10 | Activity log (what testers do, never what they write) | Database + App | Approve migration | Not started |
| 11 | In-app feedback box | Database + App | Approve migration | Not started |
| 12 | Privacy policy and Terms wording | App (legal copy) | YOU DECIDE, approve text | Not started |
| 13 | Admin dashboard with export | Database + new page | Approve migration, set up 2-step login | Not started |
| 14 | Release check and 2 to 3 person phone pilot | Testing | YOU TEST | Not started |
| 15 | Invite the remaining testers | Launch | Send invites | Not started |
| 16 | Week 2: write the survey | Copy + App + Database | Approve questions | After beta starts |
| 17 | Day 21: survey goes live with the extra-month reward | App | Turn on | After beta starts |

**Order matters.** Steps 1 to 5 are small and independent. Step 6 must merge and be applied to production before step 8, because a beta code system is pointless if Premium can be obtained any other way. Step 12 comes after 9, 10 and 11 because those steps change what the privacy policy has to say.

---

## DECISIONS ALREADY MADE (do not reopen these)

- **No Stripe for the beta.** Testers get Premium for free through beta codes. Stripe work (audit prompts 09 to 13) waits until after the beta.
- **One shared code per recruiting source**, not a unique code per person. Example: one code for friends, one for a forum post. Each code has a use limit, a redeem-by date, and works once per account.
- **30 days of Premium from the moment each tester redeems**, ending automatically. Nobody has to remember to turn it off.
- **Beta Premium is stored separately from paid Premium**, so beta expiry can never cancel a real subscription later.
- **Gemini stays the AI provider.** Billing is on (paid tier), so Google does not use ABLTY's requests to improve its products. Dream tagging stays on.
- **No outside analytics or screen-recording tools.** Dreams, sketches and notes appear on screen, and recording them would break ABLTY's privacy promises.
- **The survey is written in week 2**, after looking at what testers actually did, and goes out around day 21.
- **Credibility rules apply everywhere:** no inflated scores, no guaranteed-outcome language, no "proven psychic" claims.

---

## THE STEPS

Each step says what it is in plain English, why it matters, what "done" looks like, where to look, and what to watch out for.

### Step 0: Planning files

**What:** this file, `_internal/WORK-LOG.md`, the Cursor rules file `.cursor/rules/ablty-workflow.mdc`, and pointers in `CLAUDE.md` and `LAUNCH-PLAN.md`.
**Why:** so any AI that opens the project sees the whole plan and logs its work in one place.
**Done when:** Johnny merges it and pulls it into Cursor (Source Control panel, **Sync Changes**).

### Step 1: Stop the website publishing internal documents

**What:** GitHub Pages turns Markdown files in the repository into public web pages. Right now `https://ablty.app/LAUNCH-PLAN.html` is live and readable by anyone, and `CLAUDE.md` is likely published the same way.
**Why:** those documents describe the app's internals and open issues. They should not be one search away.
**Do:** add a `_config.yml` at the repository root that excludes internal files from the published site (at minimum `LAUNCH-PLAN.md`, `CLAUDE.md`, `tests/`, `supabase/`, `design/`, `wrangler.toml`, `ablty-worker.js`, and the prototype HTML files if Johnny agrees). Do not exclude anything the live site needs: `app.html`, `index.html`, `earlybetaaccess.html`, `sw.js`, `manifest.json`, `version.json`, icons, `assets/`, `targets/`, `robots.txt`, `sitemap.xml`, `llms.txt`, `CNAME`, and every image the pages load. `targets/` must stay published because the app and the Worker load target photos from it.
**Watch out for:** GitHub Pages builds with Jekyll. A `_config.yml` that only sets `exclude` is the safest form. Do not add themes or plugins. Note that the Worker source file is only excluded from the website; it is still readable on GitHub while the repository is public.
**Done when:** after merge, `https://ablty.app/` and the installed app still work, and `https://ablty.app/LAUNCH-PLAN.html` returns "not found".
**Bigger fix, later:** the repository is public, so all code is readable on GitHub. Making it private on GitHub's free plan would take the website offline (GitHub unpublishes Pages sites for private repositories on the free plan). The free path to a private repository is moving the website's hosting to Cloudflare Pages, which ABLTY already has an account for. That is a separate project for after the beta.

### Step 2: Fix the beta install links (audit prompt 03)

**What:** two "how to install" recovery paths send testers to the wrong place.
- `earlybetaaccess.html`: the instructions for iPhone users in a non-Safari browser tell them to copy `ablty.app/install.html`, which does not exist (404). The QR code's accessibility label names the same wrong address. The QR code itself already points to the right page; do not regenerate it.
- `app.html`: the **GO TO INSTALL PAGE** button on the "open this in the installed app" guard sends people to the waitlist homepage instead of `/earlybetaaccess.html`.
**Why:** a tester who gets lost during install will give up before ever seeing the app.
**Done when:** both point to `/earlybetaaccess.html`, the label is corrected, a simple automated check confirms no tester-facing link points to a missing page, and Johnny confirms on an iPhone and an Android phone. App version bump required.

### Step 3: Show user and AI text safely (audit prompt 05)

**What:** some text that users type (RV notes) and text the AI writes (`score_reasoning`) is inserted into the page as raw HTML instead of as plain text. Search `app.html` for where RV notes and `score_reasoning` are rendered in the results and session-detail views, and check neighbouring result fields for the same pattern.
**Why:** text should always display as text. If someone types something that looks like code, it must show up as characters, never run.
**Done when:** user and AI text is inserted with `textContent` or proper escaping, intentional layout and line breaks still look right, and a test shows HTML-looking input displays harmlessly. No design changes. App version bump required.

### Step 4: Keep dream saves in the right account (audit prompt 01)

**What:** in `saveDreamEntry`, if a dream save is slow and someone switches accounts on the same phone before it finishes, the finished save can update the screen of the account that is now logged in. The database record is stored correctly under the original account; only the screen is wrong. Background dream tagging has the same weakness.
**Why:** dreams are private. Even a display mix-up is unacceptable.
**Done when:** the save remembers which account started it, and when it finishes it only updates the screen if that same account is still logged in. Tests cover: switch accounts mid-save, switch to guest mid-save, log out and back in mid-save, and a normal save. Follow the existing account-ownership approach already used for RV (from the account isolation fix in PR #130); do not rewrite it. App version bump required.

### Step 5: Honest "saved to cloud" status (audit prompt 02)

**What:** in `syncSessionToSupabase`, the app shows "synced" even when the database answers with an error, because it only catches crashes and never checks the error the database returns.
**Why:** testers will think sessions are saved when they are not, then lose them and blame the app.
**Done when:** the app checks the database's answer; on failure it keeps the session on the phone, shows an honest "not saved yet" state, and retries a limited number of times without creating duplicates or ever uploading one account's session to another account. Tests cover a database error, no internet, success, retry, and switching accounts while a save is pending. Also check other places that show "synced" unconditionally. This is not a rewrite of offline support. App version bump required.

### Step 6: Lock Premium so only the server can grant it (audit prompt 04)

**What:** the database already blocks the app from *changing* an existing profile's `tier` (trigger `trg_profiles_protect_tier`, function `enforce_profiles_tier_lock`, which rejects changes when `current_user` is `authenticated` or `anon`). That protection only covers changes to an existing profile row. It does not cover creating a profile row from the app, and the app is currently allowed to delete its own profile row.
**Why:** Premium and tester status must only ever be set by the server. This is required before any outsider gets access, and essential before charging money.
**Do:** in a **new** migration file:
- Make sure a profile row created by an app user can only ever have the default values for `tier` (`free`) and `is_tester` (`false`), on INSERT and on UPDATE, including upserts.
- Check every place that deletes profile rows (search `app.html` for profile deletes, and the Worker's `handleDeleteAccount`, which deletes with the service key). If the app does not need to delete its own profile row, remove that permission.
- Plan ahead for step 8: any new entitlement column (such as `beta_premium_until`) gets the same protection.
- Keep legitimate paths working: signup (trigger `handle_new_user`), the app's fallback profile creation (it upserts with `tier: 'free'`), Claude's administrative grants through the service role, and the Worker's Stripe updates.
**Tests:** a disposable PostgreSQL database that exercises the real roles (anon, authenticated, service role): signup, fallback profile creation, attempted privilege changes on insert/upsert/update, delete permissions, and legitimate service-role changes. The repository already has a PostgreSQL test harness (`tests/postgres-username-case-insensitive.sh` and the GitHub workflow `pr127-postgres.yml`) to copy from.
**Never** edit or reapply migrations that already exist. Never run against production. After Johnny merges, Claude applies the migration to production and verifies it.

### Step 7: Turn off the test-mode upgrade checkout for the beta

**What:** `handleUpgradeCTA` in `app.html` sends logged-in users to a Stripe **test-mode** payment link (the URL begins with `buy.stripe.com/test_`). Test mode accepts Stripe's public fake card numbers.
**Why:** once beta Premium expires, testers will see Upgrade buttons. A test-mode checkout in front of real users is confusing at best, and depending on how the Worker's webhook is configured it could hand out Premium without any real payment. It also cannot take real money.
**Do:** for the beta, replace the checkout with this message, decided by Johnny on 2026-10-04: **"Premium subscriptions open at launch."** Keep the Stripe code path in place but unreachable, so it is easy to restore at launch. Do not change pricing or Stripe settings.
**Done when:** no screen in the app sends a real user to a Stripe test link. App version bump required.

### Step 8: Beta codes, automatic expiry and expiry banner

**What testers experience:**
1. Install from the beta link and create an account.
2. Settings: **Have a beta code?**, type the code, tap **Redeem**.
3. Premium starts immediately; Settings shows "Beta Premium until [date]".
4. Three days before the end, a small dismissible banner: "Your beta Premium ends on [date]."
5. On the end date the account is Free again automatically. Sessions, dreams and history all stay.

**Database (new migration, after step 6 is live):**
- Table `beta_codes`: the code, a source label (for example `friends`, `reddit`), maximum uses, number used, redeem-by date, days of Premium (default 30), active on/off. App users cannot read it at all (row level security on, no client policies).
- Table `beta_redemptions`: which account redeemed which code and when. One redemption per account, enforced by a unique constraint.
- Column `profiles.beta_premium_until` (timestamp, empty by default), protected exactly like `tier` (see step 6).
- Function `redeem_beta_code(code)`: runs on the server with elevated rights (`SECURITY DEFINER`, explicit empty `search_path`, callable only by signed-in users). It checks, in this order: signed in; not too many wrong attempts recently (for example 5 per hour per account, recorded in a small attempts table); code exists, is active, before its redeem-by date and under its use limit (lock the code row while counting so two people redeeming at once cannot exceed the limit); this account has not redeemed before. On success it sets `beta_premium_until` to now plus the code's days and returns the end date. Error messages must say what went wrong in plain words (invalid code, expired, full, already used, too many tries) without revealing whether a guessed code exists beyond "invalid".
- Note for the implementer: the existing tier lock checks `current_user`. A `SECURITY DEFINER` function owned by the database owner runs as that owner, so it passes the lock. Verify this in the tests rather than assuming.
- One shared definition of "has Premium": a SQL function such as `public.has_premium(user_id)` returning true when `tier = 'premium'` **or** `beta_premium_until` is in the future. Use it everywhere Premium is checked on the server.

**Every place that checks Premium must use the new rule:**
- Database: the only live policy that checks Premium today is `sec_lucidity_readings_premium_select` on `lucidity_readings` (it checks `profiles.tier = 'premium'`). Update it to use `has_premium`. (A separate profiles UPDATE policy compares `tier` to its current value; leave that protection intact.)
- Worker: `checkPremiumTier` in `ablty-worker.js` reads only `tier` and caches the answer for 5 minutes. Read `beta_premium_until` too, and never cache "premium" past the expiry moment.
- App: `getCurrentTier`, `TIER_ACCESS` / `canAccess`, the profile loader, and the local cache (`localStorage` key `ablty_tier`, written by `writeLocalAccountCache`). Store the expiry date alongside the cached tier so an offline phone does not stay Premium forever, and re-check the profile whenever the app opens or comes back to the foreground.

**Settings screen:** code box and Redeem button (only for logged-in accounts without paid Premium), the "Beta Premium until [date]" status, and the expiry banner logic. Show dates in the tester's local time.

**Creating codes:** Claude creates the actual codes in production after the migration is applied, using readable but hard-to-guess values (for example `ABLTY-FRIENDS-7K4Q`). Codes are never written into the repository.

**YOU DECIDE (before building):** what happens to the testers who already have Premium from the earlier manual grants (`tier = 'premium'`, `is_tester = true`). They currently never expire. Options: leave them, or switch them to beta Premium with an end date.

**Tests:** disposable database tests for every redeem outcome (success, wrong code, expired, full, already redeemed, too many attempts, not signed in, two simultaneous redemptions at the limit), expiry turning Premium off, a paid `tier = 'premium'` account never affected by beta expiry, and the lucidity readings policy before and after expiry. App tests for the code box, status line and banner.

### Step 9: Grading upgrade (Worker only)

**What is wrong today:** `handleGrade` in `ablty-worker.js` sends Gemini the viewer's sketch, their notes, and only the target's **name and six descriptor words** (from `RV_TARGET_POOL`). The AI never sees the actual target photo, so it cannot judge whether shapes, lines and layout match. It also uses `gemini-2.5-flash`, which Google still serves but no longer recommends for new work.
**Do:**
1. Send the target photo as a second image alongside the sketch. The Worker already knows the target (`target.src`, a path under `targets/`); fetch it from `https://ablty.app/` + `target.src`, attach it as inline image data, and update the prompt so it clearly says which image is the target and which is the viewer's sketch. This does not weaken the blind protocol: grading only happens after the viewer has submitted. If the target photo cannot be fetched, fall back to today's text-only grading and record that it happened.
2. Change the grading model to `gemini-3.8-flash`. Check Google's current documentation for the right "thinking" setting on 3.x models; today's `thinkingBudget: 0` may not apply. Keep thinking off or minimal so cost and speed stay predictable.
3. Dream tagging (`handleTagDream`) can stay on `gemini-2.5-flash` or move to `gemini-3.5-flash-lite`. Either is fine; do not change its behaviour.
4. Keep the existing grading rules, JSON response format, retry handling and the AI-artifact rule (ignore sketch background and stroke colour).
**Score comparison before merge:** Claude exports 10 to 15 of Johnny's own past sessions (sketch, notes, target) to a local file that is never committed. Cursor writes a small local script that grades each one with the old setup and the new setup, using a Gemini key Johnny places in a local `.env` file that is never committed (add it to `.gitignore`). The pull request includes the side-by-side scores. Johnny reviews them before merging.
**Watch out for:** the current grading instructions push scores upward (for example they require 4 or 5 on geometric form whenever the sketch is "unmistakably" the subject, and the calibration bands start at 55%). Do not change those rules in this step. Flag in the comparison whether the new setup makes scores more generous, so Johnny can decide later in line with the rule against inflated results.
**Cost:** roughly half a cent per graded session at the current introductory price, about a penny after January 1, 2027. No version bump (Worker only); Cloudflare redeploys the Worker when the change merges.

### Step 10: Activity log

**What:** a small table that records named moments, so Johnny can see what testers do. The database already shows finished sessions, dreams and accounts; this fills the gaps (app opened, things started but not finished, screens seen, errors).
**Never record:** dream text, sketches, RV notes, impressions, or anything else a person writes. Only the event name, which account, when, and a few whitelisted details.
**Database (new migration):** table `app_events` with: id, `user_id` (defaults to the signed-in user), `event` (must be one of an allowed list), `props` (small JSON, size-limited by a check constraint), `app_version`, `platform` (installed app or browser, iPhone or Android or desktop), `created_at`. Signed-in users can insert rows for themselves only and cannot read any rows. Guests are not logged.
**Starting event list:** `app_opened`, `rv_started`, `rv_submitted`, `rv_grading_failed`, `zener_started`, `zener_completed`, `presentiment_started`, `presentiment_completed`, `dream_saved`, `academy_lesson_started`, `academy_lesson_completed`, `upgrade_screen_viewed`, `beta_code_redeemed`, `beta_banner_seen`, `feedback_sent`, `cloud_save_failed`, `error` (an error code only, never message text that could contain user content). Match the app's real feature names when wiring these up and report the final list.
**App:** one small helper function that sends events in the background, never blocks or slows the app, and silently gives up if offline or if the insert fails. App version bump required.

### Step 11: In-app feedback box

**What:** today "contact support" opens an email draft, which only works if the phone has a mail app set up. Add a **Send feedback** box in Settings that saves straight to the database.
**Database (new migration):** table `feedback`: id, `user_id`, `message` (required, up to 2,000 characters), optional `category` (bug, idea, other), `app_version`, `platform`, `created_at`. Signed-in users can insert their own; nobody can read through the app. Keep the email address visible as a backup.
**Done when:** a tester can send feedback in two taps and sees a clear "Sent, thank you" confirmation. App version bump required. Optional later: email Johnny when new feedback arrives.

### Step 12: Privacy policy and Terms wording (audit prompt 06)

**What:** the privacy text no longer matches what the app does. The policy exists in two copies inside `app.html`; both must change together.
**Must be accurate about:**
- Guest RV sketches and notes are processed on a server for AI grading (today the text says guest data stays entirely on the device).
- Dream entries are sent to Google's Gemini for automatic tagging (today only RV is mentioned).
- Google does not use ABLTY's requests to improve its products because the API is on a paid plan. Check Google's current paid-service terms for any temporary retention (for example abuse monitoring) and describe it accurately.
- After step 9, target photos are also sent for grading (no personal data, but keep the description complete).
- The activity log (step 10) and feedback box (step 11): what is recorded, what is never recorded, and why.
- Beta Premium: free, no card, ends automatically after 30 days.
**YOU DECIDE:** Johnny approves the final text before it is merged. This is an accuracy fix, not legal advice; if Johnny wants legal review, it happens before merge. App version bump required.

### Step 13: Admin dashboard with export

**What Johnny gets:** a private page (for example `ablty.app/admin.html`) that only his account can use, readable on a phone, in the ABLTY design system (dark background `#0d0e10`, teal `#4af0c8`, blue `#5b9ef4`, amber `#f0a94a`; Bebas Neue, DM Mono, DM Sans).
**Security (most important part):** the page file itself is public like every page on the site, so it must contain no data. All data comes from database functions that check, on the server, that the caller is an admin before returning anything.
- Table `admin_users` listing admin account ids. Only the service role can write to it; Claude adds Johnny's account.
- Admin functions (`SECURITY DEFINER`, empty `search_path`) that first verify the caller is in `admin_users` and, strongly recommended, that the session used two-step login (Supabase MFA, assurance level `aal2`). Johnny sets up an authenticator app once.
- The functions return counts, dates and labels only. **They never return dream text, sketches, RV notes or impressions**, even to Johnny. Feedback and survey answers are the exception, because testers write those for Johnny.
- The page is excluded from search engines (`noindex`) and is not cached by the app's service worker.

**Screens:**
1. **Overview:** testers who redeemed vs codes remaining (per code/source); active today and in the last 7 days; started a first session within 48 hours of redeeming; came back after day 1 and after day 7; sessions this week by feature; Premium expiring in the next 7 days.
2. **Testers:** one row per tester: username, code/source, redeemed date, beta end date, last active, session counts per feature, Academy progress, number of errors. Tap a row for that tester's timeline of events (names and times only).
3. **Features:** usage by feature over time, and where people stop (started vs finished).
4. **Problems:** grading failures, failed cloud saves, AI quota or rate errors, other error codes, newest first.
5. **Feedback inbox:** messages newest first, with tester, date, version and platform.
6. **Survey results:** added in step 17.
7. **Export:** every table on every screen downloads as a CSV file that opens in Excel or Google Sheets.

**Tests:** a non-admin account and a signed-out visitor get nothing from every admin function; an admin without two-step login gets nothing if MFA is required; no function returns any content column. App version bump if `sw.js` changes.
**If this step would delay the beta:** start the beta without it. Claude can pull the same numbers from the database on request until the dashboard ships.

### Step 14: Release check and phone pilot (audit prompt 08)

**What:** after steps 1 to 13 merge (and the migrations are applied by Claude), confirm the live site serves the new version (`https://ablty.app/version.json`), the Worker is the new revision, and run the phone checklist on one iPhone (Safari, installed to home screen) and one Android (Chrome, installed):
install from the beta link; open from the icon, close, reopen; app update picked up; signup, email confirmation and Terms acceptance; wrong then correct password; password reset; Google sign-in if offered; redeem a beta code (try a wrong code too); confirm Premium features unlock; complete RV, Zener, Presentiment and a dream save; airplane mode then reconnect, check the save status is honest; Academy Lesson 01 open, complete, exit; two accounts on one phone; send feedback; check the admin dashboard shows the activity. Include WBTB notifications if they are part of what testers are promised.
**Then:** invite 2 to 3 pilot testers and watch the first few days.
**Record:** device, browser, app version, and pass / fail / not run for each item, in the work log.

### Step 15: Invite the remaining testers

Only after the pilot shows no problems with login, saving, privacy or Premium. Send the install link and the code. Tell testers what the beta includes, that Premium lasts 30 days, and where to send feedback.

### Step 16: Week 2, write the survey

Look at the activity data first, then write 5 or 6 questions around what it shows. Must include: what almost made you stop using it; which feature you would miss most; would you pay $4.99 a month (expect this answer to be inflated). One or two answers must be written, not multiple choice. Johnny approves the questions. Build: a `survey_responses` table (insert own, no client reads) and the survey screen; the reward is given for finishing, never for positive answers.

### Step 17: Day 21, survey goes live

A banner at about day 21 of each tester's beta: "Tell us how it's going and get another free month." Submitting extends `beta_premium_until` by 30 days, once per account, done on the server (a `SECURITY DEFINER` function, same pattern as step 8). Survey results appear on the admin dashboard.

---

## AFTER THE BETA (not needed to start it)

From the October 3 audit, in rough order: Stripe account matching (prompt 09), Stripe subscription lifecycle (10), Stripe free-month code if ever wanted (11), subscription management (12), pricing and billing copy (13), account deletion reliability (14), the data retention promise (15), monitoring and alerts (16), community privacy before enabling community features (17), database hardening (18), small content and accessibility fixes from pilot feedback (19). Also: move website hosting to Cloudflare Pages so the repository can be private; the rest of `LAUNCH-PLAN.md` (Academy, landing page, target pool expansion and renumbering, Signal Scanner).

The full text of those audit prompts is kept outside this public repository. Johnny pastes the relevant one in when a step needs it.
