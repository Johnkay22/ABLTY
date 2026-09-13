-- RECORD OF AN ALREADY-APPLIED MIGRATION. Added to the repo by task 0.1(d)
-- (2026-09-11) so `supabase/migrations` is a full record of the live database.
--
-- Live `supabase_migrations.schema_migrations` has version 20260422061145
-- "create_waitlist_table". Reconstructed on 2026-09-11 from the live table.
-- Do NOT run it against production through `apply_migration`: the version is
-- already recorded there. Idempotent so a fresh database built from this
-- folder matches live.
--
-- The inline UNIQUE on email is what 20260519000005_waitlist_lockdown later
-- checks for (as waitlist_email_key) before deciding not to add its own.
-- Only an anon INSERT policy exists on purpose: no client role can read,
-- update, or delete waitlist rows.

CREATE TABLE IF NOT EXISTS public.waitlist (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS waitlist_created_at_idx
  ON public.waitlist (created_at DESC);

ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can join waitlist" ON public.waitlist;
CREATE POLICY "Anyone can join waitlist" ON public.waitlist
  FOR INSERT TO anon
  WITH CHECK (true);
