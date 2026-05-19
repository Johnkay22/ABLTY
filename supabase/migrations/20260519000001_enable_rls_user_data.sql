-- Part 2A: Ensure RLS is enabled on every user-data table.
-- Idempotent: ENABLE ROW LEVEL SECURITY is a no-op if already enabled.
-- Live audit (2026-05-19) confirmed RLS was already on for all of these;
-- this migration locks that state in source control.

ALTER TABLE public.profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dream_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rv_sessions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zener_runs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ts_trials     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pp_sessions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waitlist      ENABLE ROW LEVEL SECURITY;
