-- Part 2D: Enforce a 30-day username rename cooldown at the database level.
--
-- Rules:
--   * On UPDATE, if username changes and username_changed_at is set and the
--     last change was < 30 days ago, reject the update.
--   * If the rename is allowed (cooldown elapsed, or username_changed_at is
--     NULL), automatically stamp username_changed_at = now().
--   * INSERT is unaffected (this is a BEFORE UPDATE trigger), so the initial
--     profile creation can set any username freely.
--
-- This server-side check is the real enforcement. The existing client-side
-- localStorage cooldown check in app.html (openUsernameEdit) is unchanged and
-- intentionally remains a UX convenience only.
--
-- Idempotent: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS.

CREATE OR REPLACE FUNCTION public.enforce_username_rename_cooldown()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.username IS DISTINCT FROM OLD.username THEN
    IF OLD.username_changed_at IS NOT NULL
       AND now() - OLD.username_changed_at < interval '30 days' THEN
      RAISE EXCEPTION
        'username can only be changed once every 30 days (last changed %)',
        OLD.username_changed_at
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.username_changed_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_username_cooldown ON public.profiles;
CREATE TRIGGER trg_profiles_username_cooldown
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_username_rename_cooldown();
