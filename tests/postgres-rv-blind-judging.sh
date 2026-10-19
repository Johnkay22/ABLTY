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
  'score_matrix','rotation_matrices','token_counts','protocol','model','rubric','created_at','finished_at','expires_at']
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
-- rotations(passes, rows, width, value) builds a rotation_matrices payload.
CREATE FUNCTION pg_temp.rotations(passes integer, row_count integer, width integer, value jsonb DEFAULT '1') RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_agg((SELECT jsonb_agg((SELECT jsonb_agg(value) FROM generate_series(1,width))) FROM generate_series(1,row_count)))
  FROM generate_series(1,passes) $$;
DO $$ DECLARE bad jsonb; BEGIN
  bad := jsonb_set(pg_temp.rotations(5,5,7), '{4,0,0}', '8');
  PERFORM rv_blind_transition('b11111111111111111111111111111111','finish',
    jsonb_build_object('lease','11111111-1111-4111-8111-111111111111','rotation_matrices',bad));
  RAISE EXCEPTION 'invalid scores accepted';
EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'Invalid score' THEN RAISE; END IF; RAISE NOTICE 'PASS: database validates numeric scores in every rotation'; END $$;
DO $$ DECLARE value jsonb; BEGIN
  FOREACH value IN ARRAY ARRAY['2.5'::jsonb, '3.0'::jsonb, '"3"'::jsonb] LOOP
    BEGIN
      PERFORM rv_blind_transition('b11111111111111111111111111111111','finish',
        jsonb_build_object('lease','11111111-1111-4111-8111-111111111111','rotation_matrices',pg_temp.rotations(5,5,7,value)));
      RAISE EXCEPTION 'non-integer rating accepted';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'Invalid score' THEN RAISE; END IF;
      RAISE NOTICE 'PASS: database rejects rating %', value;
    END;
  END LOOP;
END $$;
DO $$ DECLARE width integer; BEGIN
  FOREACH width IN ARRAY ARRAY[6,8] LOOP
    BEGIN
      PERFORM rv_blind_transition('b11111111111111111111111111111111','finish',
        jsonb_build_object('lease','11111111-1111-4111-8111-111111111111','rotation_matrices',pg_temp.rotations(5,5,width)));
      RAISE EXCEPTION 'wrong dimension count accepted';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'Invalid dimensions' THEN RAISE; END IF;
      RAISE NOTICE 'PASS: database rejects % dimensions per new candidate', width;
    END;
  END LOOP;
END $$;
DO $$ DECLARE shape integer[]; expected text; payload jsonb; BEGIN
  FOREACH shape SLICE 1 IN ARRAY ARRAY[[4,5],[6,5],[5,4],[5,6],[0,0]] LOOP
    expected := CASE WHEN shape[1] <> 5 THEN 'Invalid rotations' ELSE 'Invalid scores' END;
    payload := CASE WHEN shape[1] = 0
      -- The older single-matrix payload is refused for new judgments.
      THEN '{"lease":"11111111-1111-4111-8111-111111111111","score_matrix":[[1,1,1,1,1,1,1],[1,1,1,1,1,1,1],[1,1,1,1,1,1,1],[1,1,1,1,1,1,1],[1,1,1,1,1,1,1]]}'::jsonb
      ELSE jsonb_build_object('lease','11111111-1111-4111-8111-111111111111','rotation_matrices',pg_temp.rotations(shape[1],shape[2],7)) END;
    BEGIN
      PERFORM rv_blind_transition('b11111111111111111111111111111111','finish',payload);
      RAISE EXCEPTION 'wrong rotation shape accepted';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> expected THEN RAISE; END IF;
      IF shape[1] = 0 THEN RAISE NOTICE 'PASS: database rejects the older single-matrix payload';
      ELSE RAISE NOTICE 'PASS: database rejects % rotations of % candidates', shape[1], shape[2]; END IF;
    END;
  END LOOP;
END $$;
SELECT check_test(rv_blind_transition('b11111111111111111111111111111111','finish',
  jsonb_build_object('lease','11111111-1111-4111-8111-111111111111','rotation_matrices',
    jsonb_set(pg_temp.rotations(5,5,7,'0'), '{2,3}', '[3,3,3,3,3,3,3]'),'token_counts','{"input":500,"output":250}'::jsonb))->>'status' = 'done', 'valid five-rotation judgment committed');
