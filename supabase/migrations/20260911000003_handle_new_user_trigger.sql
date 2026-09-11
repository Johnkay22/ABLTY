-- Task 0.1(a): create public.profiles and public.user_settings for every new
-- auth.users row, server-side, so an interrupted signup can never leave an
-- auth account with no profile.
--
-- *** ROLLOUT ORDER MATTERS. APPLY THIS LAST, AFTER THE NEW app.html IS LIVE. ***
--
-- The app.html shipped before 2026.09.11.1 records legal acceptance only when
-- IT creates the profile row (inside `if (!profile)` in onSignedIn). If this
-- trigger is active while that old code is still what users have, the trigger
-- creates the row first, the old code sees a profile, skips the legal write,
-- and consent is silently never recorded. The 2026.09.11.1 app patches the
-- legal fields onto an existing profile when they are null, so once it is live
-- this trigger is safe. Sequence: 20260911000001 and 20260911000002 -> merge
-- and confirm app.html 2026.09.11.1 is serving -> this file.
--
-- Behaviour:
--   * Username comes from raw_user_meta_data.username (set by handleSignup via
--     signUp({ options: { data: { username } } })). It is accepted only if it
--     satisfies the same rule as the DB check constraints and validateUsername:
--     ^[a-zA-Z0-9_]{3,20}$. Anything else (Google sign-in has no username, or a
--     forged value) goes straight to the fallback.
--   * Fallback is 'seeker_' + the first 8 alphanumerics of the user id,
--     lowercased. This is byte-for-byte what onSignedIn's fallbackUsername
--     computes, so the trigger and the client always agree on the name.
--   * The fallback is used for a taken username ONLY in the race case: the
--     signup form has already asked username_is_taken() before signUp, so a
--     collision here means two signups collided between the check and the
--     insert. If even the id-derived fallback is taken, a few random
--     seeker_<8 hex> names are tried.
--   * Only unique_violation is caught, and only on the username path
--     (a duplicate id is absorbed by ON CONFLICT (id) DO NOTHING before it can
--     raise). Any other error propagates and fails the auth insert loudly,
--     which is what the launch plan asks for: do not swallow unrelated errors.
--   * If every username attempt collides (practically impossible), the profile
--     is left uncreated with a WARNING in the Postgres log, the auth insert
--     still succeeds, and onSignedIn's existing client-side bootstrap creates
--     the profile on first sign-in exactly as it does today.
--   * user_settings gets a row with all defaults, ON CONFLICT DO NOTHING.
--
-- Security:
--   * SECURITY DEFINER, owned by the migration role (postgres, BYPASSRLS), so
--     the inserts are not blocked by the own-row RLS policies. The insert into
--     auth.users runs as supabase_auth_admin, which has no rights on public.*.
--   * search_path pinned to '' and everything schema-qualified.
--   * Not callable by clients: EXECUTE is revoked from PUBLIC and the client
--     roles. Trigger functions run as the trigger owner regardless.
--
-- The two existing BEFORE UPDATE triggers on profiles (tier lock, rename
-- cooldown) never see this INSERT, so they are unaffected.
--
-- Rollback: DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
-- The client bootstrap path in onSignedIn remains in place, so dropping the
-- trigger returns signup to today's behaviour with no other change.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  desired_name   text;
  fallback_name  text;
  chosen_name    text;
  attempt        integer := 0;
  inserted       boolean := false;
BEGIN
  desired_name := NULLIF(btrim(NEW.raw_user_meta_data ->> 'username'), '');
  IF desired_name IS NOT NULL AND desired_name !~ '^[a-zA-Z0-9_]{3,20}$' THEN
    desired_name := NULL;
  END IF;

  fallback_name := 'seeker_' || left(lower(regexp_replace(NEW.id::text, '[^a-zA-Z0-9]', '', 'g')), 8);

  chosen_name := COALESCE(desired_name, fallback_name);

  WHILE NOT inserted AND attempt < 5 LOOP
    attempt := attempt + 1;
    BEGIN
      INSERT INTO public.profiles (id, username, tier)
      VALUES (NEW.id, chosen_name, 'free')
      ON CONFLICT (id) DO NOTHING;
      inserted := true;
    EXCEPTION
      WHEN unique_violation THEN
        -- Reachable only for profiles_username_key: the same-second race the
        -- launch plan describes. Step down: desired -> id-derived fallback ->
        -- random seeker names.
        IF chosen_name <> fallback_name THEN
          chosen_name := fallback_name;
        ELSE
          chosen_name := 'seeker_' || left(md5(random()::text || clock_timestamp()::text), 8);
        END IF;
    END;
  END LOOP;

  IF NOT inserted THEN
    RAISE WARNING 'handle_new_user: could not find a free username for user % after % attempts; leaving profile creation to the client bootstrap',
      NEW.id, attempt;
  END IF;

  INSERT INTO public.user_settings (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user() IS
  'AFTER INSERT ON auth.users: creates profiles + user_settings with ON CONFLICT DO NOTHING. Username from raw_user_meta_data.username, seeker_<8> fallback only on a uniqueness race. Never fails the auth insert for a username collision.';

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
