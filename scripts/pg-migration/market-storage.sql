-- Temporary incoming objects only. Keep the historical image_cleanup records in rehub_reports.
BEGIN;

CREATE TABLE public.rehub_incoming_cleanup (
  file_id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES public.rehub_users(id),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 6),
  next_attempt_at public.rehub_epoch_ms NOT NULL,
  claim_token uuid NOT NULL
);
CREATE INDEX rehub_incoming_cleanup_due ON public.rehub_incoming_cleanup(owner_id, next_attempt_at) WHERE attempts < 6;
ALTER TABLE public.rehub_incoming_cleanup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rehub_incoming_cleanup FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.rehub_incoming_cleanup TO service_role;

CREATE FUNCTION public.rehub_market_claim_incoming(p_actor_id text, p_storage_prefix text, p_file_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE
  path_prefix text;
  token uuid := gen_random_uuid();
  now_ms bigint := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  jobs jsonb;
BEGIN
  IF current_user <> 'service_role' OR p_actor_id IS NULL OR p_actor_id !~ '^[A-Za-z0-9_-]{1,128}$'
    OR coalesce(p_storage_prefix, '') !~ '^cloud://[A-Za-z0-9._-]+/$' THEN RAISE insufficient_privilege; END IF;
  path_prefix := p_storage_prefix || 'incoming/' || p_actor_id || '/';
  IF p_file_id IS NOT NULL THEN
    IF NOT starts_with(p_file_id, path_prefix) OR substring(p_file_id FROM length(path_prefix) + 1)
      !~ '^[A-Za-z0-9_-]{8,80}\.(jpg|jpeg|png|webp)$' THEN RAISE insufficient_privilege; END IF;
    INSERT INTO public.rehub_incoming_cleanup(file_id, owner_id, next_attempt_at, claim_token)
      VALUES (p_file_id, p_actor_id, now_ms + 120000, token) ON CONFLICT (file_id) DO NOTHING;
    RETURN CASE WHEN FOUND THEN jsonb_build_object('fileID', p_file_id, 'token', token) END;
  END IF;

  WITH ready AS (
    SELECT file_id FROM public.rehub_incoming_cleanup WHERE owner_id = p_actor_id
      AND attempts < 6 AND next_attempt_at <= now_ms AND starts_with(file_id, path_prefix)
      AND substring(file_id FROM length(path_prefix) + 1) ~ '^[A-Za-z0-9_-]{8,80}\.(jpg|jpeg|png|webp)$'
    ORDER BY next_attempt_at, file_id LIMIT 3 FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.rehub_incoming_cleanup job SET claim_token = token, next_attempt_at = now_ms + 120000
      FROM ready WHERE job.file_id = ready.file_id RETURNING job.file_id
  ) SELECT coalesce(jsonb_agg(jsonb_build_object('fileID', file_id, 'token', token)), '[]'::jsonb) INTO jobs FROM claimed;
  RETURN jobs;
END;
$$;

CREATE FUNCTION public.rehub_market_finish_incoming(p_actor_id text, p_file_id text, p_token uuid, p_deleted boolean) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
  IF current_user <> 'service_role' OR p_deleted IS NULL THEN RAISE insufficient_privilege; END IF;
  IF p_deleted THEN
    DELETE FROM public.rehub_incoming_cleanup WHERE file_id = p_file_id AND owner_id = p_actor_id AND claim_token = p_token;
  ELSE
    UPDATE public.rehub_incoming_cleanup SET attempts = attempts + 1,
      next_attempt_at = floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint + (60000::bigint << attempts)
      WHERE file_id = p_file_id AND owner_id = p_actor_id AND claim_token = p_token AND attempts < 6;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.rehub_market_claim_incoming(text,text,text), public.rehub_market_finish_incoming(text,text,uuid,boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rehub_market_claim_incoming(text,text,text), public.rehub_market_finish_incoming(text,text,uuid,boolean)
  TO service_role;

COMMIT;
