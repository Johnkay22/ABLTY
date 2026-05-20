-- Part 2E: Waitlist lockdown.
--
-- Live audit (2026-05-19) found:
--   * RLS already enabled on public.waitlist.
--   * An anon INSERT-only policy already exists ("Anyone can join waitlist",
--     roles {anon}, WITH CHECK true). No SELECT/UPDATE/DELETE policies exist,
--     which is exactly the desired state, so this migration does NOT touch
--     existing policies (no client can read, update, or delete).
--   * A UNIQUE constraint on email already exists (waitlist_email_key) and the
--     table contains ZERO duplicate emails.
--
-- This migration is therefore an idempotent safety net: it re-asserts RLS and
-- adds the UNIQUE(email) constraint only if one does not already exist.

ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.waitlist'::regclass
      AND contype = 'u'
      AND conkey = ARRAY[
        (SELECT attnum FROM pg_attribute
          WHERE attrelid = 'public.waitlist'::regclass AND attname = 'email')
      ]
  ) THEN
    ALTER TABLE public.waitlist
      ADD CONSTRAINT waitlist_email_unique UNIQUE (email);
  END IF;
END
$$;