SELECT check_test(rv_blind_transition('b11111111111111111111111111111111','claim',
  jsonb_build_object('trn','1234-5678','submission_hash',repeat('a',64),'lease','22222222-2222-4222-8222-222222222222'))->>'status' = 'done', 'replay returns committed judgment');
RESET ROLE;
SELECT check_test((SELECT rotation_matrices->2->3 = '[3,3,3,3,3,3,3]'::jsonb AND jsonb_array_length(rotation_matrices) = 5 AND score_matrix IS NULL
  FROM rv_blind_receipts WHERE id='b11111111111111111111111111111111'), 'receipt keeps all five rotations in candidate order');
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
SELECT check_test((SELECT state='done' AND finished_at IS NOT NULL AND rotation_matrices IS NOT NULL FROM rv_blind_receipts WHERE id='b11111111111111111111111111111111'),
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

-- Row 1 is a failed blind session saved with its assignment, as the app does.
INSERT INTO rv_sessions(id,user_id,session_type,trn,notes,duration,timestamp,blind_judging) VALUES
  (1,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','personal','1234-5678','synthetic test notes',20,'2026-10-15T12:00:00Z',
   '{"protocol":"blind-five-v1","assignment_id":"beeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","retryable":true}');
CREATE TABLE test_payload(data jsonb);
INSERT INTO test_payload SELECT to_jsonb(r) || '{"score":40,"blind_judging":{"protocol":"blind-five-v1","assignment_id":"beeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","candidates":[{},{},{},{},{}]},"blind_receipt_id":"beeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","target_id":1,"summary":"synthetic result"}'::jsonb FROM rv_sessions r WHERE id=1;
GRANT SELECT ON test_payload TO authenticated;
SELECT check_test((SELECT data ? 'blind_receipt_id' FROM test_payload) AND (SELECT blind_receipt_id IS NULL FROM rv_sessions WHERE id=1),
  'failed session is saved without a receipt link');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false);
SELECT check_test(NOT rv_complete_blind_session((SELECT data FROM test_payload)), 'other account cannot finish this row');
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
SELECT check_test(NOT rv_complete_blind_session((SELECT data || '{"notes":"different"}'::jsonb FROM test_payload)), 'changed notes cannot overwrite saved session');
SELECT check_test(NOT rv_complete_blind_session((SELECT data || '{"sketch_data":"different"}'::jsonb FROM test_payload)), 'changed sketch cannot overwrite saved session');
SELECT check_test(NOT rv_complete_blind_session((SELECT data - 'blind_receipt_id' FROM test_payload)), 'retry without a receipt id is refused');
SELECT check_test(NOT rv_complete_blind_session((SELECT data || '{"blind_receipt_id":null}'::jsonb FROM test_payload)), 'retry with a null receipt id is refused');
SELECT check_test(NOT rv_complete_blind_session((SELECT data || '{"blind_receipt_id":"bEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE"}'::jsonb FROM test_payload)), 'retry with a malformed receipt id is refused');
SELECT check_test(NOT rv_complete_blind_session((SELECT data || '{"blind_receipt_id":12345}'::jsonb FROM test_payload)), 'retry with a non-text receipt id is refused');
SELECT check_test(NOT rv_complete_blind_session((SELECT data || '{"blind_receipt_id":"bffffffffffffffffffffffffffffffff"}'::jsonb FROM test_payload)), 'receipt id must match the judgment');
SELECT check_test(NOT rv_complete_blind_session((SELECT jsonb_set(data || '{"blind_receipt_id":"bffffffffffffffffffffffffffffffff"}'::jsonb,
  '{blind_judging,assignment_id}','"bffffffffffffffffffffffffffffffff"') FROM test_payload)), 'retry cannot switch to a receipt the saved session did not record');
