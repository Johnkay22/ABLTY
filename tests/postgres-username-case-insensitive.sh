#!/usr/bin/env bash
set -euo pipefail

# Executable integration test for the real PostgreSQL migration. It creates an
# isolated temporary cluster and never contacts Supabase. PostgreSQL server and
# client binaries must already be installed.
for command in initdb pg_ctl createdb psql; do
  command -v "$command" >/dev/null || {
    echo "SKIP: $command is not installed; PostgreSQL integration tests were not run." >&2
    exit 77
  }
done

ROOT=$(cd "$(dirname "$0")/.." && pwd)
MIGRATION="$ROOT/supabase/migrations/20260914000001_case_insensitive_usernames.sql"
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

schema() {
  psql -X -v ON_ERROR_STOP=1 "$1" <<'SQL'
CREATE SCHEMA auth;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  email text,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) DEFERRABLE INITIALLY DEFERRED,
  username text NOT NULL UNIQUE,
  tier text NOT NULL DEFAULT 'free'
);
CREATE TABLE public.user_settings (user_id uuid PRIMARY KEY REFERENCES auth.users(id));
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
SQL
}

# Existing case variants must stop the migration without modifying either row.
createdb collision
schema collision
psql -X -v ON_ERROR_STOP=1 collision <<'SQL'
INSERT INTO auth.users(id) VALUES
  ('10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002');
INSERT INTO public.profiles(id, username) VALUES
  ('10000000-0000-4000-8000-000000000001', 'ablty_admin'),
  ('10000000-0000-4000-8000-000000000002', 'ABLTY_Admin');
SQL
if psql -X -v ON_ERROR_STOP=1 collision -f "$MIGRATION" >"$TMP/collision.log" 2>&1; then
  echo "FAIL: migration unexpectedly accepted an existing collision" >&2
  exit 1
fi
psql -X -v ON_ERROR_STOP=1 collision <<'SQL'
DO $$ BEGIN
  IF (SELECT count(*) FROM public.profiles WHERE lower(username) = 'ablty_admin') <> 2 THEN
    RAISE EXCEPTION 'collision rows changed';
  END IF;
  IF to_regclass('public.profiles_username_lower_unique') IS NOT NULL THEN
    RAISE EXCEPTION 'failed migration left its index behind';
  END IF;
END $$;
SQL

createdb behavior
schema behavior
psql -X -v ON_ERROR_STOP=1 behavior -f "$MIGRATION" >/dev/null
psql -X -v ON_ERROR_STOP=1 behavior <<'SQL'
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Requested display casing is retained.
INSERT INTO auth.users(id, email, raw_user_meta_data)
VALUES ('20000000-0000-4000-8000-000000000001', 'mixed@example.com', '{"username":"MiXeD_Name"}');
DO $$ BEGIN
  IF (SELECT username FROM public.profiles WHERE id = '20000000-0000-4000-8000-000000000001') <> 'MiXeD_Name' THEN
    RAISE EXCEPTION 'display casing was not preserved';
  END IF;
END $$;

-- A requested case variant aborts the complete auth.users insert.
DO $$ BEGIN
  BEGIN
    INSERT INTO auth.users(id, email, raw_user_meta_data)
    VALUES ('20000000-0000-4000-8000-000000000002', 'collision@example.com', '{"username":"mixed_NAME"}');
    RAISE EXCEPTION 'requested collision unexpectedly succeeded';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM auth.users WHERE id = '20000000-0000-4000-8000-000000000002') THEN
    RAISE EXCEPTION 'requested collision did not roll back auth user';
  END IF;
END $$;

-- A provider account whose deterministic seeker name is occupied retries a
-- generated name instead of failing the account creation.
INSERT INTO auth.users(id) VALUES ('30000000-0000-4000-8000-000000000001');
INSERT INTO public.profiles(id, username) VALUES
  ('30000000-0000-4000-8000-000000000001', 'seeker_40000000');
INSERT INTO auth.users(id, email) VALUES
  ('40000000-0000-4000-8000-000000000002', 'provider@example.com');
DO $$ DECLARE generated text; BEGIN
  SELECT username INTO generated FROM public.profiles WHERE id = '40000000-0000-4000-8000-000000000002';
  IF generated IS NULL OR generated = 'seeker_40000000' OR generated !~ '^seeker_[0-9a-f]{8}$' THEN
    RAISE EXCEPTION 'generated collision was not retried: %', generated;
  END IF;
END $$;
SQL

# Two concurrent case variants: the index permits exactly one commit.
psql -X -v ON_ERROR_STOP=1 behavior >"$TMP/first.log" 2>&1 <<'SQL' &
BEGIN;
INSERT INTO auth.users(id) VALUES ('50000000-0000-4000-8000-000000000001');
INSERT INTO public.profiles(id, username) VALUES ('50000000-0000-4000-8000-000000000001', 'ConcurrentName');
SELECT pg_sleep(1);
COMMIT;
SQL
FIRST=$!
sleep 0.1
set +e
psql -X -v ON_ERROR_STOP=1 behavior >"$TMP/second.log" 2>&1 <<'SQL'
BEGIN;
INSERT INTO auth.users(id) VALUES ('50000000-0000-4000-8000-000000000002');
INSERT INTO public.profiles(id, username) VALUES ('50000000-0000-4000-8000-000000000002', 'concurrentname');
COMMIT;
SQL
SECOND_RC=$?
set -e
wait "$FIRST"
[[ $SECOND_RC -ne 0 ]] || { echo "FAIL: concurrent case variant committed" >&2; exit 1; }
[[ $(psql -X -At behavior -c "select count(*) from public.profiles where lower(username)='concurrentname'") == 1 ]]

echo "PASS: PostgreSQL collision, concurrency, rollback, generated retry, and display-casing tests"
