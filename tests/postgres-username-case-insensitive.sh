#!/usr/bin/env bash
set -euo pipefail

# Executable integration test for the real PostgreSQL migration. It creates an
# isolated temporary cluster and never contacts Supabase. PostgreSQL server and
# client binaries must already be installed.
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

# Roles are cluster-wide, not database-local.
psql -X -v ON_ERROR_STOP=1 postgres <<'SQL'
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
SQL

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
UPDATE public.profiles SET username = 'seeker_40000000'
WHERE id = '30000000-0000-4000-8000-000000000001';
INSERT INTO auth.users(id, email) VALUES
  ('40000000-0000-4000-8000-000000000002', 'provider@example.com');
DO $$ DECLARE generated text; BEGIN
  SELECT username INTO generated FROM public.profiles WHERE id = '40000000-0000-4000-8000-000000000002';
  IF generated IS NULL OR generated = 'seeker_40000000' OR generated !~ '^seeker_[0-9a-f]{8}$' THEN
    RAISE EXCEPTION 'generated collision was not retried: %', generated;
  END IF;
END $$;

-- RPC normalization and profile renames use the same database rule.
DO $$ BEGIN
  IF NOT public.username_is_taken('mixed_name') OR NOT public.username_is_taken('MIXED_NAME') THEN
    RAISE EXCEPTION 'RPC missed a case variant';
  END IF;
  IF public.username_is_taken('unused_name') THEN
    RAISE EXCEPTION 'RPC reported an unused name';
  END IF;
  BEGIN
    UPDATE public.profiles SET username = 'MIXED_name'
    WHERE id = '40000000-0000-4000-8000-000000000002';
    RAISE EXCEPTION 'profile rename collision unexpectedly succeeded';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  UPDATE public.profiles SET username = 'Fresh_Display_Name'
  WHERE id = '40000000-0000-4000-8000-000000000002';
  IF (SELECT username FROM public.profiles WHERE id = '40000000-0000-4000-8000-000000000002') <> 'Fresh_Display_Name' THEN
    RAISE EXCEPTION 'profile rename casing was not preserved';
  END IF;
END $$;

INSERT INTO auth.users(id) VALUES
  ('50000000-0000-4000-8000-000000000001'),
  ('50000000-0000-4000-8000-000000000002');
SQL

# Two concurrent profile renames to case variants: the lower(username) index
# permits exactly one commit, and the loser must name that index.
psql -X -v ON_ERROR_STOP=1 behavior >"$TMP/first.log" 2>&1 <<'SQL' &
BEGIN;
UPDATE public.profiles SET username = 'ConcurrentName'
WHERE id = '50000000-0000-4000-8000-000000000001';
SELECT pg_sleep(1);
COMMIT;
SQL
FIRST=$!
sleep 0.1
set +e
psql -X -v ON_ERROR_STOP=1 behavior >"$TMP/second.log" 2>&1 <<'SQL'
BEGIN;
UPDATE public.profiles SET username = 'concurrentname'
WHERE id = '50000000-0000-4000-8000-000000000002';
COMMIT;
SQL
SECOND_RC=$?
set -e
wait "$FIRST"
[[ $SECOND_RC -ne 0 ]] || { echo "FAIL: concurrent case variant committed" >&2; exit 1; }
grep -q 'profiles_username_lower_unique' "$TMP/second.log" || {
  echo "FAIL: concurrent loser was not rejected by the case-insensitive username index" >&2
  cat "$TMP/second.log" >&2
  exit 1
}
[[ $(psql -X -At behavior -c "select count(*) from public.profiles where lower(username)='concurrentname'") == 1 ]]

echo "PASS: PostgreSQL collision, concurrency, rollback, generated retry, RPC, rename, and display-casing tests"
