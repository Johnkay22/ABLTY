-- Part 2C: Lock down profiles.tier at the database level.
--
-- DECISION (approved 2026-05-19): lock ONLY `tier`. The four legal columns
-- (terms_accepted_at, terms_version, privacy_accepted_at, privacy_version) are
-- intentionally EXCLUDED from this lockdown because client code writes them
-- with the anon key during the profile-bootstrap upsert in
-- app.html (onSignedIn, ~line 12053). Locking them now would break consent
-- recording for users whose profile row already exists.
--
-- TODO(future PR): move the legal-acceptance write (terms_accepted_at,
-- terms_version, privacy_accepted_at, privacy_version) to a server-side
-- Worker endpoint that uses the Supabase service role, then extend this
-- trigger to also reject client writes to those four columns.
--
-- `tier` already has a DB DEFAULT of 'free', so brand-new signups (INSERT,
-- which this BEFORE UPDATE trigger never sees) continue to work unchanged.
--
-- Role detection: PostgREST runs requests as `anon` (anon key) or
-- `authenticated` (user JWT). The Worker's Stripe path uses the service key,
-- which runs as `service_role`. Migrations run as a superuser/owner role.
-- We reject a tier change only when the effective role is a client role.
-- Idempotent: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS.

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
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_protect_tier ON public.profiles;
CREATE TRIGGER trg_profiles_protect_tier
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_profiles_tier_lock();
