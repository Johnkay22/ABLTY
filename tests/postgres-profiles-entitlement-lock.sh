#!/usr/bin/env bash
set -euo pipefail

# Pre-beta step 6: Premium and tester status can only be set by the server.
#
# Builds a throwaway PostgreSQL cluster that mirrors the live `profiles` table
# (columns, RLS policies and grants as read from production on 2026-10-05),
# applies, in production order, the real migration files the live database
# already has for everything that touches profiles (tier lock, 30-day username
# rename cooldown, is_tester, the signup trigger and its case-insensitive
# username replacement), then applies
# 20261005000001_profiles_lock_entitlements.sql and exercises it with the real
# roles PostgREST uses (anon, authenticated, service_role) plus the signup
# path (handle_new_user as SECURITY DEFINER, fired from supabase_auth_admin's
# insert into auth.users). Never contacts Supabase.
#
# Run:  tests/postgres-profiles-entitlement-lock.sh
# Exit 77 means PostgreSQL is not installed and nothing was tested.
if command -v pg_config >/dev/null 2>&1; then
  PG_BINDIR=$(pg_config --bindir 2>/dev/null || true)
  if [[ -n "$PG_BINDIR" ]]; then export PATH="$PG_BINDIR:$PATH"; fi
fi
for command in initdb pg_ctl createdb psql; do
  command -v "$command" >/dev/null || {
    echo "SKIP: $command is not installed; PostgreSQL integration tests were not run." >&2
    exit 77
  }
done

ROOT=$(cd "$(dirname "$0")/.." && pwd)
MIG="$ROOT/supabase/migrations"
NEW_MIGRATION="$MIG/20261005000001_profiles_lock_entitlements.sql"
TMP=$(mktemp -d)
PORT=$((55432 + RANDOM % 500))
PG_RUN=()
if [[ $(id -u) -eq 0 ]]; then
  chown postgres:postgres "$TMP"
  PG_RUN=(runuser -u postgres --)
fi
cleanup() {
  "${PG_RUN[@]}" pg_ctl -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

"${PG_RUN[@]}" initdb -D "$TMP/data" -A trust -U postgres >/dev/null
"${PG_RUN[@]}" pg_ctl -D "$TMP/data" -o "-F -k $TMP -p $PORT" -w start >/dev/null
export PGHOST="$TMP" PGPORT="$PORT" PGUSER=postgres

psql -X -v ON_ERROR_STOP=1 postgres <<'SQL'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE supabase_auth_admin NOLOGIN;
SQL

createdb ablty
# The live shape of what the migration touches. `auth.uid()` reads the JWT
# subject the way Supabase's does; tests set it with set_config.
psql -X -v ON_ERROR_STOP=1 ablty <<'SQL'
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role, supabase_auth_admin;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  email text,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb
);
GRANT INSERT, SELECT ON auth.users TO supabase_auth_admin;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) DEFERRABLE INITIALLY DEFERRED,
  username text NOT NULL UNIQUE,
  tier text NOT NULL DEFAULT 'free',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  username_changed_at timestamptz,
  terms_accepted_at timestamptz,
  terms_version text,
  privacy_accepted_at timestamptz,
  privacy_version text
);
CREATE TABLE public.user_settings (user_id uuid PRIMARY KEY REFERENCES auth.users(id));
-- Supabase's default grants on public tables.
GRANT ALL ON public.profiles, public.user_settings TO anon, authenticated, service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
-- The live policies, verbatim in effect.
CREATE POLICY "Users read own profile" ON public.profiles FOR SELECT TO public USING (auth.uid() = id);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO public
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id AND tier = (SELECT p.tier FROM public.profiles p WHERE p.id = auth.uid()));
SQL
psql -X -v ON_ERROR_STOP=1 ablty -f "$MIG/20260322070144_add_profiles_insert_policy.sql" >/dev/null
psql -X -v ON_ERROR_STOP=1 ablty -f "$MIG/20260519000003_profiles_protect_tier_trigger.sql" >/dev/null
psql -X -v ON_ERROR_STOP=1 ablty <<'SQL'
-- The one live policy the new migration removes (from 20260519000002, which
-- also touches tables this test does not build).
CREATE POLICY "sec_profiles_delete_own" ON public.profiles FOR DELETE TO authenticated USING (auth.uid() = id);
SQL
psql -X -v ON_ERROR_STOP=1 ablty -f "$MIG/20260519000004_profiles_username_rename_cooldown.sql" >/dev/null
psql -X -v ON_ERROR_STOP=1 ablty -f "$MIG/20260815131016_add_is_tester_to_profiles.sql" >/dev/null
psql -X -v ON_ERROR_STOP=1 ablty -f "$MIG/20260911000003_handle_new_user_trigger.sql" >/dev/null
# Live since 2026-09-19 (production version 20260919181613): replaces
# handle_new_user and adds the lower(username) unique index.
psql -X -v ON_ERROR_STOP=1 ablty -f "$MIG/20260914000001_case_insensitive_usernames.sql" >/dev/null

