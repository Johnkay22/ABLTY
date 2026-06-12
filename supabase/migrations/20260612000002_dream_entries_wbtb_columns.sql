-- WBTB Re-Entry Protocol: link dream entries to their originating session.
-- entry_type distinguishes full recalls from fragments and blank-mind
-- sessions that produced only an incubation seed (Step 2 paths A/B/C).
-- Existing rows keep entry_type 'full' via the default.
-- dream_entries RLS policies already exist (20260519 migrations) and
-- cover these columns automatically.

ALTER TABLE public.dream_entries
  ADD COLUMN IF NOT EXISTS entry_type text NOT NULL DEFAULT 'full'
    CHECK (entry_type IN ('full','fragment','mind_blank_with_seed'));

ALTER TABLE public.dream_entries
  ADD COLUMN IF NOT EXISTS wbtb_session_id uuid
    REFERENCES public.wbtb_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS dream_entries_wbtb_session_idx
  ON public.dream_entries (wbtb_session_id)
  WHERE wbtb_session_id IS NOT NULL;
