-- RECORD OF AN ALREADY-APPLIED MIGRATION. Added to the repo by task 0.1(d)
-- (2026-09-11) so `supabase/migrations` is a full record of the live database.
--
-- Live `supabase_migrations.schema_migrations` has version 20260322070144
-- "add_profiles_insert_policy". The original SQL was run from the dashboard and
-- never committed; this file was reconstructed from the live policy definition
-- on 2026-09-11. Do NOT run it against production through `apply_migration`:
-- the version is already recorded there. It is written idempotently so that a
-- fresh database built from this folder ends up in the same state as live.
--
-- The `profiles` table itself predates the migration history (dashboard-created)
-- and is still not tracked here; see DISCOVERED ISSUES in LAUNCH-PLAN.md.

DROP POLICY IF EXISTS "Users insert own profile" ON public.profiles;
CREATE POLICY "Users insert own profile" ON public.profiles
  FOR INSERT TO public
  WITH CHECK ((SELECT auth.uid()) = id);