# Before the migration: prove the hole is real, so the test is testing
# something. A signed-in client creates its own profile row as premium.
psql -X -v ON_ERROR_STOP=1 ablty <<'SQL'
INSERT INTO auth.users(id) VALUES ('00000000-0000-4000-8000-00000000dead');
DELETE FROM public.profiles WHERE id = '00000000-0000-4000-8000-00000000dead';
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000dead', false);
INSERT INTO public.profiles (id, username, tier, is_tester)
VALUES ('00000000-0000-4000-8000-00000000dead', 'before_fix', 'premium', true);
RESET ROLE;
DO $$ BEGIN
  IF (SELECT tier FROM public.profiles WHERE username = 'before_fix') <> 'premium' THEN
    RAISE EXCEPTION 'precondition: the pre-migration hole should have allowed a premium insert';
  END IF;
END $$;
DELETE FROM public.profiles WHERE username = 'before_fix';
DELETE FROM public.user_settings WHERE user_id = '00000000-0000-4000-8000-00000000dead';
DELETE FROM auth.users WHERE id = '00000000-0000-4000-8000-00000000dead';
SQL

# Apply the migration twice: it must be idempotent.
psql -X -v ON_ERROR_STOP=1 ablty -f "$NEW_MIGRATION" >/dev/null
psql -X -v ON_ERROR_STOP=1 ablty -f "$NEW_MIGRATION" >/dev/null