SELECT check_test((SELECT score IS NULL AND blind_receipt_id IS NULL FROM rv_sessions WHERE id=1), 'refused retries leave the saved session unchanged');
SELECT check_test(rv_complete_blind_session((SELECT data FROM test_payload)), 'same owner completes exact ungraded session');
SELECT check_test((SELECT score=40 AND blind_judging->>'protocol'='blind-five-v1' FROM rv_sessions WHERE id=1), 'rank metadata survives cloud persistence');
SELECT check_test((SELECT blind_receipt_id='beeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' FROM rv_sessions WHERE id=1), 'retry path saves the receipt id');
SELECT check_test(NOT rv_complete_blind_session((SELECT data || '{"score":99}'::jsonb FROM test_payload)), 'completed score cannot be replaced by retry');
-- A successful first-time save is a plain insert that carries its receipt id.
INSERT INTO rv_sessions(id,user_id,session_type,trn,score,notes,timestamp,blind_judging,blind_receipt_id) VALUES
  (2,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','personal','2345-6789',55,'written','2026-10-15T13:00:00Z',
   '{"protocol":"blind-five-v1","assignment_id":"b12121212121212121212121212121212"}','b12121212121212121212121212121212');
SELECT check_test((SELECT blind_receipt_id='b12121212121212121212121212121212' FROM rv_sessions WHERE id=2), 'successful session saves its receipt id');
DO $$ BEGIN
  INSERT INTO public.rv_sessions(id,user_id,trn,score,blind_receipt_id) VALUES (3,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2345-6789',90,'b12121212121212121212121212121212');
  RAISE EXCEPTION 'shared receipt accepted';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'PASS: two sessions of one account cannot share a receipt id'; END $$;
DO $$ BEGIN
  INSERT INTO public.rv_sessions(id,user_id,trn,score,blind_receipt_id) VALUES (4,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2345-6789',90,'not-a-receipt');
  RAISE EXCEPTION 'malformed receipt accepted';
EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS: malformed receipt id is rejected by the database'; END $$;
-- Older sessions, legacy grades and six-dimension results keep a null link.
INSERT INTO rv_sessions(id,user_id,session_type,trn,score,notes,timestamp,blind_judging) VALUES
  (5,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','personal','3456-7890',70,'older legacy session','2026-09-01T12:00:00Z',NULL),
  (6,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','personal','4567-8901',44,'older six-dimension session','2026-10-14T12:00:00Z',
   '{"protocol":"blind-five-v1","rubric":"six-dimensions-v1","candidates":[{},{},{},{},{}]}');
SELECT check_test((SELECT count(*)=2 FROM rv_sessions WHERE id IN (5,6) AND blind_receipt_id IS NULL AND score IS NOT NULL),
  'old sessions without a receipt id still save and load');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',false);
DO $$ BEGIN
  INSERT INTO public.rv_sessions(id,user_id,trn,score,blind_receipt_id) VALUES (7,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','2345-6789',90,'b12121212121212121212121212121212');
  RAISE EXCEPTION 'shared receipt accepted across accounts';
EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'PASS: two accounts cannot share a receipt id'; END $$;
-- A retry whose receipt already backs another session returns false, never raises.
INSERT INTO rv_sessions(id,user_id,session_type,trn,notes,duration,timestamp,blind_judging) VALUES
  (8,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','personal','2345-6789','written',20,'2026-10-15T14:00:00Z',
   '{"protocol":"blind-five-v1","assignment_id":"b12121212121212121212121212121212","retryable":true}');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
SELECT check_test(NOT rv_complete_blind_session((SELECT to_jsonb(r) || '{"score":60,"blind_judging":{"protocol":"blind-five-v1","assignment_id":"b12121212121212121212121212121212","candidates":[{},{},{},{},{}]},"blind_receipt_id":"b12121212121212121212121212121212"}'::jsonb
  FROM rv_sessions r WHERE id=8)), 'retry onto a receipt that already backs another session returns false');
SELECT check_test((SELECT score IS NULL AND blind_receipt_id IS NULL FROM rv_sessions WHERE id=8), 'that ungraded session is left unchanged');
SELECT check_test((SELECT count(*)=1 FROM rv_sessions WHERE blind_receipt_id='b12121212121212121212121212121212'), 'the receipt still backs exactly one session');
-- Control: once the receipt is free, the same retry succeeds, so the refusal above was the shared receipt.
UPDATE rv_sessions SET blind_receipt_id=NULL WHERE id=2;
SELECT check_test(rv_complete_blind_session((SELECT to_jsonb(r) || '{"score":60,"blind_judging":{"protocol":"blind-five-v1","assignment_id":"b12121212121212121212121212121212","candidates":[{},{},{},{},{}]},"blind_receipt_id":"b12121212121212121212121212121212"}'::jsonb
  FROM rv_sessions r WHERE id=8)), 'same retry succeeds when its receipt is not shared');
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
