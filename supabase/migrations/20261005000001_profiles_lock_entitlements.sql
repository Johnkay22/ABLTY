-- Pre-beta step 6: Premium and tester status can only ever be set by the
-- server.
--
-- What was true before this migration (live state read on 2026-10-05):
--   * trg_profiles_protect_tier (BEFORE UPDATE) rejected a client change to
--     `tier` or `is_tester`, and the "Users update own profile" policy
--     repeats the `tier` check. UPDATE was covered.
--   * INSERT was not. "Users insert own profile" only checks the id, so a
--     client holding a user JWT could create its own profile row with
--     tier = 'premium' or is_tester = true. The signup trigger normally
--     creates the row first, but the client was also allowed to DELETE its
--     own profile row ("sec_profiles_delete_own", plus the DELETE grant), so
--     delete-then-reinsert-as-premium was open to any signed-in user.
--
-- What this migration does:
--   1. Replaces enforce_profiles_tier_lock() with one body that runs on
--      INSERT and UPDATE. For the client roles (anon, authenticated) it
--      rejects an INSERT whose protected columns are not at their defaults
--      (tier 'free', is_tester false) and an UPDATE that changes any of
--      them. Other roles (service_role for the Worker's Stripe path and
--      administrative grants, postgres for migrations, the SECURITY DEFINER
--      signup trigger handle_new_user which runs as its owner) are not
--      affected. The protected list already names `beta_premium_until`, the
--      entitlement column step 8 will add: a listed column that does not
--      exist yet is skipped, so it is protected the moment it is created
--      without a further change here.
--   2. Adds the BEFORE INSERT trigger and recreates the BEFORE UPDATE one so a
--      fresh database built from this folder matches live.
--   3. Removes the client's ability to delete profile rows: the policy and
--      the DELETE grant for anon and authenticated. The app never deletes a
--      profile row (checked: app.html has no profiles delete); account
--      deletion is done by the Worker's handleDeleteAccount with the service
--      key, which keeps DELETE. TRUNCATE is revoked from the client roles at
--      the same time: it is not subject to row-level security and no client
--      path uses it.
--
-- Legitimate paths, all unchanged in behaviour:
--   * Signup: handle_new_user inserts (id, username, 'free') as its owner.
--   * The app's fallback profile creation upserts {id, username, tier:'free',
--     legal fields} only when no row exists. tier 'free' and the default
--     is_tester pass the INSERT check. If the row appeared meanwhile, the
--     upsert becomes an UPDATE that leaves tier as it was and passes.
--   * Username change and legal-acceptance writes are UPDATEs that do not
--     touch protected columns.
--   * Worker Stripe webhook: PATCH tier with the service key.
--   * Administrative grants of tier / is_tester through the service role.
--
-- The function is now SET search_path = '' (the Supabase advisor warning
-- recorded in LAUNCH-PLAN.md; the plan said to fix it when the function was
-- next changed for real). It is deliberately NOT SECURITY DEFINER: the check
-- is on current_user, which must be the caller's role, not the owner's.
--
-- Idempotent: CREATE OR REPLACE, DROP ... IF EXISTS, REVOKE is a no-op when
-- the privilege is already absent.
--
-- Rollback (restores the pre-migration state exactly):
--   DROP TRIGGER IF EXISTS trg_profiles_protect_tier_insert ON public.profiles;
--   re-run supabase/migrations/20260815131016_add_is_tester_to_profiles.sql
--     (recreates the UPDATE-only function body);
--   re-run the "sec_profiles_delete_own" policy from 20260519000002;
--   GRANT DELETE, TRUNCATE ON public.profiles TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.enforce_profiles_tier_lock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  -- Column -> the only value a client-created row may carry. Must match the
  -- column defaults. A listed column that the table does not have yet is
  -- skipped.
  protected CONSTANT jsonb := '{"tier": "free", "is_tester": false, "beta_premium_until": null}'::jsonb;
  new_row jsonb := to_jsonb(NEW);
  old_row jsonb;
  col text;
BEGIN
  -- PostgREST runs client requests as anon (anon key) or authenticated (user
  -- JWT). Everything else is server-side.
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    old_row := to_jsonb(OLD);
  END IF;

  FOR col IN SELECT jsonb_object_keys(protected) LOOP
    CONTINUE WHEN NOT (new_row ? col);
    IF TG_OP = 'INSERT' THEN
      IF (new_row -> col) IS DISTINCT FROM (protected -> col) THEN
        RAISE EXCEPTION 'profiles.% can only be set by the service role', col
          USING ERRCODE = 'insufficient_privilege';
      END IF;
    ELSIF (new_row -> col) IS DISTINCT FROM (old_row -> col) THEN
      RAISE EXCEPTION 'profiles.% can only be changed by the service role', col
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_profiles_tier_lock() IS
  'BEFORE INSERT OR UPDATE ON profiles: for anon/authenticated, tier, is_tester and (when present) beta_premium_until must be at their defaults on INSERT and unchanged on UPDATE. Server roles are not restricted.';

DROP TRIGGER IF EXISTS trg_profiles_protect_tier ON public.profiles;
CREATE TRIGGER trg_profiles_protect_tier
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_profiles_tier_lock();

DROP TRIGGER IF EXISTS trg_profiles_protect_tier_insert ON public.profiles;
CREATE TRIGGER trg_profiles_protect_tier_insert
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_profiles_tier_lock();

-- Clients may not delete profile rows. The Worker deletes with the service
-- key, which keeps its grant.
DROP POLICY IF EXISTS "sec_profiles_delete_own" ON public.profiles;
REVOKE DELETE, TRUNCATE ON public.profiles FROM anon, authenticated;