# Everything below runs in one psql session with ON_ERROR_STOP, so the first
# assertion that fails stops the run with its message. Each `expect_denied`
# block must raise insufficient_privilege (42501); anything else, including
# success, is a failure.
psql -X -v ON_ERROR_STOP=1 ablty <<'SQL'
-- Helpers ------------------------------------------------------------------
CREATE FUNCTION pg_temp.as_user(uid uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', uid::text, false)
$$;
CREATE FUNCTION pg_temp.row_of(uid uuid) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce((SELECT tier || '/' || is_tester::text || '/' || username FROM public.profiles WHERE id = uid), 'absent')
$$;
CREATE FUNCTION pg_temp.check(label text, ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT coalesce(ok, false) THEN RAISE EXCEPTION 'FAIL: %', label; END IF;
  RAISE NOTICE 'ok: %', label;
END $$;
-- Runs `stmt` as `role` and asserts it is rejected with 42501.
CREATE FUNCTION pg_temp.expect_denied(label text, role text, stmt text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', role);
  BEGIN
    EXECUTE stmt;
    RESET ROLE;
    RAISE EXCEPTION 'FAIL: % (statement was accepted)', label;
  EXCEPTION
    WHEN insufficient_privilege THEN
      RESET ROLE;
      RAISE NOTICE 'ok: % (denied: %)', label, SQLERRM;
  END;
END $$;
CREATE FUNCTION pg_temp.expect_ok(label text, role text, stmt text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', role);
  EXECUTE stmt;
  RESET ROLE;
  RAISE NOTICE 'ok: %', label;
END $$;
-- Runs `stmt` as `role` and asserts it fails with exactly `errcode` (for
-- rejections that are not privilege errors, such as the rename cooldown's
-- check_violation 23514 and the username index's unique_violation 23505).
CREATE FUNCTION pg_temp.expect_error(label text, role text, stmt text, errcode text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', role);
  BEGIN
    EXECUTE stmt;
    RESET ROLE;
    RAISE EXCEPTION 'FAIL: % (statement was accepted)', label;
  EXCEPTION
    WHEN OTHERS THEN
      RESET ROLE;
      IF SQLSTATE <> errcode THEN
        RAISE EXCEPTION 'FAIL: % (expected SQLSTATE %, got %: %)', label, errcode, SQLSTATE, SQLERRM;
      END IF;
      RAISE NOTICE 'ok: % (rejected %: %)', label, SQLSTATE, SQLERRM;
  END;
END $$;

-- Live production pieces this test depends on being present ----------------
SELECT pg_temp.check('case-insensitive username index present (20260914000001)',
  EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'profiles' AND indexname = 'profiles_username_lower_unique'));
SELECT pg_temp.check('rename cooldown trigger present (20260519000004)',
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass AND tgname = 'trg_profiles_username_cooldown'
            AND tgfoid = 'public.enforce_username_rename_cooldown'::regproc));

-- Signup -------------------------------------------------------------------
-- Auth inserts the user as supabase_auth_admin; handle_new_user (SECURITY
-- DEFINER, owned by postgres) creates the profile. The new INSERT trigger
-- must not get in its way.
SET ROLE supabase_auth_admin;
INSERT INTO auth.users(id, email, raw_user_meta_data)
VALUES ('10000000-0000-4000-8000-000000000001', 'alice@example.test', '{"username":"alice"}');
RESET ROLE;
SELECT pg_temp.check('signup trigger still creates the profile with free/false',
  pg_temp.row_of('10000000-0000-4000-8000-000000000001') = 'free/false/alice');
SELECT pg_temp.check('signup trigger still creates user_settings',
  EXISTS (SELECT 1 FROM public.user_settings WHERE user_id = '10000000-0000-4000-8000-000000000001'));
-- Only the current (20260914000001) signup function behaves this way: a
-- requested name that collides case-insensitively aborts the whole signup
-- instead of silently falling back to a generated name.
SELECT pg_temp.expect_error('current signup function: requested name "ALICE" collides with "alice" and aborts the signup', 'supabase_auth_admin', $q$
  INSERT INTO auth.users(id, email, raw_user_meta_data)
  VALUES ('10000000-0000-4000-8000-00000000000a', 'alice2@example.test', '{"username":"ALICE"}')
$q$, '23505');
SELECT pg_temp.check('aborted signup left no auth user and no profile',
  NOT EXISTS (SELECT 1 FROM auth.users WHERE id = '10000000-0000-4000-8000-00000000000a')
  AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE lower(username) = 'alice' AND id <> '10000000-0000-4000-8000-000000000001'));
-- Provider (Google) signups carry no requested name and get the generated one.
SELECT pg_temp.expect_ok('current signup function: provider signup without a username gets a generated seeker_ name', 'supabase_auth_admin', $q$
  INSERT INTO auth.users(id, email) VALUES ('10000000-0000-4000-8000-00000000000b', 'google@example.test')
$q$);
SELECT pg_temp.check('provider signup profile is free/false with a seeker_ name',
  pg_temp.row_of('10000000-0000-4000-8000-00000000000b') LIKE 'free/false/seeker_%');

-- A user whose profile row does not exist (trigger lost the username race, or
-- an account from before the trigger): the app's fallback upsert.
INSERT INTO auth.users(id, email) VALUES ('20000000-0000-4000-8000-000000000002', 'bob@example.test');
DELETE FROM public.profiles WHERE id = '20000000-0000-4000-8000-000000000002';
INSERT INTO auth.users(id, email) VALUES ('30000000-0000-4000-8000-000000000003', 'carol@example.test');
DELETE FROM public.profiles WHERE id = '30000000-0000-4000-8000-000000000003';

-- Client (authenticated), own row ------------------------------------------
SELECT pg_temp.as_user('20000000-0000-4000-8000-000000000002');

SELECT pg_temp.expect_ok('fallback profile creation: upsert {id, username, tier free, legal fields} is accepted', 'authenticated', $q$
  INSERT INTO public.profiles (id, username, tier, terms_accepted_at, terms_version, privacy_accepted_at, privacy_version)
  VALUES ('20000000-0000-4000-8000-000000000002', 'bob', 'free', now(), '2026-09-01', now(), '2026-09-01')
  ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username, tier = EXCLUDED.tier,
    terms_accepted_at = EXCLUDED.terms_accepted_at, terms_version = EXCLUDED.terms_version,
    privacy_accepted_at = EXCLUDED.privacy_accepted_at, privacy_version = EXCLUDED.privacy_version
$q$);
SELECT pg_temp.check('fallback row is free/false', pg_temp.row_of('20000000-0000-4000-8000-000000000002') = 'free/false/bob');

SELECT pg_temp.expect_ok('fallback upsert run again on the existing free row is accepted (no change)', 'authenticated', $q$
  INSERT INTO public.profiles (id, username, tier) VALUES ('20000000-0000-4000-8000-000000000002', 'bob', 'free')
  ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username, tier = EXCLUDED.tier
$q$);

-- Renames: the live 30-day cooldown (20260519000004) applies. Bob has never
-- renamed (username_changed_at is null), so his first rename is eligible; the
-- statement writes username_changed_at the way the app does, and the trigger
-- stamps it with now() regardless.
SELECT pg_temp.check('bob has never renamed (eligible for a first rename)',
  (SELECT username_changed_at IS NULL FROM public.profiles WHERE id = '20000000-0000-4000-8000-000000000002'));
SELECT pg_temp.expect_ok('username change is accepted (first rename, cooldown not in effect)', 'authenticated', $q$
  UPDATE public.profiles SET username = 'bobby', username_changed_at = now() WHERE id = '20000000-0000-4000-8000-000000000002'
$q$);
SELECT pg_temp.check('cooldown trigger stamped username_changed_at on the rename',
  (SELECT username_changed_at IS NOT NULL AND username_changed_at >= now() - interval '1 minute'
     FROM public.profiles WHERE id = '20000000-0000-4000-8000-000000000002'));
SELECT pg_temp.expect_error('premature second rename is rejected by the 30-day cooldown', 'authenticated', $q$
  UPDATE public.profiles SET username = 'bobbie', username_changed_at = now() WHERE id = '20000000-0000-4000-8000-000000000002'
$q$, '23514');
SELECT pg_temp.check('username unchanged after the rejected premature rename', pg_temp.row_of('20000000-0000-4000-8000-000000000002') = 'free/false/bobby');
SELECT pg_temp.expect_ok('legal acceptance write is accepted', 'authenticated', $q$
  UPDATE public.profiles SET terms_accepted_at = now(), privacy_accepted_at = now() WHERE id = '20000000-0000-4000-8000-000000000002'
$q$);

SELECT pg_temp.expect_denied('UPDATE own tier to premium', 'authenticated', $q$
  UPDATE public.profiles SET tier = 'premium' WHERE id = '20000000-0000-4000-8000-000000000002'
$q$);
SELECT pg_temp.expect_denied('UPDATE own is_tester to true', 'authenticated', $q$
  UPDATE public.profiles SET is_tester = true WHERE id = '20000000-0000-4000-8000-000000000002'
$q$);
SELECT pg_temp.expect_denied('UPSERT onto own existing row with tier premium', 'authenticated', $q$
  INSERT INTO public.profiles (id, username, tier) VALUES ('20000000-0000-4000-8000-000000000002', 'bobby', 'premium')
  ON CONFLICT (id) DO UPDATE SET tier = EXCLUDED.tier
$q$);
SELECT pg_temp.expect_denied('UPSERT onto own existing row with is_tester true', 'authenticated', $q$
  INSERT INTO public.profiles (id, username, is_tester) VALUES ('20000000-0000-4000-8000-000000000002', 'bobby', true)
  ON CONFLICT (id) DO UPDATE SET is_tester = EXCLUDED.is_tester
$q$);
SELECT pg_temp.check('bob unchanged after rejected escalations', pg_temp.row_of('20000000-0000-4000-8000-000000000002') = 'free/false/bobby');

-- The delete-then-reinsert chain that was open before.
SELECT pg_temp.expect_denied('DELETE own profile row (grant revoked)', 'authenticated', $q$
  DELETE FROM public.profiles WHERE id = '20000000-0000-4000-8000-000000000002'
$q$);
SELECT pg_temp.check('bob still exists after denied delete', pg_temp.row_of('20000000-0000-4000-8000-000000000002') = 'free/false/bobby');
SELECT pg_temp.expect_denied('TRUNCATE profiles', 'authenticated', 'TRUNCATE public.profiles');

-- A user with no profile row yet: a fresh INSERT.
SELECT pg_temp.as_user('30000000-0000-4000-8000-000000000003');
SELECT pg_temp.expect_denied('INSERT own row with tier premium', 'authenticated', $q$
  INSERT INTO public.profiles (id, username, tier) VALUES ('30000000-0000-4000-8000-000000000003', 'carol', 'premium')
$q$);
SELECT pg_temp.expect_denied('INSERT own row with is_tester true', 'authenticated', $q$
  INSERT INTO public.profiles (id, username, is_tester) VALUES ('30000000-0000-4000-8000-000000000003', 'carol', true)
$q$);
SELECT pg_temp.expect_denied('INSERT own row with both', 'authenticated', $q$
  INSERT INTO public.profiles (id, username, tier, is_tester) VALUES ('30000000-0000-4000-8000-000000000003', 'carol', 'premium', true)
$q$);
SELECT pg_temp.expect_denied('UPSERT (new row) with tier premium', 'authenticated', $q$
  INSERT INTO public.profiles (id, username, tier) VALUES ('30000000-0000-4000-8000-000000000003', 'carol', 'premium')
  ON CONFLICT (id) DO UPDATE SET tier = EXCLUDED.tier
$q$);
SELECT pg_temp.check('carol has no row after rejected inserts', pg_temp.row_of('30000000-0000-4000-8000-000000000003') = 'absent');
SELECT pg_temp.expect_ok('INSERT own row with defaults only is accepted', 'authenticated', $q$
  INSERT INTO public.profiles (id, username) VALUES ('30000000-0000-4000-8000-000000000003', 'carol')
$q$);
SELECT pg_temp.check('carol row is free/false', pg_temp.row_of('30000000-0000-4000-8000-000000000003') = 'free/false/carol');

-- Client (anon) --------------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '', false);
INSERT INTO auth.users(id) VALUES ('40000000-0000-4000-8000-000000000004');
DELETE FROM public.profiles WHERE id = '40000000-0000-4000-8000-000000000004';
SELECT pg_temp.expect_denied('anon INSERT with tier premium', 'anon', $q$
  INSERT INTO public.profiles (id, username, tier) VALUES ('40000000-0000-4000-8000-000000000004', 'mallory', 'premium')
$q$);
SELECT pg_temp.expect_denied('anon DELETE', 'anon', 'DELETE FROM public.profiles');
-- alice, the provider signup, bob and carol.
SELECT pg_temp.check('anon left every row in place', (SELECT count(*) FROM public.profiles) = 4);

-- Server (service_role): the Worker's Stripe path, administrative grants,
-- and the Worker's account deletion ------------------------------------------
SELECT pg_temp.expect_ok('service_role sets tier premium (Stripe webhook)', 'service_role', $q$
  UPDATE public.profiles SET tier = 'premium', updated_at = now() WHERE id = '20000000-0000-4000-8000-000000000002'
$q$);
SELECT pg_temp.expect_ok('service_role sets is_tester (administrative grant)', 'service_role', $q$
  UPDATE public.profiles SET is_tester = true WHERE id = '20000000-0000-4000-8000-000000000002'
$q$);
SELECT pg_temp.check('bob is premium/true after service-role grants', pg_temp.row_of('20000000-0000-4000-8000-000000000002') = 'premium/true/bobby');
SELECT pg_temp.expect_ok('service_role sets tier back to free (Stripe cancellation)', 'service_role', $q$
  UPDATE public.profiles SET tier = 'free' WHERE id = '20000000-0000-4000-8000-000000000002'
$q$);
SELECT pg_temp.expect_ok('service_role sets tier premium again for the next check', 'service_role', $q$
  UPDATE public.profiles SET tier = 'premium' WHERE id = '20000000-0000-4000-8000-000000000002'
$q$);

-- A premium user's app does its fallback upsert with tier 'free' only if the
-- row is missing; if the row exists the upsert becomes an UPDATE that would
-- lower the tier, and is rejected exactly as it was before this migration.
-- The app already handles that (it reads the row back on createErr).
SELECT pg_temp.as_user('20000000-0000-4000-8000-000000000002');
SELECT pg_temp.expect_denied('premium user: client upsert with tier free onto the existing row is rejected (unchanged behaviour)', 'authenticated', $q$
  INSERT INTO public.profiles (id, username, tier) VALUES ('20000000-0000-4000-8000-000000000002', 'bobby', 'free')
  ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username, tier = EXCLUDED.tier
$q$);
SELECT pg_temp.check('premium kept after the rejected downgrade', pg_temp.row_of('20000000-0000-4000-8000-000000000002') = 'premium/true/bobby');
-- Bob renamed moments ago, so the cooldown still applies to him.
SELECT pg_temp.expect_error('premium user: rename inside the cooldown is still rejected', 'authenticated', $q$
  UPDATE public.profiles SET username = 'bob_premium', username_changed_at = now() WHERE id = '20000000-0000-4000-8000-000000000002'
$q$, '23514');
-- Test fixture, run by the harness superuser: pretend 31 days have passed so
-- the rename is eligible. This is time travel for the test only, not a path
-- the app or a client has.
UPDATE public.profiles SET username_changed_at = now() - interval '31 days' WHERE id = '20000000-0000-4000-8000-000000000002';
SELECT pg_temp.expect_ok('premium user can still rename once the cooldown has elapsed', 'authenticated', $q$
  UPDATE public.profiles SET username = 'bob_premium', username_changed_at = now() WHERE id = '20000000-0000-4000-8000-000000000002'
$q$);
SELECT pg_temp.check('eligible rename stored and re-stamped, tier and tester untouched',
  pg_temp.row_of('20000000-0000-4000-8000-000000000002') = 'premium/true/bob_premium'
  AND (SELECT username_changed_at >= now() - interval '1 minute' FROM public.profiles WHERE id = '20000000-0000-4000-8000-000000000002'));

-- The auth.users row is created by the superuser (standing in for GoTrue's
-- admin API); the signup trigger then makes a free profile, which we remove so
-- the service role can insert its own premium row from scratch.
INSERT INTO auth.users(id) VALUES ('50000000-0000-4000-8000-000000000005');
DELETE FROM public.profiles WHERE id = '50000000-0000-4000-8000-000000000005';
SELECT pg_temp.expect_ok('service_role INSERT with tier premium (administrative)', 'service_role', $q$
  INSERT INTO public.profiles (id, username, tier, is_tester) VALUES ('50000000-0000-4000-8000-000000000005', 'vip', 'premium', true)
$q$);
SELECT pg_temp.check('service_role insert stored premium/true', pg_temp.row_of('50000000-0000-4000-8000-000000000005') = 'premium/true/vip');
SELECT pg_temp.expect_ok('service_role DELETE (Worker handleDeleteAccount)', 'service_role', $q$
  DELETE FROM public.profiles WHERE id = '50000000-0000-4000-8000-000000000005'
$q$);
SELECT pg_temp.check('service_role delete removed the row', pg_temp.row_of('50000000-0000-4000-8000-000000000005') = 'absent');

-- Step 8 readiness: the entitlement column that does not exist yet ----------
ALTER TABLE public.profiles ADD COLUMN beta_premium_until timestamptz;
SELECT pg_temp.as_user('30000000-0000-4000-8000-000000000003');
SELECT pg_temp.expect_denied('after adding beta_premium_until: client UPDATE sets it', 'authenticated', $q$
  UPDATE public.profiles SET beta_premium_until = now() + interval '30 days' WHERE id = '30000000-0000-4000-8000-000000000003'
$q$);
DELETE FROM public.profiles WHERE id = '30000000-0000-4000-8000-000000000003';
SELECT pg_temp.expect_denied('after adding beta_premium_until: client INSERT sets it', 'authenticated', $q$
  INSERT INTO public.profiles (id, username, beta_premium_until) VALUES ('30000000-0000-4000-8000-000000000003', 'carol', now())
$q$);
SELECT pg_temp.expect_ok('after adding beta_premium_until: client INSERT leaving it null is accepted', 'authenticated', $q$
  INSERT INTO public.profiles (id, username) VALUES ('30000000-0000-4000-8000-000000000003', 'carol')
$q$);
SELECT pg_temp.expect_ok('after adding beta_premium_until: service_role sets it', 'service_role', $q$
  UPDATE public.profiles SET beta_premium_until = now() + interval '30 days' WHERE id = '30000000-0000-4000-8000-000000000003'
$q$);
SELECT pg_temp.check('beta_premium_until set by the server',
  (SELECT beta_premium_until IS NOT NULL FROM public.profiles WHERE id = '30000000-0000-4000-8000-000000000003'));
SELECT pg_temp.as_user('30000000-0000-4000-8000-000000000003');
SELECT pg_temp.expect_denied('after the server set it: client clears beta_premium_until', 'authenticated', $q$
  UPDATE public.profiles SET beta_premium_until = NULL WHERE id = '30000000-0000-4000-8000-000000000003'
$q$);
-- Carol's row was just created and has never been renamed, so this rename is
-- eligible under the cooldown.
SELECT pg_temp.check('carol has never renamed (eligible)',
  (SELECT username_changed_at IS NULL FROM public.profiles WHERE id = '30000000-0000-4000-8000-000000000003'));
SELECT pg_temp.expect_ok('after the server set it: client rename leaves it alone and is accepted', 'authenticated', $q$
  UPDATE public.profiles SET username = 'carol2', username_changed_at = now() WHERE id = '30000000-0000-4000-8000-000000000003'
$q$);
SELECT pg_temp.check('rename kept beta_premium_until as the server set it',
  (SELECT beta_premium_until IS NOT NULL AND username = 'carol2' FROM public.profiles WHERE id = '30000000-0000-4000-8000-000000000003'));

-- Final shape --------------------------------------------------------------
SELECT pg_temp.check('client roles no longer hold DELETE or TRUNCATE on profiles',
  NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants
              WHERE table_schema = 'public' AND table_name = 'profiles'
                AND grantee IN ('anon', 'authenticated') AND privilege_type IN ('DELETE', 'TRUNCATE')));
SELECT pg_temp.check('service_role still holds DELETE on profiles',
  EXISTS (SELECT 1 FROM information_schema.role_table_grants
          WHERE table_schema = 'public' AND table_name = 'profiles' AND grantee = 'service_role' AND privilege_type = 'DELETE'));
SELECT pg_temp.check('delete policy removed',
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'sec_profiles_delete_own'));
SELECT pg_temp.check('both triggers present and pointing at the function',
  (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass AND NOT tgisinternal
     AND tgname IN ('trg_profiles_protect_tier', 'trg_profiles_protect_tier_insert')
     AND tgfoid = 'public.enforce_profiles_tier_lock'::regproc) = 2);
SELECT pg_temp.check('function pins search_path and is not SECURITY DEFINER',
  (SELECT NOT prosecdef AND EXISTS (SELECT 1 FROM unnest(proconfig) c WHERE c IN ('search_path=', 'search_path=""'))
     FROM pg_proc WHERE oid = 'public.enforce_profiles_tier_lock'::regproc));
SQL

echo "PASS: PostgreSQL profiles entitlement lock (current signup function and case-insensitive index, 30-day rename cooldown, fallback creation, client insert/upsert/update/delete denials, anon, service role, future beta_premium_until, idempotency)"
