# ABLTY WBTB Re-Entry Protocol — Launch Status

Last updated: 2026-06-19

## Feature Status

| PR | Feature | Status |
|---|---|---|
| #93 | D-1: Protocol shell + Step 1 Dream Capture | Merged |
| #94 | D-2: Step 2 Wake Calibration | Merged |
| #95 | D-3a: Step 7 Morning Sync modal | Merged |
| #96 | D-4: Final step order (1→2→3→4→5→6→7) | Merged |
| #97 | D-6: Step 5 Intention Setting (MILD presets + custom) | Merged |
| #98 | D-5: Step 4 Lucidity Reading + `lucidity_readings` table | Merged |
| #99 | D-7a: Analytics — `completion_state` writes + exit tracking | Merged |
| #100 | D-7b: Premium gate cards for Steps 3 and 4 | Merged |

**Feature code: COMPLETE.** All 7 steps implemented, DB schema live, premium gates active.

---

## Pre-Launch Checklist

### Must-fix before public
- [ ] **Gate the 5-tap dev skip** — there is a dev shortcut in the protocol flow that skips steps. Suggested fix: wrap in `if (localStorage.getItem('ablty_dev'))` check. Until this is gated, any user who taps 5 times can skip the protocol.
- [ ] **10+ readings in `lucidity_readings`** — only 3 placeholder rows exist. Add via Supabase dashboard (no code deploy). Free users never see these (RLS blocks them), but premium users hit the 3-item rotation quickly.

### QA before public
- [ ] Verify Step 3 (RC Drill) is hidden for free accounts and shown for premium
- [ ] Verify Step 4 (Lucidity Reading) is hidden for free accounts and shown for premium
- [ ] Verify "Skip this step" on gate cards advances correctly (free user skips 3 → lands on 4 → sees gate again; free user skips both → lands on Step 5)
- [ ] Verify `gated_skip_3` and `gated_skip_4` appear in `wbtb_sessions.completion_state` on Supabase for a free test account
- [ ] Verify all 3 Step 2 paths (A: normal, B: groggy, C: no recall) produce valid Dream Lab entries
- [ ] Verify Step 7 Morning Sync correctly updates the previous night's `wbtb_sessions` row (not creating a new one)
- [ ] Verify protocol resumes correctly after app background/foreground (localStorage state machine)
- [ ] Verify morning sync modal appears on app open when `pendingSync: true`

### Nice-to-have follow-ups (not blocking)
- [ ] Dim/warm CSS styling for Step 4 reading wrap (sleep-onset ergonomics) — TODO comment in code on `.rp-s4-reading-wrap`
- [ ] Per-step analytics dashboard (track drop-off rates by `completion_state`)
- [ ] Reading content: 10–15 original pieces across categories (`mild`, `biology`, `reality-check`)

---

## Protocol Step Reference

| Step | ID | Description | Gate | Wake Lock |
|---|---|---|---|---|
| 1 | `rp-step-1` | Dream Capture | None | Yes |
| 2 | `rp-step-2` | Wake Calibration | None | Yes |
| 3 | `rp-step-3` | RC Drill (3 checks) | Premium | Yes |
| 4 | `rp-step-4` | Lucidity Reading | Premium | Yes |
| 5 | `rp-step-5` | Intention Setting (MILD) | None | Yes |
| 6 | `rp-step-6` | Wind-Down | None | No (released) |
| 7 | `rp-step-7` / modal | Morning Sync | None | — |

---

## DB Tables (added for this feature)

**`wbtb_sessions`** — migration `20260612000001_wbtb_sessions.sql`
- Columns: `id`, `user_id`, `created_at`, `duration_hours`, `started_at`, `completed_at`, `alarm_time`, `path_taken` (A/B/C), `intention`, `reading_id_shown`, `completion_state` (free-text, last-write-wins), `protocol_completed_at`, `reported_sleep_onset`, `outcome`, `outcome_description`
- RLS: own rows only

**`lucidity_readings`** — migration `20260613000001_lucidity_readings.sql`
- Columns: `id`, `title`, `author`, `source_citation`, `body_text`, `category`, `est_read_time_seconds`
- RLS: premium SELECT only — free/guest get empty array with no error
- Currently seeded: 3 placeholder rows (The Moment You're Looking For, Second Sleep, The Signal in the Strange)

---

## completion_state Values

| Value | Meaning | Success? |
|---|---|---|
| `started` | Row created, no step done | No |
| `completed_step_1` – `completed_step_5` | Genuine per-step completion | Partial |
| `wound_down` | Step 6 done — overnight run complete | **Yes** |
| `synced` | Morning sync done | **Yes** |
| `exited_at_step_N` | Explicit quit at step N | No |
| `gated_skip_3` | Free user skipped Step 3 | No |
| `gated_skip_4` | Free user skipped Step 4 | No |
