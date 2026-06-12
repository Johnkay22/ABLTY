-- WBTB Re-Entry Protocol: session tracking table.
-- One row per protocol run. Created when the user starts the protocol,
-- updated at wind-down (Step 6) and morning sync (Step 7).
--
-- reading_id_shown is a plain uuid for now — the lucidity_readings table
-- lands in a later migration (PR D-5), which adds the FK constraint.
-- RLS ships here, in the same migration that creates the table.

CREATE TABLE IF NOT EXISTS public.wbtb_sessions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at            timestamptz NOT NULL DEFAULT now(),
  duration_hours        numeric,
  started_at            timestamptz,
  completed_at          timestamptz,
  alarm_time            timestamptz,
  path_taken            text CHECK (path_taken IN ('A','B','C')),
  intention             text,
  reading_id_shown      uuid,
  completion_state      text NOT NULL DEFAULT 'started',
  protocol_completed_at timestamptz,
  reported_sleep_onset  text CHECK (reported_sleep_onset IN
                          ('under_5min','5_15min','15_30min','over_30min','never','dont_remember')),
  outcome               text CHECK (outcome IN ('lucid','partial','no','dont_remember')),
  outcome_description   text
);

CREATE INDEX IF NOT EXISTS wbtb_sessions_user_id_idx ON public.wbtb_sessions (user_id, started_at DESC);

ALTER TABLE public.wbtb_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sec_wbtb_sessions_select_own" ON public.wbtb_sessions;
CREATE POLICY "sec_wbtb_sessions_select_own" ON public.wbtb_sessions
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "sec_wbtb_sessions_insert_own" ON public.wbtb_sessions;
CREATE POLICY "sec_wbtb_sessions_insert_own" ON public.wbtb_sessions
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "sec_wbtb_sessions_update_own" ON public.wbtb_sessions;
CREATE POLICY "sec_wbtb_sessions_update_own" ON public.wbtb_sessions
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
