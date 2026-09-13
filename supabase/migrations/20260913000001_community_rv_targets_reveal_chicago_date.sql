-- Fix the reveal window of community_rv_targets so that the calendar date and
-- the clock are read in the same time zone.
--
-- The policy tracked in 20260911000001 (reproducing the dashboard-created
-- original) compared target_date with CURRENT_DATE, which follows the session
-- time zone (UTC on Supabase), while the 23:11 reveal clock was read in
-- America/Chicago. Between 00:00 UTC and 00:00 Chicago (from 19:00 CDT or
-- 18:00 CST) the current Chicago date therefore already satisfied
-- `target_date < CURRENT_DATE` and was revealed hours before 23:11; likewise
-- the NEXT Chicago date matched `target_date = CURRENT_DATE` and became visible
-- at 23:11 the evening before. Both comparisons now use the Chicago calendar
-- date, so a target is visible strictly from 23:11 America/Chicago on its own
-- date onward, then permanently.
--
-- Replaces only this policy. No change to the table, grants, or any other
-- object. Safe on the live table: DROP POLICY IF EXISTS + CREATE POLICY is
-- idempotent, and a re-run leaves the same policy in place. Nothing in the
-- app or the Worker reads this table yet (the Daily Community RV Challenge is
-- a post-launch item), so applying it has no user-visible effect today.

DROP POLICY IF EXISTS "Revealed targets are public" ON public.community_rv_targets;
CREATE POLICY "Revealed targets are public" ON public.community_rv_targets
  FOR SELECT TO public
  USING (
    target_date < (now() AT TIME ZONE 'America/Chicago')::date
    OR (
      target_date = (now() AT TIME ZONE 'America/Chicago')::date
      AND (
        EXTRACT(hour   FROM (now() AT TIME ZONE 'America/Chicago')) * 60
        + EXTRACT(minute FROM (now() AT TIME ZONE 'America/Chicago'))
      ) >= 1391
    )
  );
