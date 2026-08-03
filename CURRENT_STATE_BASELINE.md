# ABLTY Current-State Baseline (Source of Truth)

Last updated: 2026-06-19

This document is the practical "safe edit map" for the current codebase.
Use it before making feature changes to avoid regressions.

## 1) Repository map (live)

- `app.html`  
  Main runtime app. Contains screens, routing, auth, sync, analytics, push/update logic, and module behavior.
- `index.html`  
  Landing/install page (marketing + PWA install flow + legal modal content).
- `ablty-worker.js`  
  Cloudflare Worker backend (RV assignment, grading, tagging, push, WBTB, Stripe webhook).
- `sw.js`  
  Service worker (cache strategy, update messaging, push notification click handling).
- `version.json`  
  Manifest version used by in-app update detection.
- Ops docs:
  - `CHANGELOG.md`
  - `RELEASE_CHECKLIST.md`
  - `MOBILE_QA_CHECKLIST.md`
  - `KNOWN_ISSUES.md`
  - `CLAUDE_HANDOFF.md` — Claude Code session context, WBTB feature status, launch checklist

## 2) App architecture (high-level)

ABLTY is a local-first PWA with optional cloud sync:

1. User interacts in `app.html`.
2. Sessions save locally immediately.
3. If logged in, sessions sync to Supabase tables.
4. RV grading + dream tagging + push/WBTB orchestration happen via Cloudflare Worker.

### Core pattern
- UI render and logic are function-driven (single-file architecture).
- Navigation uses `navigate(name)` + `showScreen(name, hideNav)`.
- Analytics are rendered from merged local/cloud session data.

## 3) Screen and module map (active)

Primary screens:
- Home
- RV: brief -> canvas -> results
- PSI hub:
  - Zener: brief/session/results
  - Presentiment: brief/session/results
- Dream:
  - Dream Lab
  - Dream Journal (home/new/detail)
  - Reality Check (settings/info + live check task screen)
  - WBTB timer + wake flow
  - WBTB Re-Entry Protocol (7-step guided overnight protocol — see CLAUDE_HANDOFF.md)
- Analytics
- Profile/Settings
- Terms / Privacy
- Auth overlays: login/signup/forgot

Bottom nav currently maps to:
- Home
- RV
- PSI (Training)
- Dream Lab
- Analytics (Stats)

## 4) Access and tier model

Tier cache:
- `ablty_tier` in localStorage (`guest`, `free`, `premium`)

Access map (function-level):
- Guest allowed: RV, Zener (limited)
- Free/Premium: timestamp, dream-lab, dream journal, RC, analytics, WBTB
- Premium-only features: RC Drill (Step 3) and Lucidity Reading (Step 4) of WBTB Re-Entry Protocol; expanded access paths (example: export unlock)
- Free users see inline gate cards on premium steps with upgrade CTA + skip option

RV daily limit:
- Limit applies only if NOT premium and NOT dev mode.

## 5) Data persistence and sync model

Local-first keys (non-exhaustive):
- RV: `STATE.sessions`, `ablty_rv_cloud_cache`
- Zener: `ablty_zener`, `ablty_zener_cloud_cache`
- Presentiment: `ablty_timestamp`, `ablty_timestamp_all`, `ablty_ts_cloud_cache`, `ablty_ts_pending`
- Dream: in-memory state + Supabase `dream_entries`
- WBTB Re-Entry Protocol: `ablty_wbtb_protocol` (active session state machine)
- Auth profile cache: `ablty_logged_in`, `ablty_username`, `ablty_tier`, `ablty_user_email`

Cloud merge behavior:
- `loadAnalyticsFromCloud()` pulls cloud rows, merges with local by key and timestamp preference.
- Pending queues are reconciled and cleared after durable merge.

## 6) Backend (Cloudflare Worker) contract

Live routes:
- `POST /rv-assign`
- `POST /grade`
- `POST /tag-dream`
- `POST /subscribe`
- `POST /wbtb-schedule`
- `POST /wbtb-cancel`
- `POST /stripe-webhook`
- `GET /ping`

Notable behavior:
- RV target pool is server-side (blind protocol integrity).
- RV grading via Gemini; failures return safe "grading_failed" payload.
- Dream tagging returns normalized array (or `[]` on failure).
- Stripe webhook updates Supabase `profiles.tier` using service credentials.
- KV-backed rate limits and schedule state.

## 7) Service worker and update flow

Current SW:
- `CACHE_NAME = ablty-v53`
- Static cached assets include `/`, `/app.html`, `/version.json`

In-app update logic:
- `APP_VERSION` in `app.html` compared to `/version.json`.
- SW `UPDATE_READY` message can trigger update banner.
- `applyUpdate()` posts `SKIP_WAITING` and reloads.

Current version: `2026.06.15.1`

Important release rule:
- Bump all three together: `APP_VERSION` in app.html, `version` in version.json, `CACHE_NAME` in sw.js.

## 8) Presentiment analytics (current intent)

`buildPresentimentStats()` currently uses a compound gate for signal tiering:
- Confidence
- Timing advantage vs randomized baseline
- Trial count
- Strict hit rate

Strong tier intentionally requires all metrics to be meaningfully above chance together.

## 9) Supabase tables (active)

| Table | Purpose | RLS |
|---|---|---|
| `auth.users` | Supabase built-in auth | — |
| `profiles` | `id = auth.uid()`, `tier` field; tier is write-protected (BEFORE UPDATE trigger — only service_role can change it) | own row |
| `dream_entries` | Dream journal entries with AI tags | own rows |
| `wbtb_sessions` | One row per Re-Entry Protocol run; tracks `completion_state`, `path_taken`, `intention`, `reading_id_shown`, outcome | own rows |
| `lucidity_readings` | Short reading pieces shown at Step 4; currently 3 placeholder rows — needs 10+ real pieces | premium SELECT only (free/guest → empty array, no error) |

Migrations: `supabase/migrations/` — applied in chronological order.

## 10) Known risk hotspots

1. `app.html` is large (~16,500 lines) and tightly coupled — high regression risk from unrelated edits.
2. Version drift risk if `APP_VERSION`, `version.json`, and SW `CACHE_NAME` are not bumped together.
3. Production debug residue can be left behind during tuning (example: analytics gate logging).
4. Many flows are interdependent (auth cache, tier gating, sync, analytics rendering).
5. WBTB Re-Entry Protocol has a dev skip shortcut — must be gated or removed before public launch (see CLAUDE_HANDOFF.md launch checklist).

## 11) Safe edit guardrails (recommended)

Before changing behavior:
1. Identify exact function(s) and screen IDs touched.
2. Avoid broad search/replace in `app.html`.
3. Preserve data key names unless migration is intentional.
4. Run syntax check on extracted script after edits.
5. Smoke test on installed PWA flow (not browser tab only) for update/auth/persistence.

After changing behavior:
1. Validate module-specific flow.
2. Validate analytics log filters/sort.
3. Validate reopen persistence.
4. Validate update banner logic if app shell changed.

## 12) Quick smoke checklist (minimum)

- Open from home-screen icon.
- Run 1 trial/session in RV, Zener, Presentiment.
- Confirm entries appear in Analytics Log with correct filters.
- Force close and reopen; confirm data still present.
- Check profile tier and upgrade CTA behavior.
- If release touched app shell, verify update banner/refresh path.

