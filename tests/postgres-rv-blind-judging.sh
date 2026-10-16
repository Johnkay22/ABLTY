#!/usr/bin/env bash
set -euo pipefail
# Disposable local database only. Never reads credentials or contacts Supabase.
for command in initdb pg_ctl createdb psql; do
  command -v "$command" >/dev/null || { echo "SKIP: missing $command" >&2; exit 77; }
done
ABLTY_TEST_ROOT=$(cd "$(dirname "$0")/.." && pwd)
ABLTY_TEST_TMP=$(mktemp -d)
ABLTY_TEST_PORT=$((57000 + RANDOM % 500))
ABLTY_PG_RUN=()
if [[ $(id -u) -eq 0 ]]; then
  chown postgres:postgres "$ABLTY_TEST_TMP"
  ABLTY_PG_RUN=(runuser -u postgres --)
fi
cleanup() {
  "${ABLTY_PG_RUN[@]}" pg_ctl -D "$ABLTY_TEST_TMP/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$ABLTY_TEST_TMP"
}
trap cleanup EXIT
"${ABLTY_PG_RUN[@]}" initdb -D "$ABLTY_TEST_TMP/data" -A trust -U postgres >/dev/null
"${ABLTY_PG_RUN[@]}" pg_ctl -D "$ABLTY_TEST_TMP/data" -o "-F -k $ABLTY_TEST_TMP -p $ABLTY_TEST_PORT -h ''" -w start >/dev/null
export PGHOST="$ABLTY_TEST_TMP" PGPORT="$ABLTY_TEST_PORT" PGUSER=postgres PGDATABASE=postgres
psql -Xq -v ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE TABLE public.rv_sessions (
  id bigint PRIMARY KEY, user_id uuid NOT NULL, session_type text, trn text, target_id integer,
  target_src text, target_label text, category text, score integer, dimension_scores jsonb,
  hits jsonb DEFAULT '[]', noise jsonb DEFAULT '[]', aol jsonb DEFAULT '[]', summary text,
  notes text, duration integer, sketch_data text, timestamp timestamptz, tags jsonb DEFAULT '[]'
);
ALTER TABLE public.rv_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_sessions ON public.rv_sessions TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
GRANT SELECT, INSERT, UPDATE ON public.rv_sessions TO authenticated;
CREATE FUNCTION public.check_test(ok boolean, description text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', description; END IF; RAISE NOTICE 'PASS: %', description; END; $$;
SQL
psql -Xq -v ON_ERROR_STOP=1 -f "$ABLTY_TEST_ROOT/supabase/migrations/20261015000001_rv_blind_judging.sql"
psql -Xq -v ON_ERROR_STOP=1 <<'SQL'
SELECT check_test(NOT has_table_privilege('anon','rv_blind_receipts','SELECT'), 'anon cannot read receipts');
SELECT check_test(NOT has_table_privilege('authenticated','rv_blind_receipts','SELECT'), 'accounts cannot read receipts');
SELECT check_test(NOT has_function_privilege('authenticated','rv_blind_transition(text,text,jsonb)','EXECUTE'), 'accounts cannot claim server receipts');
SELECT check_test(NOT has_function_privilege('anon','rv_complete_blind_session(jsonb)','EXECUTE'), 'anon cannot update cloud judgments');
SELECT check_test((SELECT array_agg(column_name::text ORDER BY ordinal_position) = ARRAY[
  'id','trn','candidate_ids','target_index','submission_hash','state','lease','lease_until','attempts',
  'score_matrix','token_counts','protocol','model','rubric','created_at','finished_at','expires_at']
  FROM information_schema.columns WHERE table_schema='public' AND table_name='rv_blind_receipts'),
  'receipt columns contain no account IDs, notes, sketches or generated text');
SET ROLE service_role;
SELECT check_test(rv_blind_transition('b11111111111111111111111111111111','create',
  '{"trn":"1234-5678","candidate_ids":["T001","T002","T003","T004","T005"],"target_index":2}')->>'status' = 'created', 'service role creates receipt');
RESET ROLE;
SELECT check_test((SELECT created_at <= clock_timestamp() AND finished_at IS NULL
  AND expires_at BETWEEN created_at + interval '2 hours' AND created_at + interval '2 hours 1 second'
  AND rubric = 'seven-dimensions-v1' FROM rv_blind_receipts WHERE id='b11111111111111111111111111111111'),
  'new receipt has creation timestamp, seven-dimension rubric and two-hour claim window');
SET ROLE service_role;
SELECT check_test(rv_blind_transition('b11111111111111111111111111111111','claim',
  jsonb_build_object('trn','1234-5678','submission_hash',repeat('a',64),'lease','11111111-1111-4111-8111-111111111111'))->>'status' = 'claimed', 'first submission obtains claim');
SELECT check_test(rv_blind_transition('b11111111111111111111111111111111','claim',
  jsonb_build_object('trn','1234-5678','submission_hash',repeat('a',64),'lease','22222222-2222-4222-8222-222222222222'))->>'status' = 'busy', 'second caller cannot judge');
SELECT check_test(rv_blind_transition('b11111111111111111111111111111111','claim',
  jsonb_build_object('trn','1234-5678','submission_hash',repeat('b',64),'lease','22222222-2222-4222-8222-222222222222'))->>'status' = 'mismatch', 'changed full-submission hash rejected');
SELECT check_test(rv_blind_transition('b11111111111111111111111111111111','finish',
  '{"lease":"22222222-2222-4222-8222-222222222222"}')->>'status' = 'stale', 'different lease cannot finish');
DO $$ BEGIN
  PERFORM rv_blind_transition('b11111111111111111111111111111111','finish',
  '{"lease":"11111111-1111-4111-8111-111111111111","score_matrix":[[8,0,0,0,0,0,0],[0,0,0,0,0,0,0],[0,0,0,0,0,0,0],[0,0,0,0,0,0,0],[0,0,0,0,0,0,0]]}');
  RAISE EXCEPTION 'invalid scores accepted';
EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'Invalid score' THEN RAISE; END IF; RAISE NOTICE 'PASS: database validates numeric scores'; END $$;
DO $$ DECLARE width integer; matrix jsonb; BEGIN
  FOREACH width IN ARRAY ARRAY[6,8] LOOP
    SELECT jsonb_agg(row_scores) INTO matrix FROM (
      SELECT (SELECT jsonb_agg(1) FROM generate_series(1,width)) AS row_scores FROM generate_series(1,5)
    ) AS rows;
    BEGIN
      PERFORM rv_blind_transition('b11111111111111111111111111111111','finish',
        jsonb_build_object('lease','11111111-1111-4111-8111-111111111111','score_matrix',matrix));
      RAISE EXCEPTION 'wrong dimension count accepted';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'Invalid dimensions' THEN RAISE; END IF;
      RAISE NOTICE 'PASS: database rejects % dimensions per new candidate', width;
    END;
  END LOOP;
END $$;
SELECT check_test(rv_blind_transition('b11111111111111111111111111111111','finish',
  '{"lease":"11111111-1111-4111-8111-111111111111","score_matrix":[[0,0,0,0,0,0,0],[1,1,1,1,1,1,1],[2,2,2,2,2,2,2],[3,3,3,3,3,3,3],[4,4,4,4,4,4,4]],"token_counts":{"input":100,"output":50}}')->>'status' = 'done', 'valid judgment committed');
SELECT check_test(rv_blind_transition('b11111111111111111111111111111111','claim',
  jsonb_build_object('trn','1234-5678','submission_hash',repeat('a',64),'lease','22222222-2222-4222-8222-222222222222'))->>'status' = 'done', 'replay returns committed judgment');
RESET ROLE;
SELECT check_test((SELECT attempts=1 FROM rv_blind_receipts WHERE id='b11111111111111111111111111111111'), 'replay does not consume a model attempt');
DO $$ DECLARE before_replay public.rv_blind_receipts%ROWTYPE; BEGIN
  SELECT * INTO before_replay FROM rv_blind_receipts WHERE id='b11111111111111111111111111111111';
  PERFORM check_test(before_replay.finished_at >= before_replay.created_at AND before_replay.finished_at <= clock_timestamp(), 'finished judgment has completion timestamp');
  PERFORM rv_blind_transition(before_replay.id,'claim', jsonb_build_object('trn','1234-5678','submission_hash',repeat('a',64),'lease','22222222-2222-4222-8222-222222222222'));
  PERFORM check_test((SELECT created_at=before_replay.created_at AND finished_at=before_replay.finished_at AND expires_at=before_replay.expires_at
    FROM rv_blind_receipts WHERE id=before_replay.id), 'replay preserves creation, completion and expiry timestamps');
END $$;
SELECT rv_blind_transition('b22222222222222222222222222222222','create', '{"trn":"1234-5678","candidate_ids":["T001","T002","T003","T004","T005"],"target_index":0}');
SELECT rv_blind_transition('b22222222222222222222222222222222','claim', jsonb_build_object('trn','1234-5678','submission_hash',repeat('a',64),'lease','11111111-1111-4111-8111-111111111111'));
UPDATE rv_blind_receipts SET lease_until=clock_timestamp()-interval '1 second' WHERE id='b22222222222222222222222222222222';
SELECT check_test(rv_blind_transition('b22222222222222222222222222222222','claim', jsonb_build_object('trn','1234-5678','submission_hash',repeat('a',64),'lease','22222222-2222-4222-8222-222222222222'))->>'status'='blocked', 'abandoned request fails closed');
UPDATE rv_blind_receipts SET expires_at=clock_timestamp()-interval '1 second' WHERE id='b22222222222222222222222222222222';
SELECT check_test(rv_blind_transition('b22222222222222222222222222222222','claim','{}')->>'status'='expired', 'expired receipt cannot be replayed');
UPDATE rv_blind_receipts SET expires_at=clock_timestamp()-interval '1 second' WHERE id='b11111111111111111111111111111111';
SELECT check_test(rv_blind_transition('b11111111111111111111111111111111','claim',
  jsonb_build_object('trn','1234-5678','submission_hash',repeat('a',64),'lease','22222222-2222-4222-8222-222222222222'))->>'status'='expired',
  'permanent finished receipt does not extend the two-hour replay window');
SELECT rv_blind_transition('b33333333333333333333333333333333','create', '{"trn":"1234-5678","candidate_ids":["T001","T002","T003","T004","T005"],"target_index":0}');
SELECT check_test(NOT EXISTS(SELECT 1 FROM rv_blind_receipts WHERE id='b22222222222222222222222222222222'), 'next assignment prunes expired receipt');
SELECT check_test((SELECT state='done' AND finished_at IS NOT NULL AND score_matrix IS NOT NULL FROM rv_blind_receipts WHERE id='b11111111111111111111111111111111'),
  'next assignment keeps expired finished judgment permanently');
DO $$ DECLARE initial_expiry timestamptz; BEGIN
  PERFORM rv_blind_transition('b33333333333333333333333333333333','claim', jsonb_build_object('trn','1234-5678','submission_hash',repeat('a',64),'lease','11111111-1111-4111-8111-111111111111'));
  SELECT expires_at INTO initial_expiry FROM rv_blind_receipts WHERE id='b33333333333333333333333333333333';
  PERFORM check_test(initial_expiry BETWEEN clock_timestamp()+interval '1 hour 59 minutes' AND clock_timestamp()+interval '2 hours', 'first claim starts the unchanged two-hour retry window');
  PERFORM rv_blind_transition('b33333333333333333333333333333333','fail','{"lease":"11111111-1111-4111-8111-111111111111","retryable":true}');
  PERFORM rv_blind_transition('b33333333333333333333333333333333','claim', jsonb_build_object('trn','1234-5678','submission_hash',repeat('a',64),'lease','11111111-1111-4111-8111-111111111111'));
  PERFORM check_test((SELECT expires_at=initial_expiry AND finished_at IS NULL FROM rv_blind_receipts WHERE id='b33333333333333333333333333333333'), 'retry never extends expiry or marks an unfinished receipt complete');
END $$;
-- Restore this unfinished fixture for the existing three-attempt check.
UPDATE rv_blind_receipts SET state='ready', attempts=0, submission_hash=NULL WHERE id='b33333333333333333333333333333333';
DO $$ DECLARE i integer; status text; BEGIN
  FOR i IN 1..3 LOOP
    status := rv_blind_transition('b33333333333333333333333333333333','claim', jsonb_build_object('trn','1234-5678','submission_hash',repeat('a',64),'lease','11111111-1111-4111-8111-111111111111'))->>'status';
    IF status <> 'claimed' THEN RAISE EXCEPTION 'Retry unexpectedly denied'; END IF;
    PERFORM rv_blind_transition('b33333333333333333333333333333333','fail','{"lease":"11111111-1111-4111-8111-111111111111","retryable":true}');
  END LOOP;
  PERFORM check_test(rv_blind_transition('b33333333333333333333333333333333','claim', jsonb_build_object('trn','1234-5678','submission_hash',repeat('a',64),'lease','11111111-1111-4111-8111-111111111111'))->>'status'='blocked', 'maximum three confirmed attempts');
END $$;

DO $$ DECLARE pending_state text; receipt_id text; i integer := 5; BEGIN
  FOREACH pending_state IN ARRAY ARRAY['ready','running','retry','blocked'] LOOP
    receipt_id := 'b' || repeat(i::text,32);
    INSERT INTO rv_blind_receipts(id,trn,candidate_ids,target_index,state,expires_at)
      VALUES(receipt_id,'1234-5678',ARRAY['T001','T002','T003','T004','T005'],0,pending_state,clock_timestamp()-interval '1 second');
    i := i+1;
  END LOOP;
  PERFORM rv_blind_transition('b99999999999999999999999999999999','create', '{"trn":"1234-5678","candidate_ids":["T001","T002","T003","T004","T005"],"target_index":0}');
  PERFORM check_test(NOT EXISTS(SELECT 1 FROM rv_blind_receipts WHERE expires_at < clock_timestamp() AND state <> 'done'), 'all expired unfinished states are pruned');
  PERFORM check_test(EXISTS(SELECT 1 FROM rv_blind_receipts WHERE id='b11111111111111111111111111111111')
    AND EXISTS(SELECT 1 FROM rv_blind_receipts WHERE id='b33333333333333333333333333333333'), 'repeated cleanup preserves finished judgments and unexpired unfinished receipts');
END $$;

INSERT INTO rv_sessions(id,user_id,session_type,trn,notes,duration,timestamp) VALUES
  (1,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','personal','1234-5678','synthetic test notes',20,'2026-10-15T12:00:00Z');
CREATE TABLE test_payload(data jsonb);
INSERT INTO test_payload SELECT to_jsonb(r) || '{"score":40,"blind_judging":{"protocol":"blind-five-v1","candidates":[{},{},{},{},{}]},"target_id":1,"summary":"synthetic result"}'::jsonb FROM rv_sessions r WHERE id=1;
GRANT SELECT ON test_payload TO authenticated;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false);
SELECT check_test(NOT rv_complete_blind_session((SELECT data FROM test_payload)), 'other account cannot finish this row');
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
SELECT check_test(NOT rv_complete_blind_session((SELECT data || '{"notes":"different"}'::jsonb FROM test_payload)), 'changed notes cannot overwrite saved session');
SELECT check_test(NOT rv_complete_blind_session((SELECT data || '{"sketch_data":"different"}'::jsonb FROM test_payload)), 'changed sketch cannot overwrite saved session');
SELECT check_test(rv_complete_blind_session((SELECT data FROM test_payload)), 'same owner completes exact ungraded session');
SELECT check_test((SELECT score=40 AND blind_judging->>'protocol'='blind-five-v1' FROM rv_sessions WHERE id=1), 'rank metadata survives cloud persistence');
SELECT check_test(NOT rv_complete_blind_session((SELECT data || '{"score":99}'::jsonb FROM test_payload)), 'completed score cannot be replaced by retry');
RESET ROLE;
SELECT rv_blind_transition('b44444444444444444444444444444444','create', '{"trn":"1234-5678","candidate_ids":["T001","T002","T003","T004","T005"],"target_index":0}');
SQL

# Real overlapping transactions: caller two waits for caller one's row lock.
psql -XqtA -v ON_ERROR_STOP=1 >"$ABLTY_TEST_TMP/first" <<'SQL' &
BEGIN;
SET LOCAL application_name='ablty_blind_concurrency';
SELECT rv_blind_transition('b44444444444444444444444444444444','claim', jsonb_build_object('trn','1234-5678','submission_hash',repeat('a',64),'lease','11111111-1111-4111-8111-111111111111'))->>'status';
SELECT pg_sleep(2);
COMMIT;
SQL
ABLTY_FIRST_PID=$!
for attempt in $(seq 1 100); do
  if [[ $(psql -XqtA -c "SELECT count(*) FROM pg_stat_activity WHERE application_name='ablty_blind_concurrency' AND wait_event='PgSleep'") == 1 ]]; then break; fi
done
ABLTY_SECOND=$(psql -XqtA -v ON_ERROR_STOP=1 -c "SELECT rv_blind_transition('b44444444444444444444444444444444','claim', jsonb_build_object('trn','1234-5678','submission_hash',repeat('a',64),'lease','22222222-2222-4222-8222-222222222222'))->>'status'")
wait "$ABLTY_FIRST_PID"
[[ $(head -n 1 "$ABLTY_TEST_TMP/first") == claimed && "$ABLTY_SECOND" == busy ]]
echo 'PASS: concurrent database transactions authorize exactly one model caller'
