# ABLTY Claude Code Handoff

## What is ABLTY?
A PWA for lucid dreaming and psi research. Single-page app (`app.html`, ~16,500 lines), vanilla JS, no framework. Cloudflare Workers backend (`ablty-worker.js`) for push/WBTB scheduling. Supabase (PostgreSQL 17) for auth and cloud sync.

## Architecture
- **Frontend:** `app.html` — all HTML, CSS, JS in one file
- **Backend:** `ablty-worker.js` — Cloudflare Worker, deployed via `wrangler deploy`
- **Config:** `wrangler.toml` — worker name, KV binding, cron trigger (`*/5 * * * *`)
- **Service Worker:** `sw.js` — cache strategy, push notification handling, WBTB notification routing
- **Version triplet (bump all three together):**
  - `APP_VERSION` in `app.html` → `'2026.06.15.1'`
  - `version` in `version.json` → `"2026.06.15.1"`
  - `CACHE_NAME` in `sw.js` → `'ablty-v53'`

## GitHub
- Repo: `johnkay22/ablty` (Johnkay22/ABLTY)
- Develop on feature branches, PR to `main`
- Always create a PR after pushing changes

## App Modules
- **Remote Viewing (RV):** Sketch-based ESP test, AI-graded via Gemini API
- **Zener Cards:** Classic 25-trial ESP card test
- **Presentiment (Timestamp):** Precognitive timing test
- **Photo Pair:** Binary forced-choice emotional valence test
- **Dream Lab:** Hub screen for dream-related features
- **Dream Journal:** Cloud-synced dream entries with AI tagging, lucidity tracking
- **Dream Insights:** Analytics — lucidity rate, recall trend, streak, dream signs
- **Reality Check:** Periodic push notifications; in-app task screen
- **WBTB Timer:** Schedules push alarm after 4.5–7.5h sleep + 25-min return reminder
- **WBTB Re-Entry Protocol:** 7-step guided overnight protocol (see below — the major recent feature)
- **Stats:** Combined session history for all module types

---

## WBTB Re-Entry Protocol — Feature Status (as of 2026-06-19)

The Re-Entry Protocol is the main feature built in this codebase session. **All planned PRs are merged and live.** The feature is code-complete but not yet formally QA'd.

### What it is
A 7-step guided protocol the user runs when woken by the WBTB alarm. Steps:
1. **Dream Capture** — record dream fragments before they fade
2. **Wake Calibration** — body posture, breathing, alertness check
3. **RC Drill** — 3 in-sequence reality checks (premium only)
4. **Lucidity Reading** — short MILD-priming text (premium only)
5. **Intention Setting** — MILD prospective intention (6 presets + custom)
6. **Wind-Down** — guided return to sleep
7. **Morning Sync** — next-day outcome logging (modal, not a step panel)

### State machine
- localStorage key: `ablty_wbtb_protocol`
- Shape: `{ active, currentStep, completedSteps, path, stepData: { seed, intention }, wbtbSessionId, startedAt, pendingSync }`
- Path values: `'A'` (normal), `'B'` (groggy), `'C'` (no dream recall)
- On cold app open with `active: true` → `resumeOrInitRP()` → `rpNavigateToStep(currentStep)`

### Key functions (app.html)
- `rpNavigateToStep(n)` — sole router; shows/hides step panels, manages wake lock, **write-neutral for completion_state**
- `rpCompleteStep(n, advance=true)` — marks step done; writes `completed_step_N` to DB (n=1–5) or `wound_down` (n=6)
- `rpGatedSkipStep(n)` — free-user skip; writes `gated_skip_N` (distinct from genuine completion); does NOT call `rpCompleteStep`
- `rpExitConfirm()` — explicit quit; writes `exited_at_step_' + currentStep`
- `rpStep3Init()` — shows premium gate for non-premium users; early return, no RC drill rendered
- `rpStep4Init()` — shows premium gate for non-premium; early return before any Supabase queries
- `rpStep5Init()` — loads intention picker; prefills textarea from `stepData.seed` if Path C
- `rpStep5Submit()` — saves intention to DB + advances
- `_rpUpdateSessionRow(fields)` — guarded Supabase UPDATE on `wbtb_sessions`; requires `wbtbSessionId` and `userId`
- `submitMorningSync()` — writes outcome + `completion_state: 'synced'`; clears protocol state

### completion_state analytics semantics
| Value | Meaning |
|---|---|
| `started` | Row created, no step completed |
| `completed_step_1` – `completed_step_5` | User genuinely completed that step |
| `wound_down` | Step 6 complete — protocol success |
| `synced` | Morning sync done — also a success state |
| `exited_at_step_N` | User explicitly quit while on step N |
| `gated_skip_3` | Free user skipped Step 3 gate |
| `gated_skip_4` | Free user skipped Step 4 gate |

Last-write-wins: a free user who skips both gates records `gated_skip_4` only (step 3 is overwritten). Per-gate breakdown requires row-level sequence analysis.

