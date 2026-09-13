-- Task 0.1(d): bring two dashboard-created objects under source control.
--
-- Both exist live but appear in no migration. The Daily Community RV Challenge
-- (post-launch parking lot item 1) depends on both, so they must be tracked.
-- This migration is idempotent. Against the live database every statement
-- re-creates what is already there, except the REVOKE on public_usernames at
-- the end, which is the one intended change: it removes write privileges that
-- client roles never needed. It is safe to apply at any point in the 0.1
-- rollout; the old and new app.html are indifferent to it (neither reads or
-- writes these objects today).
--
-- ---------------------------------------------------------------------------
-- community_rv_targets
-- ---------------------------------------------------------------------------
-- One row per calendar day. RLS is on, and the only policy is a SELECT that
-- reveals a target once its date is in the past, or once it is today's date
-- and the clock in America/Chicago has reached 23:11 (1391 minutes). There are
-- no INSERT/UPDATE/DELETE policies, so client roles cannot write even though
-- Supabase's default table grants give them the privilege: RLS with no policy
-- for a command denies it.

CREATE TABLE IF NOT EXISTS public.community_rv_targets (
  id            serial PRIMARY KEY,
  target_date   date NOT NULL UNIQUE,
  target_src    text NOT NULL,
  target_label  text NOT NULL,
  category      text,
  created_at    timestamptz DEFAULT now()
);

ALTER TABLE public.community_rv_targets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Revealed targets are public" ON public.community_rv_targets;
CREATE POLICY "Revealed targets are public" ON public.community_rv_targets
  FOR SELECT TO public
  USING (
    target_date < CURRENT_DATE
    OR (
      target_date = CURRENT_DATE
      AND (
        EXTRACT(hour   FROM (now() AT TIME ZONE 'America/Chicago')) * 60
        + EXTRACT(minute FROM (now() AT TIME ZONE 'America/Chicago'))
      ) >= 1391
    )
  );

-- ---------------------------------------------------------------------------
-- public_usernames
-- ---------------------------------------------------------------------------
-- Exposes (id, username) for every profile so that leaderboards and other
-- community features can show names. It is deliberately NOT security_invoker:
-- a plain view runs with the privileges of its owner (postgres), which is how
-- it can read past the own-row SELECT policy on profiles. The Supabase advisor
-- flags this as a "SECURITY DEFINER view"; that is intentional and this is the
-- documentation the launch plan asked for. Usernames are public by design.
--
-- The username availability check does NOT use this view. It uses
-- public.username_is_taken(text) (20260911000002), which returns a boolean
-- only and never lists names.
--
-- Client roles only ever need SELECT on this view, so the REVOKE below limits
-- anon and authenticated to exactly that. Supabase's default grants had given
-- them the full set, and because a simple single-table view is auto-updatable
-- and a non-security_invoker view is permission-checked as its owner, those
-- extra grants allowed writes to reach profiles past its own-row RLS. Nothing
-- in app.html or the Worker writes through the view, so the REVOKE has no
-- functional effect on the app. Leaderboards and community features keep
-- SELECT. service_role keeps its grants (it bypasses RLS anyway).

CREATE OR REPLACE VIEW public.public_usernames AS
  SELECT id, username
  FROM public.profiles;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.public_usernames FROM anon, authenticated;
GRANT SELECT ON public.public_usernames TO anon, authenticated;
