# ABLTY PRE-BETA PLAN

**Owner:** Johnny (founder, non-technical). **Written:** 2026-10-03 (Chicago) by Claude, from the October 3 read-only audit of `main` at `8d2efb8` (app version `2026.10.01.1`, cache `ablty-v81`) plus Johnny's decisions in the same conversation. **Revised 2026-10-04** after a second review (account deletion moved before the beta, beta scope and pilot pass criteria added, stronger grading test, dashboard made optional before the beta, Gemini thinking setting corrected). **Revised again 2026-10-04** with the steps 1 to 5 pull request: step 8 rewritten to Johnny's code-first install page flow, Gemini 3.x request changes added to step 9, survey price corrected to $5.99.

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
| 0 | Planning files (this file, work log, Cursor rules) | Docs only | Merge | Merged (PR #133) |
| 1 | Stop the website publishing internal documents | Site config | Merge | Merged (PR #135, steps 1 to 5 together, 2026-10-05); live check of `LAUNCH-PLAN.html` still to do |
| 2 | Fix the beta install links | App | Merge, YOU TEST | Merged (PR #135); phone check still to do |
| 3 | Show user and AI text safely | App | Merge | Merged (PR #135) |
| 4 | Keep dream saves in the right account | App | Merge | Merged (PR #135) |
| 5 | Honest "saved to cloud" status | App | Merge | Merged (PR #135); phone check still to do. Follow-up PR #139 (merged 2026-10-09) rewrote the row's wording in plain English, added a DETAILS report for support, and fixed two false backup assurances found in review. Follow-up PR #141 (merged 2026-10-09, 2026.10.09.3 / `ablty-v87`) fixed parked results blocking the cloud check of other results, added a recovery path for results held by the user's other account, and a Get help email button; phone: the recovery offer showed and disappeared after Move, return to the original account not yet confirmed. UX follow-up PR #142 (draft, 2026.10.09.4 / `ablty-v88`) closes Details after a full recovery and shows "N results recovered." |
| 6 | Lock Premium so only the server can grant it | Database | Approve migration | Verified (PR #136 merged 2026-10-06; migration applied to production as version `20261006015911` and verified read-only the same day) |
| 7 | Turn off the test-mode upgrade checkout for the beta | App | Merge | Merged (PR #138, 2026-10-06, version 2026.10.06.1 / `ablty-v83`); phone check still to do. Settings version display and update-banner fixes needed to verify it merged in PR #139 (2026-10-09, 2026.10.06.2 / `ablty-v84`) |
| 8 | Beta code gate on the install page, signup with code, automatic expiry and expiry banner | Database + install page + App + Worker | Approve migration, choose codes | Not started. Johnny decided 2026-10-06: leave all existing Premium accounts unchanged (see the step 8 section) |
| 9 | Grading upgrade: show the AI the target photo, newer model | Worker only | Review grading test results | Not started |
| 10 | Activity log (what testers do, never what they write) | Database + App | Approve migration | Not started |
| 11 | In-app feedback box | Database + App | Approve migration | Not started |
| 12 | Account deletion removes everything, reliably | Worker + Database | Approve migration if needed | Not started |
| 13 | Privacy policy and Terms wording, including data retention | App (legal copy) | YOU DECIDE, approve text | Not started |
| 14 | Admin dashboard with export (**optional before the beta**) | Database + new page | Approve migration, set up 2-step login | Not started |
| 15 | Release check, cost and error alerts, 2 to 3 person phone pilot | Testing | YOU TEST | Not started |
| 16 | Invite the remaining testers | Launch | Send invites | Not started |
| 17 | Week 2: write the survey | Copy + App + Database | Approve questions | After beta starts |
| 18 | Day 21: survey goes live with the extra-month reward | App | Turn on | After beta starts |

**Order matters.** Steps 1 to 5 are small and independent (Johnny chose to ship them in one pull request with one version bump, because steps 2, 3 and 5 all change `app.html`). Step 6 must merge and be applied to production before step 8, because a beta code system is pointless if Premium can be obtained any other way. Step 13 comes after 9 to 12 because those steps change what the privacy policy has to say. Step 14 (dashboard) does **not** block the pilot or the beta; it can be finished during the beta.

**Settings pull-to-close (follow-up, not a numbered step):** draft PR #143 on branch `cursor/settings-pull-to-close-0dbf`, version 2026.10.10.1 / `ablty-v89`. Phone check still to do. Steps 8 and 9 have not started. Docs-only PR #140 was left open and was not changed.

**Reality Check notification launch (follow-up, not a numbered step):** draft PR #144 on branch `cursor/rc-notification-launch-9435`, version 2026.10.10.2 / `ablty-v90`. A Reality Check tap that launched the app opened Home instead of the exercise. Browser tests pass; phone check still to do (steps in the PR and in `_internal/WORK-LOG.md`). Steps 8 and 9 have not started.

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

## WHAT THIS BETA INCLUDES (Johnny confirms before step 16)

Testers are told exactly what they are testing, so feedback is about the right things.

**In the beta:** Remote Viewing sessions with AI grading; Zener card test; Presentiment (timestamp prediction); Dream Journal with automatic tagging; dream and lucid-dreaming tools that are already in the app (reality checks, WBTB, MILD) if Johnny wants them tested; Academy **Lesson 01 only** (deliberate, the rest of the Academy is being rebuilt); account, sync and settings.
**Not in the beta (say so to testers):** the rest of the Academy, paid subscriptions, the Daily Community RV Challenge and leaderboards, Signal Scanner, PK Arena, and any protocol not already in the app. If a new protocol (for example a new precognition test) should be part of the beta, it must be added to this plan as its own step first.
**Known limits to disclose:** only three lucidity readings exist for WBTB content; AI grading is a scoring aid, not a judgment of ability.

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
**Done when:** the **whole** save operation is protected, not just the ending. Before the first network wait, capture which account started the save, the login session at that moment, and the form contents. After every wait (the save itself, any error, and background tagging), only touch the screen, the journal list, the form or any message if that same account and session are still active. A failed save must not show its error to a different account either. Tests cover: switch accounts mid-save, switch to guest mid-save, log out and back in mid-save, an error arriving after a switch, tagging finishing after a switch, and a normal save. Follow the existing account-ownership approach already used for RV (from the account isolation fix in PR #130); do not rewrite it. App version bump required.

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
**Built 2026-10-05** (branch `cursor/step-6-lock-premium-bbab`): migration `20261005000001_profiles_lock_entitlements.sql` runs the existing lock on INSERT as well as UPDATE (so upserts are covered), protects `beta_premium_until` automatically once step 8 adds that column, takes away the app's permission to delete or empty profile rows (the app never deletes profiles; the Worker deletes them with the service key, which keeps that permission), and pins the function's `search_path` (clears the Supabase advisor warning). The signup trigger and the app's fallback profile creation keep working because both only write `tier = 'free'`. Test: `tests/postgres-profiles-entitlement-lock.sh` (disposable PostgreSQL with every live profiles migration applied in production order, including the current signup function, the case-insensitive username index and the 30-day rename cooldown; also run on GitHub by `.github/workflows/profiles-entitlement-lock-postgres.yml`). **Rollback** is written in the migration's header comment. The old `trg_profiles_protect_tier` name is kept, so the existing trigger is replaced in place, not duplicated.
**Applied to production 2026-10-06** (after Johnny merged #136 and authorised this one migration): recorded in the live migration history as version `20261006015911`, name `profiles_lock_entitlements`. Verified read-only the same day; details in `_internal/WORK-LOG.md`. Do not reapply.

### Step 7: Turn off the test-mode upgrade checkout for the beta

**What:** `handleUpgradeCTA` in `app.html` sends logged-in users to a Stripe **test-mode** payment link (the URL begins with `buy.stripe.com/test_`). Test mode accepts Stripe's public fake card numbers.
**Why:** once beta Premium expires, testers will see Upgrade buttons. A test-mode checkout in front of real users is confusing at best, and depending on how the Worker's webhook is configured it could hand out Premium without any real payment. It also cannot take real money.
**Do:** for the beta, replace the checkout with this message, decided by Johnny on 2026-10-04: **"Premium subscriptions open at launch."** Keep the Stripe code path in place but unreachable, so it is easy to restore at launch. Do not change pricing or Stripe settings.
**Done when:** no screen in the app sends a real user to a Stripe test link. App version bump required.
**Built 2026-10-06** (branch `cursor/step-7-beta-upgrade-message-bbab`): one switch in `app.html`, `PREMIUM_CHECKOUT_ENABLED = false`. `handleUpgradeCTA` (the only function that ever opened a checkout; reached from the Settings Upgrade row, the two signed-in upgrade modal variants and the two WBTB gate cards) now shows "Premium subscriptions open at launch." and stops. Guests tapping Upgrade still go to free-account signup, with the same message. The Stripe code moved unchanged into `openStripeCheckout()`, which only runs when the switch is true. **At launch (LAUNCH-PLAN task 4.4):** set the switch to true together with the live Payment Links. Price copy ("$4.99/month") in the modal and legal text is pricing and was left alone (task 2.1).

### Step 8: Beta code gate on the install page, signup with code, automatic expiry and expiry banner

**Flow decided by Johnny on 2026-10-04.** The code comes first, on the install page, and the account is created there too, so Premium is already on the account before the tester ever opens the app.

**What testers experience:**
1. The tester opens the beta link (`earlybetaaccess.html`). The page shows a **code box first**. The install instructions stay hidden until a valid code has been entered.
2. The code is checked **on the server** (a Supabase function or the Worker). The page's JavaScript never contains the list of codes. A wrong code gets a plain "That code is not valid" and nothing more.
3. After a valid code, the same page shows a **create-account form** with the same rules as the in-app signup: email, password, username (same availability check and same case-insensitive rule), and the Terms and Privacy acceptance tick.
4. The code is sent along with the signup and **redeemed on the server, tied to the new user's id**. It grants 30 days of Premium (`beta_premium_until`) and sets `is_tester`. Premium is granted **at account creation, not after the user returns from email verification**, because on iPhone the verification link often opens inside the Gmail or Mail in-app browser and the user never comes back to the page.
5. Redemption limits are enforced (use limit, redeem-by date, active on/off), and one account cannot redeem twice.
6. Right after signup, the page shows the install instructions plus this message: **"Check your email to verify your account, then open ABLTY from your home screen and sign in. Don't see it within a few minutes? Check your junk or spam folder."**
7. The email verification link lands on a **simple page that tells the user to open ABLTY from their home screen** (not straight into the app, because that link may open inside a mail app's browser where the installed app cannot take over).
8. If the email already has an account, the page offers **"Sign in to finish"**: the tester signs in there and the code is redeemed for that existing account.
9. The in-app Settings code box (**Have a beta code?**, type the code, tap **Redeem**) stays as a backup for anyone who installed first or arrived without the page.
10. Settings shows "Beta Premium until [date]". Three days before the end, a small dismissible banner: "Your beta Premium ends on [date]." On the end date the account is Free again automatically. Sessions, dreams and history all stay.

**Database (new migration, after step 6 is live):**
- Table `beta_codes`: the code, a source label (for example `friends`, `reddit`), maximum uses, number used, redeem-by date, days of Premium (default 30), active on/off. App users cannot read it at all (row level security on, no client policies).
- Table `beta_redemptions`: which account redeemed which code and when. One redemption per account, enforced by a unique constraint.
- Column `profiles.beta_premium_until` (timestamp, empty by default), protected exactly like `tier` and `is_tester` (see step 6).
- Function `check_beta_code(code)`: answers only "valid" or "not valid" (active, before redeem-by, under its use limit). It must be callable **without an account**, because the install page asks before signup. It must never return the code list, the source label, counts or dates. SQL alone cannot see the caller's address, so put the attempt limit for this check in the Worker (per address, in KV) if the check is exposed through the Worker, or accept that the codes are long and hard to guess if it is exposed as a direct RPC. Say which was chosen in the pull request.
- Function `redeem_beta_code(code)`: runs on the server with elevated rights (`SECURITY DEFINER`, explicit empty `search_path`, callable only by signed-in users; this is the path for "Sign in to finish" and for the in-app backup box). It checks, in this order: signed in; not too many wrong attempts recently (for example 5 per hour per account, recorded in a small attempts table); code exists, is active, before its redeem-by date and under its use limit (lock the code row while counting so two people redeeming at once cannot exceed the limit); this account has not redeemed before. On success it sets `beta_premium_until` to now plus the code's days, sets `is_tester`, records the redemption and returns the end date. Error messages must say what went wrong in plain words (invalid code, expired, full, already used, too many tries) without revealing whether a guessed code exists beyond "invalid".
- **Redeeming at account creation:** the page passes the code with the signup call (Supabase lets a signup carry a small amount of metadata), and the signup trigger (`handle_new_user`, or a new trigger that runs after it) reads that code and performs the same redemption logic, so the new account has `beta_premium_until` and `is_tester` from its very first row, before any email is confirmed. The metadata is typed by the user, so it is only ever an input to the server-side check, never trusted on its own. If the code in the metadata is invalid, the account is still created as Free (the page already checked the code moments earlier, so this should be rare) and the page says so. The Terms and Privacy acceptance ticked on the page should travel the same way so it lands on the profile; if it does not, the app's consent gate will ask once more at first sign-in, which is acceptable but must be known.
- Note for the implementer: the existing tier lock checks `current_user`. A `SECURITY DEFINER` function owned by the database owner, and a trigger function owned by the database owner, run as that owner, so they pass the lock. Verify this in the tests rather than assuming.
- One shared definition of "has Premium": a SQL function such as `public.has_premium(user_id)` returning true when `tier = 'premium'` **or** `beta_premium_until` is in the future. Use it everywhere Premium is checked on the server.

**Install page (`earlybetaaccess.html`):** code box first; install steps hidden until a valid code; create-account form with the same validation as the app; the post-signup message above; the "Sign in to finish" path for an existing email; the page must work inside the Gmail and Mail in-app browsers on iPhone (which is exactly where the code and form will often be filled in) and must not depend on the user ever returning to it. Use the same `escapeHtml`-style care for anything typed into the page (see step 3).

**Verification landing page:** a small page (for example `/verified.html`) set as the email redirect target. It needs a little script, because Supabase does not always arrive with good news: when a link has expired, was already used, or is otherwise invalid, Supabase sends the user to the redirect URL with an error attached (in the part of the address after `#`, and in some flows after `?`: `error`, `error_code` such as `otp_expired` or `access_denied`, and `error_description`). The page must read those first:
- **Error present:** show "This link has expired or was already used. Request a new one." with a button that asks for the email address and requests a fresh verification email (Supabase's resend call for a signup confirmation, using the public anon key, with the same redirect URL). Never show "verified" when an error is present. Show the error in plain words only; do not print the raw `error_description`.
- **No error:** show "Your email is verified. Open ABLTY from your home screen and sign in."
- **In both cases**, include the install instructions below the message for anyone who has not installed yet (the same per-device steps as `earlybetaaccess.html`, or a clear link to that page), because this page is often the first thing a tester sees after signing up from inside a mail app.
- The page must be published by GitHub Pages (not excluded by step 1), excluded from search engines (`noindex`), not cached by the app's service worker, and must work inside the Gmail and Apple Mail in-app browsers on iPhone and in the Gmail app on Android. Testing in step 15 must include an expired link (request a verification email, wait past its expiry or use it twice, then open it).

**Every place that checks Premium must use the new rule:**
- Database: the only live policy that checks Premium today is `sec_lucidity_readings_premium_select` on `lucidity_readings` (it checks `profiles.tier = 'premium'`). Update it to use `has_premium`. (A separate profiles UPDATE policy compares `tier` to its current value; leave that protection intact.)
- Worker: `checkPremiumTier` in `ablty-worker.js` reads only `tier` and caches the answer for 5 minutes. Read `beta_premium_until` too, and never cache "premium" past the expiry moment.
- App: `getCurrentTier`, `TIER_ACCESS` / `canAccess`, the profile loader, and the local cache (`localStorage` key `ablty_tier`, written by `writeLocalAccountCache`). Store the expiry date alongside the cached tier so an offline phone does not stay Premium forever, and re-check the profile whenever the app opens or comes back to the foreground.

**Settings screen:** the backup code box and Redeem button (only for logged-in accounts without paid Premium and without beta Premium), the "Beta Premium until [date]" status, and the expiry banner logic. Show dates in the tester's local time.

**Creating codes:** Claude creates the actual codes in production after the migration is applied, using readable but hard-to-guess values (for example `ABLTY-FRIENDS-7K4Q`). Codes are never written into the repository.

**DECIDED by Johnny on 2026-10-06:** all existing Premium accounts stay exactly as they are. The accounts that already have Premium from the earlier manual grants (`tier = 'premium'`, `is_tester = true`) are not switched to beta Premium, are not given an end date, and are not touched by the step 8 migration, the expiry logic or the banner. `has_premium` must return true for `tier = 'premium'` regardless of `beta_premium_until`, and the step 8 tests must include a paid or manually granted `tier = 'premium'` account that is never affected by beta expiry (already listed under Tests below). Step 8 has not started.

**Tests:** disposable database tests for every redeem outcome (success, wrong code, expired, full, already redeemed, too many attempts, not signed in, two simultaneous redemptions at the limit), redemption at account creation through the signup trigger (valid code, invalid code, existing account), expiry turning Premium off, a paid `tier = 'premium'` account never affected by beta expiry, and the lucidity readings policy before and after expiry. App tests for the install page (code gate, form validation, post-signup message, "Sign in to finish"), the backup code box, status line and banner. **Phone testing must include a real verification email opened from both the Gmail app and Apple Mail, on an iPhone and on an Android phone**, confirming that the account already has Premium when it first signs in to the installed app, whichever browser the link opened in.

### Step 9: Grading upgrade (Worker only)

**What is wrong today:** `handleGrade` in `ablty-worker.js` sends Gemini the viewer's sketch, their notes, and only the target's **name and six descriptor words** (from `RV_TARGET_POOL`). The AI never sees the actual target photo, so it cannot judge whether shapes, lines and layout match. It also uses `gemini-2.5-flash`, which Google still serves but no longer recommends for new work.
**Do:**
1. Send the target photo as a second image alongside the sketch. The Worker already knows the target (`target.src`, a path under `targets/`); fetch it from `https://ablty.app/` + `target.src`, attach it as inline image data, and update the prompt so it clearly says which image is the target and which is the viewer's sketch. This does not weaken the blind protocol: grading only happens after the viewer has submitted. If the target photo cannot be fetched, fall back to today's text-only grading and record that it happened.
2. Change the grading model to `gemini-3.8-flash`. Thinking cannot be turned off on this model: Google documents the levels `low`, `medium` (the default) and `high`, and the old `thinkingBudget: 0` setting does not apply. Use `thinking_level: low` unless the grading test shows `medium` is clearly better, and record the real cost and response time for each.
   **Request changes required for Gemini 3.x (checked against Google's migration notes on 2026-10-04):** remove `temperature`, `top_p` and `top_k` from the generation config (the Worker currently sends `temperature: 0.2` for grading and `0.1` for dream tagging), and replace `thinkingConfig.thinkingBudget` with `thinkingConfig.thinkingLevel` (a string: `low`, `medium` or `high`; `minimal` is rejected by 3.8 Flash). Google also notes `candidate_count` is unsupported on 3.x; the Worker does not send it. If dream tagging stays on `gemini-2.5-flash`, its request keeps the old settings; if it moves to a 3.x model, it needs the same changes.
3. Dream tagging (`handleTagDream`) can stay on `gemini-2.5-flash` or move to `gemini-3.5-flash-lite`. Either is fine; do not change its behaviour.
4. Keep the existing grading rules, JSON response format, retry handling and the AI-artifact rule (ignore sketch background and stroke colour).
**Grading test before merge (higher scores do not mean better grading):** run the old setup and the new setup on the same set of submissions and include the results in the pull request. The set must include:
- 10 to 15 of Johnny's own real past sessions (Claude exports them; they are never committed to the repository).
- **Mismatched pairs:** the same sketches graded against unrelated targets. A good grader scores these clearly lower.
- **Vague submissions:** generic notes like "dark, round, some movement" with a scribble. A good grader does not reward these.
- **Repeat runs:** grade the same submission 3 times to see how much the score wobbles.
- For each run, record the score, the response time, and the token usage (cost).

**Adopt the new setup only if** it separates real matches from mismatched and vague ones better than today, and is at least as consistent. If it does not, keep sending the target photo but stay on the current model, or report back to Johnny.
**Where the Gemini key lives for the test:** never in the repository and never pasted into a chat. If the agent runs in the cloud (Johnny uses Cursor cloud agents from his phone), check whether the environment supports private secrets and explain the options to Johnny before doing anything.
**Watch out for:** the current grading instructions push scores upward (for example they require 4 or 5 on geometric form whenever the sketch is "unmistakably" the subject, and the calibration bands start at 55%). Do not change those rules in this step. Flag in the comparison whether the new setup makes scores more generous, so Johnny can decide later in line with the rule against inflated results.
**Cost:** about half a cent per graded session before thinking tokens at the current introductory price ($0.75 input / $3.75 output per million tokens through December 31, 2026, then double). Thinking tokens are billed as output, so measure the real number in the test rather than trusting this estimate. No version bump (Worker only); Cloudflare redeploys the Worker when the change merges.

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

### Step 12: Account deletion removes everything, reliably (audit prompt 14)

**What:** testers will be writing private material from day one, so "delete my account" must actually work. Today `handleDeleteAccount` in `ablty-worker.js` deletes each table's rows in turn but never checks whether the database accepted each delete; it carries on even if one fails, then deletes the login last.
**Why:** a partly failed deletion could leave someone's data behind while the app tells them it is gone, or block the final step.
**Do:**
1. First, read the live database's foreign keys (which tables delete automatically when an account is deleted, and which block it). Claude can run this read-only check on request. `dream_entries` and `wbtb_sessions` are believed to delete automatically; confirm rather than assume, and do not report them as bugs if they do.
2. Make every delete check the database's answer. If any step fails, stop, keep the login so the person can retry, and show an honest "deletion did not finish, please try again" message.
3. Make retrying safe: running deletion twice must not error out on data that is already gone.
4. Include the new tables from steps 8, 10 and 11 (`beta_redemptions`, `app_events`, `feedback`) in the deletion, or give them automatic deletion rules.
**Tests:** disposable accounts and data only (never real accounts): complete success; a failed table delete then a successful retry; deleting twice; an invalid login token.
**Done when:** a test account deleted from the app leaves no rows behind in any table, confirmed by Claude with a read-only check after the change is live.

### Step 13: Privacy policy and Terms wording (audit prompts 06 and 15)

**What:** the privacy text no longer matches what the app does. The policy exists in two copies inside `app.html`; both must change together.
**Must be accurate about:**
- Guest RV sketches and notes are processed on a server for AI grading (today the text says guest data stays entirely on the device).
- Dream entries are sent to Google's Gemini for automatic tagging (today only RV is mentioned).
- Google does not use ABLTY's requests to improve its products because the API is on a paid plan. That is **not** the same as "never stored": Google says paid-service prompts and responses can be logged for a limited time for abuse prevention. Check Google's current terms and say exactly that.
- After step 9, target photos are also sent for grading (no personal data, but keep the description complete).
- The activity log (step 10) and feedback box (step 11): what is recorded, what is never recorded, and why.
- Beta Premium: free, no card, ends automatically after 30 days.
- **Data retention:** the policy currently promises free-account records are deleted after 90 days, but nothing in the project performs that deletion. Change the wording to what actually happens (Johnny decides the rule), rather than building a deletion job before the beta.
- Account deletion, matching what step 12 actually does.
**YOU DECIDE:** Johnny approves the final text before it is merged. This is an accuracy fix, not legal advice; if Johnny wants legal review, it happens before merge. App version bump required.

### Step 14: Admin dashboard with export (optional before the beta)

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
6. **Survey results:** added in step 18.
7. **Export:** every table on every screen downloads as a CSV file that opens in Excel or Google Sheets.

**Tests:** a non-admin account and a signed-out visitor get nothing from every admin function; an admin without two-step login gets nothing if MFA is required; no function returns any content column. App version bump if `sw.js` changes.
**This step does not block the beta.** If it is not ready, start the pilot without it. For the first weeks, the activity log plus the feedback table are enough; Claude can pull the numbers from the database on request until the dashboard ships.

### Step 15: Release check, cost and error alerts, phone pilot (audit prompts 08 and 16)

**Release check:** after steps 1 to 13 merge (and Claude has applied the migrations), confirm the live site serves the new version (`https://ablty.app/version.json`) and the Worker is the new revision.

**Basic cost and error visibility (before any tester):**
- A spending alert on the Google Cloud project that pays for Gemini (for example an email at $10 a month). Johnny sets this up; Claude walks him through it.
- Johnny knows where to see Worker errors (Cloudflare dashboard logs), and the activity log records grading failures and failed cloud saves.
- Feedback box working, plus the email address as a backup.

**Phone checklist** on one iPhone (Safari, installed to home screen) and one Android (Chrome, installed):
open the beta link, enter the beta code (try a wrong code first), create the account on the page, see the install instructions and the check-your-email message; open the verification email in the Gmail app and in Apple Mail (iPhone) and in the Gmail app (Android) and land on the verified page; install from the beta link; open from the icon, close, reopen; app update picked up; sign in and confirm Premium is already on the account, Terms acceptance; wrong then correct password; password reset; Google sign-in if offered; the backup Settings code box with a wrong code and an already-used code; Premium features unlock; complete RV, Zener, Presentiment and a dream save; close and reopen, history still there; airplane mode then reconnect, save status honest; Academy Lesson 01 open, complete, exit; two accounts on one phone; send feedback; delete a test account and confirm it is gone. Include WBTB notifications if they are part of what testers are promised.

**Then:** invite 2 to 3 pilot testers and watch the first few days.

**Pilot pass criteria (all required before step 16), on both iPhone and Android:**
- Testers installed the app and created accounts without help, or with help that led to a fix.
- Each pilot tester redeemed a code and got Premium.
- Each completed at least one full session, and it was still in their history after closing and reopening the app.
- At least one feedback message arrived through the app.
- No grading failures that were not explained and fixed.

**Stop and fix before inviting anyone else if any of these happen:** any sign of one account seeing another account's data; any unexplained data loss; signup or login broken on either platform; Premium obtainable without a code.

**Record:** device, browser, app version, and pass / fail / not run for each item, in the work log.

### Step 16: Invite the remaining testers

Only after the pilot passes the criteria above. Send the install link and the code. Tell testers what the beta includes and does not include (see "What this beta includes"), that Premium lasts 30 days, and where to send feedback.

### Step 17: Week 2, write the survey

Look at the activity data first, then write 5 or 6 questions around what it shows. Must include: what almost made you stop using it; which feature you would miss most; would you pay $5.99 a month (the decided launch price in `LAUNCH-PLAN.md`; expect this answer to be inflated). One or two answers must be written, not multiple choice. Johnny approves the questions. Build: a `survey_responses` table (insert own, no client reads) and the survey screen; the reward is given for finishing, never for positive answers.

### Step 18: Day 21, survey goes live

A banner at about day 21 of each tester's beta: "Tell us how it's going and get another free month." Submitting extends `beta_premium_until` by 30 days, once per account, done on the server (a `SECURITY DEFINER` function, same pattern as step 8). Survey results appear on the admin dashboard.

---

## AFTER THE BETA (not needed to start it)

From the October 3 audit, in rough order: Stripe account matching (prompt 09), Stripe subscription lifecycle (10), Stripe free-month code if ever wanted (11), subscription management (12), pricing and billing copy (13), a real data retention job if Johnny wants one (15), full monitoring and alerts beyond the basics in step 15 (16), community privacy before enabling community features (17), database hardening (18), small content and accessibility fixes from pilot feedback (19). Also: move website hosting to Cloudflare Pages so the repository can be private; the rest of `LAUNCH-PLAN.md` (Academy, landing page, target pool expansion and renumbering, Signal Scanner).

**Results table ids must become collision-proof across users (database change, found 2026-10-04 during the step 5 review).** `rv_sessions`, `zener_runs` and `ts_trials` use the client-generated `id` (a millisecond timestamp from `Date.now()`) as their primary key, shared by every account. Two people saving in the same millisecond collide: the second insert is rejected and that result can never be uploaded under that id. Since PR #135 the app detects this (a duplicate-key answer is checked against owner and saved contents by reading the existing row back; a row that belongs to someone else, or this account's row with different contents, is left alone and the item stays listed as not saved without a retry offer), but it cannot fix it. The fix is a new migration that makes the key unique per user (for example a primary key on `(user_id, id)`, or a server-generated primary key with the client id kept as a per-user unique column), plus matching changes to the app's merge keys (`mergeSessionArrays` and the cloud caches), the guest-data upload (`migrateGuestData` upserts on `id`), the Worker's account deletion, and a read-only audit of existing rows for collisions first. Not needed before the beta; the collision is rare and no longer silent.

The full text of those audit prompts is kept outside this public repository. Johnny pastes the relevant one in when a step needs it.