### Supabase tables added
- **`wbtb_sessions`** (migration `20260612000001`) — one row per protocol run; RLS: own rows only
- **`lucidity_readings`** (migration `20260613000001`) — reading content; RLS: premium users only (SELECT blocked for free/guest → empty array, no error); currently has 3 placeholder rows — needs 10+ real pieces via Supabase dashboard

### Premium gates
- Steps 3 and 4 are gated behind `isPremiumTier()` (reads `localStorage.getItem('ablty_tier')` live)
- Gate card: heading + body + "Upgrade to Premium" CTA (`handleUpgradeCTA()`) + "Skip this step" ghost button (`rpGatedSkipStep(n)`)
- `showUpgradeModal()` is app-wide and has no skip-callback support — do NOT add one; use inline gate cards for protocol skips

### Screen Wake Lock
- Acquired on steps 1–5 (`RP_WAKE_LOCK_STEPS = [1, 2, 3, 4, 5]`)
- Released on step 6 entry (Wind-Down) — intentional, user is returning to sleep

### PRs merged (this feature)
| PR | Branch | What |
|---|---|---|
| #93 | claude/wbtb-d1-* | Initial protocol UI + step 1 |
| #94 | claude/wbtb-d2-* | Step 2 Wake Calibration |
| #95 | claude/wbtb-d3a-* | Morning Sync modal |
| #96 | claude/wbtb-d4-* | Step reorder to final sequence |
| #97 | claude/wbtb-d6-intention | Step 5 Intention Setting (MILD presets + custom) |
| #98 | claude/wbtb-d5-readings | Step 4 Lucidity Reading + lucidity_readings table |
| #99 | claude/wbtb-d7a-analytics | Analytics: completion_state writes + rpExitConfirm fix |
| #100 | claude/wbtb-d7b-gates | Premium gates for steps 3 and 4 |

---

## Launch Checklist (pre-public)

- [ ] **Gate or remove 5-tap dev skip** — there is a dev shortcut in the protocol that bypasses steps; suggested: gate behind `localStorage.getItem('ablty_dev')` truthy check
- [ ] **Verify free/premium step visibility** on real accounts (free should see gate cards on steps 3/4; premium should see full steps)
- [ ] **All 3 Step 2 paths produce valid Dream Lab entries** (Path A/B/C)
- [ ] **Step 7 (Morning Sync) links to correct wbtb_session row** from previous night
- [ ] **10+ readings in `lucidity_readings`** — only 3 placeholders exist; add via Supabase dashboard, no code deploy needed
- [ ] **D-5 follow-up:** dim/warm CSS styling for the reading wrap (Step 4) — marked with TODO comment in code; sleep-onset ergonomics

---

## Key Code Locations (app.html approximate line numbers)

These shift with edits — use grep/search to verify:
- `APP_VERSION`: search `APP_VERSION =`
- `RP_TOTAL_STEPS`: search `RP_TOTAL_STEPS`
- `rpNavigateToStep`: search `function rpNavigateToStep`
- `rpCompleteStep`: search `function rpCompleteStep`
- `rpGatedSkipStep`: search `function rpGatedSkipStep`
- `rpExitConfirm`: search `function rpExitConfirm`
- `rpStep3Init`: search `function rpStep3Init`
- `rpStep4Init`: search `async function rpStep4Init`
- `rpStep5Init`: search `function rpStep5Init`
- `_rpUpdateSessionRow`: search `function _rpUpdateSessionRow`
- `submitMorningSync`: search `function submitMorningSync`
- `isPremiumTier`: search `function isPremiumTier`
- WBTB screen HTML: search `id="wbtb"`
- Protocol step panels: search `id="rp-step-`

---

## Push Notification System
- **RC:** Empty payload — sw.js picks random message from `REALITY_CHECKS` array
- **WBTB wake:** Text payload ("WBTB wake...") — aes128gcm encrypted, `requireInteraction: true`, heavy vibrate
- **WBTB return:** Text payload ("WBTB return...") — encrypted, `requireInteraction: true`
- **Evening primer:** Text payload — encrypted, sent 30 min before bedtime
- Subscription stored in Cloudflare KV as `sub:<hash>` with 90-day TTL
- SW routes `wbtb=return` → `WBTB_RETURN` message → protocol re-entry

## Cloudflare Worker Routes
- `POST /rv-assign`, `POST /grade`, `POST /tag-dream`
- `POST /subscribe`, `POST /wbtb-schedule`, `POST /wbtb-cancel`
- `POST /stripe-webhook` (updates Supabase `profiles.tier` via service credentials)
- `GET /ping`
- Cron: `*/5 * * * *` — fires `runRealityCheckCron()` and `runWBTBCron()`

## Scaling Notes
- Free Cloudflare KV tier: 1,000 list ops/day, 100,000 reads/day
- Current usage: ~288 list ops/day
- Free tier supports ~50–100 active users; $5/mo paid plan supports thousands

## Deployment
1. Merge PR on GitHub
2. `git pull origin main` locally
3. `wrangler deploy` for Worker changes
4. Version triplet bump required for app-shell changes (see top of this doc)
