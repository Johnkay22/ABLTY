-- Step 9. Apply separately, before releasing the app/Worker. Never run by CI
-- against production. Rollback: restore the previous Worker/app first. Keep
-- rv_blind_receipts, rv_sessions.blind_judging and rv_sessions.blind_receipt_id
-- to preserve finished numeric judgments, history and the link between them;
-- removing any of them is intentionally not part of rollback.
BEGIN;

ALTER TABLE public.rv_sessions ADD COLUMN IF NOT EXISTS blind_judging jsonb;
-- The finished receipt a blind-judged session was graded from. Null for older,
-- legacy and ungraded sessions. rv_sessions.score is written by the owner's
-- device; anything shown to other users must recompute from this receipt.
ALTER TABLE public.rv_sessions ADD COLUMN IF NOT EXISTS blind_receipt_id text
  CONSTRAINT rv_sessions_blind_receipt_id_format CHECK (blind_receipt_id ~ '^b[0-9a-f]{32}$');
-- One receipt can back only one session, across all accounts.
CREATE UNIQUE INDEX rv_sessions_blind_receipt_id_key ON public.rv_sessions(blind_receipt_id)
  WHERE blind_receipt_id IS NOT NULL;

CREATE TABLE public.rv_blind_receipts (
  id text PRIMARY KEY CHECK (id ~ '^b[0-9a-f]{32}$'),
  trn text NOT NULL CHECK (trn ~ '^[0-9]{4}-[0-9]{4}$'),
  candidate_ids text[] NOT NULL CHECK (cardinality(candidate_ids) = 5),
  target_index integer NOT NULL CHECK (target_index BETWEEN 0 AND 4),
  submission_hash text CHECK (submission_hash ~ '^[0-9a-f]{64}$'),
  state text NOT NULL DEFAULT 'ready' CHECK (state IN ('ready','running','retry','done','blocked')),
  lease uuid,
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  -- Only the older six-dimension format. Seven-dimension judgments use
  -- rotation_matrices instead.
  score_matrix jsonb,
  -- Five judge passes, one per candidate order. Each is five rows of seven
  -- integer ratings, rows in candidate_ids order (not label order). In pass k
  -- the photo shown under label p was candidate (p + k) % 5.
  rotation_matrices jsonb,
  token_counts jsonb,
  protocol text NOT NULL DEFAULT 'blind-five-v1',
  model text NOT NULL DEFAULT 'gemini-2.5-flash',
  rubric text NOT NULL DEFAULT 'seven-dimensions-v1',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '2 hours')
);
CREATE INDEX rv_blind_receipts_expiry ON public.rv_blind_receipts(expires_at) WHERE state <> 'done';
ALTER TABLE public.rv_blind_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rv_blind_receipts FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE public.rv_blind_receipts IS
  'Service-only numeric judging receipts. Finished judgments are retained permanently with creation and completion timestamps. Only expired unfinished receipts are pruned on assignment creation. Claims and retries expire after two hours. No account IDs, raw session content or generated descriptions.';

