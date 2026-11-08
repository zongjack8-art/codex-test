-- Apply after the first two market batches.
BEGIN;

CREATE FUNCTION public.rehub_market_create_review(p_actor_id text, p_order_id text, p_rating integer,
  p_content text, p_school text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE
  target public.rehub_orders%ROWTYPE;
BEGIN
  IF current_user <> 'service_role' THEN RAISE insufficient_privilege; END IF;
  SELECT * INTO target FROM public.rehub_orders WHERE id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'MARKET_ORDER_MISSING'; END IF;
  IF p_actor_id IS NULL OR p_actor_id NOT IN (target.buyer_id, target.seller_id) THEN
    RAISE insufficient_privilege USING MESSAGE = 'MARKET_REVIEW_FORBIDDEN';
  END IF;
  IF target.buyer_id <> p_actor_id THEN RAISE insufficient_privilege USING MESSAGE = 'MARKET_REVIEW_BUYER_ONLY'; END IF;
  IF target.status <> 'completed' THEN RAISE check_violation USING MESSAGE = 'MARKET_REVIEW_NOT_COMPLETE'; END IF;

  INSERT INTO public.rehub_reviews(id, order_id, product_id, buyer_id, seller_id, rating, content, school, created_at)
  VALUES (gen_random_uuid()::text, target.id, target.product_id, target.buyer_id, target.seller_id, p_rating, p_content,
    p_school, floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint)
  ON CONFLICT (order_id) DO NOTHING;
  IF NOT FOUND THEN RAISE unique_violation USING MESSAGE = 'MARKET_ALREADY_REVIEWED'; END IF;
END;
$$;

CREATE FUNCTION public.rehub_market_seller_review_summary(p_seller_id text, p_school text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
  IF current_user <> 'service_role' THEN RAISE insufficient_privilege; END IF;
  RETURN (SELECT jsonb_build_object('averageRating', coalesce(round(avg(rating), 1), 0), 'reviewCount', count(*))
    FROM public.rehub_reviews WHERE seller_id = p_seller_id AND school = p_school);
END;
$$;

CREATE FUNCTION public.rehub_market_create_report(p_actor_id text, p_product_id text, p_school text,
  p_reason text, p_description text) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE
  item public.rehub_products%ROWTYPE;
  now_ms bigint;
BEGIN
  IF current_user <> 'service_role' THEN RAISE insufficient_privilege; END IF;
  -- Serialize duplicate and daily-limit checks per reporter.
  PERFORM 1 FROM public.rehub_users WHERE id = p_actor_id AND school = p_school FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE insufficient_privilege; END IF;
  SELECT * INTO item FROM public.rehub_products WHERE id = p_product_id AND school = p_school AND status <> 'deleted' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MARKET_PRODUCT_MISSING'; END IF;
  IF item.seller_id = p_actor_id THEN RAISE EXCEPTION 'MARKET_REPORT_SELF'; END IF;
  IF EXISTS (SELECT 1 FROM public.rehub_reports WHERE reporter_id = p_actor_id AND product_id = p_product_id
    AND type = 'product' AND status = 'pending') THEN RETURN false; END IF;
  now_ms := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  IF (SELECT count(*) FROM public.rehub_reports WHERE reporter_id = p_actor_id AND type = 'product'
    AND created_at >= now_ms - 86400000) >= 10 THEN RAISE check_violation USING MESSAGE = 'MARKET_REPORT_LIMIT'; END IF;
  INSERT INTO public.rehub_reports(id, type, reporter_id, product_id, reason, description, school, status, created_at, updated_at)
  VALUES (gen_random_uuid()::text, 'product', p_actor_id, p_product_id, p_reason, p_description, p_school, 'pending', now_ms, now_ms)
  ON CONFLICT (reporter_id, product_id) WHERE type = 'product' AND status = 'pending' DO NOTHING;
  RETURN FOUND;
END;
$$;

CREATE FUNCTION public.rehub_market_admin_identity(p_app_id text, p_open_id text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
  IF current_user <> 'service_role' THEN RAISE insufficient_privilege; END IF;
  RETURN (SELECT i.user_id FROM public.rehub_admins a
    JOIN public.rehub_wechat_identities i USING (app_id, open_id)
    WHERE a.app_id = p_app_id AND a.open_id = p_open_id AND a.enabled AND a.role = 'admin');
END;
$$;

CREATE FUNCTION public.rehub_market_reports(p_actor_id text, p_app_id text, p_open_id text, p_school text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
  IF current_user <> 'service_role' THEN RAISE insufficient_privilege; END IF;
  IF p_actor_id IS NULL AND public.rehub_market_admin_identity(p_app_id, p_open_id) IS NULL THEN
    RAISE insufficient_privilege USING MESSAGE = 'MARKET_ADMIN_REQUIRED';
  END IF;
  IF p_actor_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.rehub_wechat_identities
    WHERE app_id = p_app_id AND open_id = p_open_id AND user_id = p_actor_id) THEN RAISE insufficient_privilege; END IF;
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(page) ORDER BY page.created_at DESC, page.id), '[]'::jsonb) FROM (
    SELECT id, product_id, reporter_id, reason, description, status, resolution, created_at, resolved_at
    FROM public.rehub_reports WHERE type = 'product' AND (school IS NULL OR school = p_school)
      AND (p_actor_id IS NULL OR reporter_id = p_actor_id)
    ORDER BY created_at DESC, id LIMIT 100
  ) page);
