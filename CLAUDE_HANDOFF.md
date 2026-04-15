# ABLTY Claude Code Handoff

## What is ABLTY?
A PWA for lucid dreaming and psi research. Single-page app (`app.html`, ~14,000 lines), vanilla JS, no framework. Cloudflare Workers backend (`ablty-worker.js`) with KV storage. Supabase for auth/cloud sync. Service worker (`sw.js`) for offline + push notifications.

## Architecture
- **Frontend:** `app.html` — all HTML, CSS, JS in one file
- **Backend:** `ablty-worker.js` — Cloudflare Worker, deployed via `wrangler deploy`
- **Config:** `wrangler.toml` — worker name, KV binding, cron trigger (`*/5 * * * *`)
- **Service Worker:** `sw.js` — cache strategy, push notification handling, WBTB notification routing
- **Version:** `version.json` — current `"2026.04.13.1"`, also `APP_VERSION` in app.html and `CACHE_NAME` in sw.js (3 places to bump)

## Git Branch
- Development branch: `claude/review-ablty-codebase-zX4b0`
- GitHub repo: `johnkay22/ablty` (Johnkay22/ABLTY)
- Always push to this branch, create PRs to merge into `main`

## App Modules
- **Remote Viewing (RV):** Sketch-based ESP test, AI-graded via Gemini API
- **Zener Cards:** Classic 25-trial ESP card test
- **Presentiment (Timestamp):** Precognitive timing test — tap before random event
- **Photo Pair:** Binary forced-choice emotional valence test
- **Dream Journal:** Cloud-synced dream entries with AI tagging (Gemini), lucidity tracking
- **Dream Insights:** Analytics screen — lucidity rate, recall trend, streak, vividness, emotion breakdown, dream sign correlations
- **WBTB Timer:** Wake Back To Bed — schedules push notification alarm after 4.5-7.5h sleep, then 25-min return reminder
- **Reality Checks:** Periodic push notifications throughout the day to prompt lucid dreaming awareness
- **Stats:** Combined session history/logs for all module types

## Current Open Issue — Reality Checks Not Firing (April 15, 2026)
User reports no RC notifications received today. Possible causes:
1. **KV list limit was exceeded yesterday** (4,320 ops/day on 1,000 free tier). Limit resets at midnight UTC. Should be resolved now but needs verification.
2. **Cron was changed from `* * * * *` to `*/5 * * * *`** — both in wrangler.toml AND Cloudflare dashboard. User confirmed dashboard shows `*/5`.
3. **Push subscription may need re-registration** — opening the app should trigger this.
4. **Need to check Cloudflare Worker logs** to see if cron is firing and what `shouldSendNow()` returns.

### Debugging Steps
- Have user check Cloudflare Worker → Logs for `scheduled` handler invocations
- Check if `sub:` prefix keys exist in KV (the push subscription)
- Check `last:` and `sends:` keys to see last send timestamps
- The `shouldSendNow()` function (line ~645 in source) uses probabilistic scheduling with a 30-minute minimum gap, 7 AM start, and bedtime-30min end window

## Recent Changes (all merged except where noted)
### PR #44 — Dream Insights screen (merged)
### PR #45 — Remove dream signs from journal list (merged)
### PR #46 — WBTB cron logging + wrangler.toml cron trigger (merged)
### PR #47 — WBTB stop button, layout, vibration, 1-min test hardcode (merged)
### PR #48 — Revert 1-minute test hardcode (merged)
### PR #49 — Multiple fixes (merged)
- WBTB start button moved into content flow (was pinned to bottom, off-screen)
- RV impressions leaking into Zener/PP/Presentiment detail views — fixed by hiding `detail-notes-card`, `detail-retry-card`, `detail-reasoning-card` in non-RV renderers
- Presentiment detail now shows timing metric ("X.Xs between tap and event")
- Cron changed to `*/5 * * * *` (was `* * * * *`, causing 4,320 KV list ops/day)
- RC minimum gap increased from 20 to 30 minutes
- WBTB alarms consolidated into single `wbtb-alarms` KV key (eliminates 2 of 3 list ops per cron)

## Key Code Locations (ablty-worker.js source line numbers)
- `scheduled()` handler: ~148
- `runRealityCheckCron()`: ~571
- `sendToAll()`: ~575 — iterates subscribers, checks primer window, then `shouldSendNow()`
- `shouldSendNow()`: ~645 — probabilistic RC scheduling, 30-min minGap, bedtime window
- `isEveningPrimerWindow()`: ~708 — sends "Tonight you will notice..." before bedtime
- `handleWBTBSchedule()`: ~1018 — stores alarms in single `wbtb-alarms` key
- `handleWBTBCancel()`: ~1058
- `runWBTBCron()`: ~1073 — reads `wbtb-alarms` key, fires due alarms
- `handleSubscribe()`: ~1134 — stores push sub as `sub:<base64-endpoint-hash>`
- `sendVapidPush()`: ~1167 — VAPID JWT + aes128gcm encryption for text payloads
- `encryptPushPayload()`: ~1148 — RFC 8291 Web Push encryption

## Key Code Locations (app.html approximate line numbers)
- CSS styles: ~1-3200
- Screen HTML: ~3200-14000
- WBTB screen HTML: ~13932
- WBTB JS (`startWBTB`, `stopWBTB`): ~7750-7860
- Dream Insights (`renderDreamInsights`): ~8609
- Session detail renderers: ~10202-10499
  - `openSessionDetail()`: ~10202 — routes by type
  - `renderPPDetail()`: ~10229
  - `renderTSDetail()`: ~10273
  - `renderRVDetail()`: ~10319
  - `renderZenerDetail()`: ~10446
- Combined log (`buildCombinedLog`): ~10064
- `APP_VERSION`: ~12207

## Push Notification System
- **RC (Reality Check):** Empty payload push — sw.js picks random message from `REALITY_CHECKS` array. No encryption needed.
- **WBTB wake:** Text payload ("WBTB wake. Xh sleep complete...") — requires aes128gcm encryption. `requireInteraction: true`, heavy vibrate pattern.
- **WBTB return:** Text payload ("WBTB return...") — encrypted, `requireInteraction: true`, lighter vibrate.
- **Evening primer:** Text payload ("Tonight you will notice...") — encrypted, sent 30 min before bedtime.
- Subscription stored in KV as `sub:<hash>` with 90-day TTL
- Stale subscriptions cleaned up on 410 response from push service

## Scaling Notes
- Free Cloudflare KV tier: 1,000 list ops/day, 100,000 reads/day
- Current usage: ~288 list ops/day (1 per cron × 288 crons)
- Each subscriber adds ~3 KV reads per cron run
- Free tier supports ~50-100 active users
- $5/month paid plan supports thousands (10M reads, 1M lists)

## Deployment
1. Merge PR on GitHub
2. `git pull origin main` locally
3. `wrangler deploy` to push to Cloudflare
4. Cron trigger must also be set in Cloudflare dashboard (wrangler.toml only applies on deploy)
5. Version bump: update `APP_VERSION` in app.html, `version` in version.json, `CACHE_NAME` in sw.js
