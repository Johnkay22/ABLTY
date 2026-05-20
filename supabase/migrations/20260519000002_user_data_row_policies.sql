-- Part 2B: Per-user row policies for user-data tables.
--
-- The live audit (2026-05-19) found these dashboard-created policies already
-- present and correct, so this migration ONLY adds the missing commands and
-- does NOT recreate or alter the existing ones:
--
--   dream_entries : SELECT/INSERT/UPDATE/DELETE own  -> already complete
--   user_settings : SELECT/INSERT/UPDATE own         -> add DELETE
--   rv_sessions   : SELECT/INSERT/DELETE own (+public community SELECT) -> add UPDATE
--   pp_sessions   : SELECT/INSERT own                -> add UPDATE, DELETE
--   ts_trials     : SELECT/INSERT own                -> add UPDATE, DELETE
--   zener_runs    : SELECT/INSERT own                -> add UPDATE, DELETE
--   profiles      : SELECT/INSERT/UPDATE own         -> add DELETE only
--
-- profiles.UPDATE is deliberately NOT (re)created here. An existing dashboard
-- policy ("Users update own profile") already permits self-updates while
-- blocking tier changes via a WITH CHECK subquery. Postgres ORs permissive
-- policies together, so adding a second unguarded UPDATE policy would WEAKEN
-- that tier protection. Tier enforcement is owned by the BEFORE UPDATE trigger
-- in migration 20260519000003 regardless of which policy admits the row.
--
-- All policies below use the "sec_" prefix and DROP IF EXISTS + CREATE so the
-- migration is idempotent and never collides with dashboard policy names.

-- profiles: DELETE own row (user-id column is `id`)
DROP POLICY IF EXISTS "sec_profiles_delete_own" ON public.profiles;
CREATE POLICY "sec_profiles_delete_own" ON public.profiles
  FOR DELETE TO authenticated
  USING (auth.uid() = id);

-- user_settings: DELETE own
DROP POLICY IF EXISTS "sec_user_settings_delete_own" ON public.user_settings;
CREATE POLICY "sec_user_settings_delete_own" ON public.user_settings
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- rv_sessions: UPDATE own
DROP POLICY IF EXISTS "sec_rv_sessions_update_own" ON public.rv_sessions;
CREATE POLICY "sec_rv_sessions_update_own" ON public.rv_sessions
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- pp_sessions: UPDATE + DELETE own
DROP POLICY IF EXISTS "sec_pp_sessions_update_own" ON public.pp_sessions;
CREATE POLICY "sec_pp_sessions_update_own" ON public.pp_sessions
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "sec_pp_sessions_delete_own" ON public.pp_sessions;
CREATE POLICY "sec_pp_sessions_delete_own" ON public.pp_sessions
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- ts_trials: UPDATE + DELETE own
DROP POLICY IF EXISTS "sec_ts_trials_update_own" ON public.ts_trials;
CREATE POLICY "sec_ts_trials_update_own" ON public.ts_trials
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "sec_ts_trials_delete_own" ON public.ts_trials;
CREATE POLICY "sec_ts_trials_delete_own" ON public.ts_trials
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- zener_runs: UPDATE + DELETE own
DROP POLICY IF EXISTS "sec_zener_runs_update_own" ON public.zener_runs;
CREATE POLICY "sec_zener_runs_update_own" ON public.zener_runs
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "sec_zener_runs_delete_own" ON public.zener_runs;
CREATE POLICY "sec_zener_runs_delete_own" ON public.zener_runs
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
