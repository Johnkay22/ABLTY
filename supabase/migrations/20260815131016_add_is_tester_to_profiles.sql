-- RECORD OF AN ALREADY-APPLIED MIGRATION. Added to the repo by task 0.1(d)
-- (2026-09-11) so `supabase/migrations` is a full record of the live database.
--
-- Live `supabase_migrations.schema_migrations` has version 20260815131016
-- "add_is_tester_to_profiles". Reconstructed on 2026-09-11 from the live
-- column and the live definition of enforce_profiles_tier_lock(). Do NOT run
-- it against production through `apply_migration`: the version is already
-- recorded there. Idempotent so a fresh database built from this folder
-- matches live.
--
-- This migration is why the live enforce_profiles_tier_lock() differs from
-- the copy in 20260519000003: it re-creates the function so that is_tester,
-- like tier, can only be changed by the service role. The client never writes
-- is_tester; testers are provisioned with the SQL in LAUNCH-PLAN.md.
--
-- The function is reproduced exactly as it is live. It is NOT SECURITY DEFINER
-- and still has a mutable search_path (Supabase advisor WARN, logged in
-- LAUNCH-PLAN.md DISCOVERED ISSUES). The launch plan says to fix that when
-- these functions are next changed for real, not in a record-only file.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_tester boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.enforce_profiles_tier_lock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tier IS DISTINCT FROM OLD.tier
     AND current_user IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'profiles.tier can only be changed by the service role'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.is_tester IS DISTINCT FROM OLD.is_tester
     AND current_user IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'profiles.is_tester can only be changed by the service role'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;
