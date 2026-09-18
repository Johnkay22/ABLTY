-- Usernames keep their chosen capitalization for display, but identity and
-- availability are case-insensitive.
--
-- IMPORTANT PRECONDITION: audit and resolve every existing lower(username)
-- collision before applying this migration. This file intentionally performs
-- no automatic rename, merge, or deletion. See LAUNCH-PLAN.md for the exact
-- read-only audit and rollout sequence.
--
-- The expression index is the concurrency-safe enforcement point. Unlike a
-- check-then-insert RPC, it also protects simultaneous signups, profile edits,
-- the auth trigger, and any future server/client writer.

CREATE UNIQUE INDEX profiles_username_lower_unique
  ON public.profiles ((lower(username)));

-- Replace the pending signup-trigger function as part of the same atomic
-- migration. A requested username collision must abort that auth signup
-- rather than silently assigning a different public identity. Google-created
-- accounts have no requested username and continue to receive the UUID-based
-- fallback. The index above arbitrates concurrent requests.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  desired_name    text;
  fallback_name   text;
  chosen_name     text;
  collision_name  text;
  attempt          integer := 0;
  inserted         boolean := false;
BEGIN
  desired_name := NULLIF(btrim(NEW.raw_user_meta_data ->> 'username'), '');
  IF desired_name IS NOT NULL AND desired_name !~ '^[a-zA-Z0-9_]{3,20}$' THEN
    desired_name := NULL;
  END IF;

  fallback_name := 'seeker_' || left(lower(regexp_replace(NEW.id::text, '[^a-zA-Z0-9]', '', 'g')), 8);

  IF desired_name IS NOT NULL THEN
    -- Requested names never fall back. A case-insensitive collision aborts
    -- the auth.users transaction atomically and unrelated errors propagate.
    INSERT INTO public.profiles (id, username, tier)
    VALUES (NEW.id, desired_name, 'free')
    ON CONFLICT (id) DO NOTHING;
    inserted := true;
  ELSE
    chosen_name := fallback_name;
    WHILE NOT inserted AND attempt < 5 LOOP
      attempt := attempt + 1;
      BEGIN
        INSERT INTO public.profiles (id, username, tier)
        VALUES (NEW.id, chosen_name, 'free')
        ON CONFLICT (id) DO NOTHING;
        inserted := true;
      EXCEPTION WHEN unique_violation THEN
        GET STACKED DIAGNOSTICS collision_name = CONSTRAINT_NAME;
        IF collision_name NOT IN ('profiles_username_lower_unique', 'profiles_username_key') THEN
          RAISE;
        END IF;
        chosen_name := 'seeker_' || left(md5(random()::text || clock_timestamp()::text || NEW.id::text), 8);
      END;
    END LOOP;
  END IF;

  IF NOT inserted THEN
    RAISE WARNING 'handle_new_user: could not find a free generated username for user % after % attempts; leaving profile creation to the client bootstrap',
      NEW.id, attempt;
  END IF;

  INSERT INTO public.user_settings (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user() IS
  'Creates profile/settings after auth signup. Requested username collisions abort atomically; provider accounts retry bounded generated names on username-only collisions.';

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.username_is_taken(check_username text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE lower(username) = lower(check_username)
  );
$$;

COMMENT ON FUNCTION public.username_is_taken(text) IS
  'Signup availability check. Case-insensitive match against profiles.username, identical to profiles_username_lower_unique. Returns only a boolean.';

REVOKE ALL ON FUNCTION public.username_is_taken(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.username_is_taken(text) TO anon, authenticated, service_role;
