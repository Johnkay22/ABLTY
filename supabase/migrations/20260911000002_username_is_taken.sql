-- Task 0.1(c): an anon-callable function that answers only whether a username
-- is already taken.
--
-- Why: the signup form used to query `profiles` directly with the anon key. The
-- SELECT policy on profiles is own-row only (auth.uid() = id), and auth.uid()
-- is NULL for anon, so that query always returned zero rows and every name
-- looked available. Collisions only surfaced later, when onSignedIn fell back
-- to `seeker_<8 chars>`.
--
-- Matching rule: exact, case-sensitive equality. This deliberately mirrors the
-- live uniqueness rule, which is a plain UNIQUE (username) constraint
-- (profiles_username_key). If uniqueness is ever made case-insensitive, change
-- the constraint and this predicate together, never one without the other.
--
-- Security:
--   * SECURITY DEFINER so it can see all rows despite the own-row RLS policy.
--   * search_path pinned to '' and every object schema-qualified, which is the
--     safe form for SECURITY DEFINER functions (Supabase advisor 0011).
--   * Returns a boolean only. It does not list, prefix-match, or leak anything
--     beyond "taken / not taken", which public_usernames already exposes.
--   * STABLE: no writes, and the planner may cache within a statement.
--
-- Rollout: safe to apply BEFORE the new app.html ships. The old app never calls
-- it. The new app treats an error from this RPC (including "function not
-- found" if it is somehow deployed first) as "unknown" and falls through to
-- the database uniqueness constraint, so neither order can block signup.
--
-- PostgREST picks up new functions on its automatic schema reload; if the RPC
-- 404s right after applying, `NOTIFY pgrst, 'reload schema';` forces it.

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
    WHERE username = check_username
  );
$$;

COMMENT ON FUNCTION public.username_is_taken(text) IS
  'Signup availability check. Exact, case-sensitive match against profiles.username, same as the UNIQUE constraint. Returns only a boolean.';

REVOKE ALL ON FUNCTION public.username_is_taken(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.username_is_taken(text) TO anon, authenticated, service_role;