END;
$$;

CREATE FUNCTION public.rehub_market_pending_report_count(p_app_id text, p_open_id text, p_school text) RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
  IF current_user <> 'service_role' OR public.rehub_market_admin_identity(p_app_id, p_open_id) IS NULL THEN
    RAISE insufficient_privilege USING MESSAGE = 'MARKET_ADMIN_REQUIRED';
  END IF;
  RETURN (SELECT count(*) FROM public.rehub_reports WHERE type = 'product' AND status = 'pending'
    AND (school IS NULL OR school = p_school));
END;
$$;

CREATE FUNCTION public.rehub_market_take_down_product(p_app_id text, p_open_id text, p_school text,
  p_product_id text, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE
  admin_id text;
  item public.rehub_products%ROWTYPE;
  now_ms bigint;
BEGIN
  IF current_user <> 'service_role' THEN RAISE insufficient_privilege; END IF;
  admin_id := public.rehub_market_admin_identity(p_app_id, p_open_id);
  IF admin_id IS NULL THEN RAISE insufficient_privilege USING MESSAGE = 'MARKET_ADMIN_REQUIRED'; END IF;
  -- Lock the audit FK first, before taking product locks used by other user actions.
  PERFORM 1 FROM public.rehub_users WHERE id = admin_id FOR KEY SHARE;
  SELECT * INTO item FROM public.rehub_products WHERE id = p_product_id AND school = p_school AND status <> 'deleted' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MARKET_PRODUCT_MISSING'; END IF;
  IF item.moderation_status = 'blocked' THEN RAISE check_violation USING MESSAGE = 'MARKET_ALREADY_BLOCKED'; END IF;
  now_ms := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  UPDATE public.rehub_products SET status = 'offline', moderation_status = 'blocked', moderation_reason = p_reason,
    moderated_at = now_ms, moderated_by = admin_id, updated_at = now_ms WHERE id = item.id;
END;
$$;

CREATE FUNCTION public.rehub_market_resolve_report(p_app_id text, p_open_id text, p_school text,
  p_report_id text, p_resolution text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE
  admin_id text;
  report public.rehub_reports%ROWTYPE;
  item public.rehub_products%ROWTYPE;
  now_ms bigint;
BEGIN
  IF current_user <> 'service_role' THEN RAISE insufficient_privilege; END IF;
  admin_id := public.rehub_market_admin_identity(p_app_id, p_open_id);
  IF admin_id IS NULL OR p_resolution IS NULL OR p_resolution NOT IN ('takedown', 'dismiss') THEN
    RAISE insufficient_privilege USING MESSAGE = 'MARKET_ADMIN_REQUIRED';
  END IF;
  PERFORM 1 FROM public.rehub_users WHERE id = admin_id FOR KEY SHARE;
  SELECT * INTO report FROM public.rehub_reports WHERE id = p_report_id AND type = 'product'
    AND (school IS NULL OR school = p_school) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MARKET_REPORT_MISSING'; END IF;
  IF report.status <> 'pending' THEN RAISE check_violation USING MESSAGE = 'MARKET_REPORT_HANDLED'; END IF;
  IF p_resolution = 'takedown' THEN
    SELECT * INTO item FROM public.rehub_products WHERE id = report.product_id AND status <> 'deleted' FOR UPDATE;
    IF FOUND AND item.school <> p_school THEN RAISE insufficient_privilege USING MESSAGE = 'MARKET_REPORT_OTHER_SCHOOL'; END IF;
  END IF;
  now_ms := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  IF item.id IS NOT NULL AND item.moderation_status IS DISTINCT FROM 'blocked' THEN
    UPDATE public.rehub_products SET status = 'offline', moderation_status = 'blocked', moderation_reason = '商品举报：' || report.reason,
      moderated_at = now_ms, moderated_by = admin_id, updated_at = now_ms WHERE id = item.id;
  END IF;
  UPDATE public.rehub_reports SET status = CASE WHEN p_resolution = 'takedown' THEN 'resolved' ELSE 'dismissed' END,
    resolution = p_resolution, resolved_at = now_ms, resolved_by = admin_id, updated_at = now_ms WHERE id = report.id;
END;
$$;

DO $$
DECLARE signature regprocedure;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.rehub_market_create_review(text,text,integer,text,text)'::regprocedure,
    'public.rehub_market_seller_review_summary(text,text)'::regprocedure,
    'public.rehub_market_create_report(text,text,text,text,text)'::regprocedure,
    'public.rehub_market_admin_identity(text,text)'::regprocedure,
    'public.rehub_market_reports(text,text,text,text)'::regprocedure,
    'public.rehub_market_pending_report_count(text,text,text)'::regprocedure,
    'public.rehub_market_take_down_product(text,text,text,text,text)'::regprocedure,
    'public.rehub_market_resolve_report(text,text,text,text,text)'::regprocedure
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', signature);
  END LOOP;
END;
$$;
GRANT INSERT ON public.rehub_reviews TO service_role;
GRANT UPDATE (status, resolution, resolved_at, resolved_by, updated_at) ON public.rehub_reports TO service_role;
GRANT UPDATE (moderation_status, moderation_reason, moderated_at, moderated_by) ON public.rehub_products TO service_role;

COMMIT;