CREATE FUNCTION public.rv_blind_transition(p_id text, p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r public.rv_blind_receipts%ROWTYPE;
  ids text[];
  matrix jsonb;
  row_value jsonb;
  value jsonb;
BEGIN
  IF p_id IS NULL OR p_id !~ '^b[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'Invalid receipt id';
  END IF;
  IF p_action = 'create' THEN
    ids := ARRAY(SELECT jsonb_array_elements_text(p_payload->'candidate_ids'));
    IF cardinality(ids) <> 5 OR (SELECT count(DISTINCT x) FROM unnest(ids) AS x) <> 5
      OR EXISTS (SELECT 1 FROM unnest(ids) AS x WHERE x !~ '^T[0-9]{3}$') THEN
      RAISE EXCEPTION 'Invalid candidate set';
    END IF;
    DELETE FROM public.rv_blind_receipts WHERE state <> 'done' AND expires_at < clock_timestamp();
    INSERT INTO public.rv_blind_receipts(id, trn, candidate_ids, target_index)
      VALUES(p_id, p_payload->>'trn', ids, (p_payload->>'target_index')::integer);
    RETURN jsonb_build_object('status', 'created');
  END IF;

  SELECT * INTO r FROM public.rv_blind_receipts WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR r.expires_at <= clock_timestamp() THEN
    RETURN jsonb_build_object('status', 'expired');
  END IF;
  IF p_action = 'claim' THEN
    IF p_payload->>'submission_hash' IS NULL OR p_payload->>'submission_hash' !~ '^[0-9a-f]{64}$'
      OR p_payload->>'trn' IS DISTINCT FROM r.trn THEN
      RETURN jsonb_build_object('status', 'mismatch');
    END IF;
    IF r.submission_hash IS NOT NULL AND r.submission_hash <> p_payload->>'submission_hash' THEN
      RETURN jsonb_build_object('status', 'mismatch');
    END IF;
    IF r.state = 'done' THEN
      RETURN jsonb_build_object('status', 'done', 'record', to_jsonb(r));
    END IF;
    IF r.state = 'running' THEN
      IF r.lease_until > clock_timestamp() THEN RETURN jsonb_build_object('status', 'busy'); END IF;
      -- An interrupted model call may already have been billed/completed.
      -- Never give another caller permission to judge it again.
      UPDATE public.rv_blind_receipts SET state = 'blocked' WHERE id = p_id;
      RETURN jsonb_build_object('status', 'blocked');
    END IF;
    IF r.state = 'blocked' OR r.attempts >= 3 THEN
      RETURN jsonb_build_object('status', 'blocked');
    END IF;
    UPDATE public.rv_blind_receipts SET
      submission_hash = p_payload->>'submission_hash', state = 'running',
      lease = (p_payload->>'lease')::uuid, lease_until = clock_timestamp() + interval '3 minutes',
      expires_at = CASE WHEN submission_hash IS NULL THEN clock_timestamp() + interval '2 hours' ELSE expires_at END,
      attempts = attempts + 1
      WHERE id = p_id RETURNING * INTO r;
    RETURN jsonb_build_object('status', 'claimed', 'record', to_jsonb(r));
  END IF;

  IF r.state <> 'running' OR r.lease IS DISTINCT FROM (p_payload->>'lease')::uuid THEN
    RETURN jsonb_build_object('status', 'stale');
  END IF;
  IF p_action = 'fail' THEN
    UPDATE public.rv_blind_receipts SET state = CASE
      WHEN p_payload->>'retryable' = 'true' AND attempts < 3 THEN 'retry' ELSE 'blocked' END
      WHERE id = p_id;
    RETURN jsonb_build_object('status', 'failed');
  END IF;
  IF p_action = 'finish' THEN
    IF jsonb_typeof(p_payload->'rotation_matrices') IS DISTINCT FROM 'array'
      OR jsonb_array_length(p_payload->'rotation_matrices') <> 5 THEN RAISE EXCEPTION 'Invalid rotations'; END IF;
    FOR matrix IN SELECT jsonb_array_elements(p_payload->'rotation_matrices') LOOP
      IF jsonb_typeof(matrix) IS DISTINCT FROM 'array' OR jsonb_array_length(matrix) <> 5 THEN
        RAISE EXCEPTION 'Invalid scores';
      END IF;
      FOR row_value IN SELECT jsonb_array_elements(matrix) LOOP
        IF jsonb_typeof(row_value) IS DISTINCT FROM 'array' OR jsonb_array_length(row_value) <> 7 THEN
          RAISE EXCEPTION 'Invalid dimensions';
        END IF;
        FOR value IN SELECT jsonb_array_elements(row_value) LOOP
          IF jsonb_typeof(value) <> 'number' OR value::text !~ '^[0-5]$' THEN RAISE EXCEPTION 'Invalid score'; END IF;
        END LOOP;
      END LOOP;
    END LOOP;
    UPDATE public.rv_blind_receipts SET state = 'done', finished_at = clock_timestamp(), rotation_matrices = p_payload->'rotation_matrices',
      token_counts = CASE WHEN jsonb_typeof(p_payload->'token_counts') = 'object' THEN jsonb_build_object(
        'input', greatest(0, least(1000000, coalesce((p_payload->'token_counts'->>'input')::integer, 0))),
        'output', greatest(0, least(1000000, coalesce((p_payload->'token_counts'->>'output')::integer, 0))),
        'thinking', greatest(0, least(1000000, coalesce((p_payload->'token_counts'->>'thinking')::integer, 0)))) ELSE NULL END
      WHERE id = p_id RETURNING * INTO r;
    RETURN jsonb_build_object('status', 'done', 'record', to_jsonb(r));
  END IF;
  RAISE EXCEPTION 'Invalid transition';
END;
$$;
REVOKE ALL ON FUNCTION public.rv_blind_transition(text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rv_blind_transition(text, text, jsonb) TO service_role;

-- Complete this owner's previously saved, ungraded session after a retry.
-- Row locking makes the content comparison and update one operation. The
-- caller's existing rv_sessions RLS still applies (SECURITY INVOKER). The
-- receipt id must be well formed, match the judgment and match the receipt
-- the ungraded session recorded; a receipt already backing another session
-- returns false instead of raising.
CREATE FUNCTION public.rv_complete_blind_session(p_row jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE r public.rv_sessions%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR p_row->'blind_judging'->>'protocol' IS DISTINCT FROM 'blind-five-v1'
    OR jsonb_typeof(p_row->'blind_receipt_id') IS DISTINCT FROM 'string'
    OR p_row->>'blind_receipt_id' !~ '^b[0-9a-f]{32}$'
    OR p_row->'blind_judging'->>'assignment_id' IS DISTINCT FROM p_row->>'blind_receipt_id'
    OR jsonb_typeof(p_row->'blind_judging'->'candidates') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_row->'blind_judging'->'candidates') <> 5
    OR jsonb_typeof(p_row->'score') IS DISTINCT FROM 'number'
    OR p_row->>'score' !~ '^[0-9]{1,3}$'
    OR (p_row->>'score')::integer NOT BETWEEN 0 AND 100 THEN RETURN false; END IF;
  SELECT * INTO r FROM public.rv_sessions WHERE id = (p_row->>'id')::bigint AND user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND OR r.score IS NOT NULL
    OR r.blind_judging->>'assignment_id' IS DISTINCT FROM p_row->>'blind_receipt_id'
    OR coalesce(r.blind_receipt_id, p_row->>'blind_receipt_id') IS DISTINCT FROM p_row->>'blind_receipt_id' THEN RETURN false; END IF;
  IF r.trn IS DISTINCT FROM p_row->>'trn'
    OR nullif(r.notes, '') IS DISTINCT FROM nullif(p_row->>'notes', '')
    OR nullif(r.sketch_data, '') IS DISTINCT FROM nullif(p_row->>'sketch_data', '')
    OR r.duration IS DISTINCT FROM (p_row->>'duration')::numeric
    OR r.timestamp IS DISTINCT FROM (p_row->>'timestamp')::timestamptz
    OR r.session_type IS DISTINCT FROM p_row->>'session_type' THEN RETURN false; END IF;
  UPDATE public.rv_sessions SET score = (p_row->>'score')::integer,
    target_id = (p_row->>'target_id')::integer, target_src = p_row->>'target_src',
    target_label = p_row->>'target_label', category = p_row->>'category',
    dimension_scores = p_row->'dimension_scores', blind_judging = p_row->'blind_judging',
    blind_receipt_id = p_row->>'blind_receipt_id', summary = p_row->>'summary'
    WHERE id = r.id AND user_id = auth.uid();
  RETURN FOUND;
EXCEPTION WHEN unique_violation THEN
  RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.rv_complete_blind_session(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rv_complete_blind_session(jsonb) TO authenticated;
COMMIT;
