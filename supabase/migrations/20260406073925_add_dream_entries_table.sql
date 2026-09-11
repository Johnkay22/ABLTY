-- RECORD OF AN ALREADY-APPLIED MIGRATION. Added to the repo by task 0.1(d)
-- (2026-09-11) so `supabase/migrations` is a full record of the live database.
--
-- Live `supabase_migrations.schema_migrations` has version 20260406073925
-- "add_dream_entries_table". Reconstructed on 2026-09-11 from the live table,
-- minus the two columns and the index that 20260612000002 added later
-- (entry_type, wbtb_session_id, dream_entries_wbtb_session_idx). Do NOT run it
-- against production through `apply_migration`: the version is already
-- recorded there. Idempotent so a fresh database built from this folder matches
-- live.
--
-- Note the four RLS policies here are named dream_entries_*_own and are
-- granted TO public. The 20260519000002 audit found them already complete and
-- left them alone, which is why that migration adds nothing for this table.

CREATE TABLE IF NOT EXISTS public.dream_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  clarity     integer CHECK (clarity >= 1 AND clarity <= 5),
  lucid       text NOT NULL DEFAULT 'no' CHECK (lucid IN ('yes', 'partial', 'no')),
  emotion     text NOT NULL,
  body        text NOT NULL,
  ai_tags     text[] NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS dream_entries_user_created_at_idx
  ON public.dream_entries (user_id, created_at DESC);

ALTER TABLE public.dream_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dream_entries_select_own" ON public.dream_entries;
CREATE POLICY "dream_entries_select_own" ON public.dream_entries
  FOR SELECT TO public
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "dream_entries_insert_own" ON public.dream_entries;
CREATE POLICY "dream_entries_insert_own" ON public.dream_entries
  FOR INSERT TO public
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "dream_entries_update_own" ON public.dream_entries;
CREATE POLICY "dream_entries_update_own" ON public.dream_entries
  FOR UPDATE TO public
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "dream_entries_delete_own" ON public.dream_entries;
CREATE POLICY "dream_entries_delete_own" ON public.dream_entries
  FOR DELETE TO public
  USING (auth.uid() = user_id);
