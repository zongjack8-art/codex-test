-- Phase 3 review artifact. Apply locally after schema.sql and transactions.sql.
BEGIN;

CREATE FUNCTION public.rehub_market_login(p_app_id text, p_open_id text, p_school text, p_campus text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE
  profile public.rehub_users%ROWTYPE;
  now_ms bigint := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
BEGIN
  IF current_user <> 'service_role' OR p_app_id IS NULL OR p_app_id !~ '^wx[0-9a-f]{16}$'
    OR p_open_id IS NULL OR p_open_id !~ '^[A-Za-z0-9_-]{1,128}$' THEN RAISE insufficient_privilege; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_app_id || ':' || p_open_id, 0));
  SELECT u.* INTO profile FROM public.rehub_wechat_identities i JOIN public.rehub_users u ON u.id = i.user_id
    WHERE i.app_id = p_app_id AND i.open_id = p_open_id FOR NO KEY UPDATE OF u;
  IF NOT FOUND THEN
    INSERT INTO public.rehub_users(nickname, avatar, school, campus, created_at, updated_at)
      VALUES ('校园同学', '同', p_school, p_campus, now_ms, now_ms) RETURNING * INTO profile;
    INSERT INTO public.rehub_wechat_identities(app_id, open_id, user_id) VALUES (p_app_id, p_open_id, profile.id);
  ELSIF profile.school <> p_school OR profile.campus ~ '(北区|[东西南北])校区' OR profile.avatar = '🎓' THEN
    UPDATE public.rehub_users SET school = p_school, updated_at = now_ms,
      campus = CASE WHEN profile.campus ~ '(北区|[东西南北])校区' THEN p_campus ELSE profile.campus END,
      avatar = CASE WHEN profile.avatar = '🎓' THEN '同' ELSE profile.avatar END
      WHERE id = profile.id RETURNING * INTO profile;
  END IF;
  RETURN to_jsonb(profile);
END;
$$;

CREATE FUNCTION public.rehub_market_search(p_school text, p_category text, p_keyword text,
  p_min_price numeric, p_max_price numeric, p_sort text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
  IF current_user <> 'service_role' THEN RAISE insufficient_privilege; END IF;
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(item)), '[]'::jsonb) FROM (
    SELECT p.* FROM public.rehub_products p
    WHERE p.school = p_school AND p.status IN ('selling', 'reserved') AND p.moderation_status IS NULL
      AND (p_category IS NULL OR p.category = p_category)
      AND (p_min_price IS NULL OR p.price >= p_min_price)
      AND (p_max_price IS NULL OR p.price < p_max_price)
      AND (p_keyword = '' OR strpos(lower(p.title), lower(p_keyword)) > 0
        OR strpos(lower(p.description), lower(p_keyword)) > 0)
    ORDER BY CASE WHEN p_sort = 'priceAsc' THEN p.price END ASC,
      CASE WHEN p_sort = 'priceDesc' THEN p.price END DESC,
      CASE WHEN p_sort = 'latest' THEN p.created_at END DESC NULLS LAST, p.id
    LIMIT 50
  ) item);
END;
$$;

CREATE FUNCTION public.rehub_market_queue_cleanup(p_actor_id text, p_school text, p_storage_prefix text,
  p_kind text, p_files text[], p_product_id text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE
  safe_files text[];
  path_prefix text;
  now_ms bigint := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
BEGIN
  IF current_user <> 'service_role' THEN RAISE insufficient_privilege; END IF;
  IF coalesce(p_storage_prefix, '') !~ '^cloud://[A-Za-z0-9._-]+/$' THEN RETURN; END IF;
  PERFORM 1 FROM public.rehub_users WHERE id = p_actor_id FOR NO KEY UPDATE;
  IF NOT FOUND OR p_kind IS NULL OR p_kind NOT IN ('avatar', 'product', 'discarded_upload') THEN RAISE insufficient_privilege; END IF;
  IF p_kind = 'product' AND NOT EXISTS (
    SELECT 1 FROM public.rehub_product_refs WHERE id = p_product_id AND seller_id = p_actor_id
  ) THEN RAISE insufficient_privilege; END IF;

  path_prefix := p_storage_prefix || CASE WHEN p_kind = 'avatar' THEN 'avatars/' ELSE 'images/' END || p_actor_id || '/';
  SELECT array_agg(DISTINCT f ORDER BY f) INTO safe_files FROM unnest(p_files) f
    WHERE starts_with(f, path_prefix) AND substring(f FROM length(path_prefix) + 1) ~ '^[A-Za-z0-9_-]{8,80}\.(jpg|jpeg|png|webp)$'
    AND NOT EXISTS (SELECT 1 FROM public.rehub_users WHERE id = p_actor_id AND avatar = f)
    AND NOT EXISTS (SELECT 1 FROM public.rehub_products WHERE seller_id = p_actor_id AND status <> 'deleted' AND f = ANY(images));

  IF safe_files IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.rehub_reports WHERE type = 'image_cleanup'
    AND status = 'pending' AND cleanup_kind = p_kind AND file_ids = safe_files) THEN
    INSERT INTO public.rehub_reports(id, type, product_id, reason, file_ids, cleanup_kind, cleanup_user_id,
      school, status, created_at, updated_at)
    VALUES (gen_random_uuid()::text, 'image_cleanup', CASE WHEN p_kind = 'product' THEN p_product_id END,
      '待核验后清理', safe_files, p_kind, CASE WHEN p_kind = 'avatar' THEN p_actor_id END,
      p_school, 'pending', now_ms, now_ms);
  END IF;
END;
$$;

CREATE FUNCTION public.rehub_market_update_profile(p_actor_id text, p_profile jsonb, p_previous_avatar text,
  p_storage_prefix text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE
  previous public.rehub_users%ROWTYPE;
  profile public.rehub_users%ROWTYPE;
BEGIN
  IF current_user <> 'service_role' THEN RAISE insufficient_privilege; END IF;
  SELECT * INTO previous FROM public.rehub_users WHERE id = p_actor_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE insufficient_privilege; END IF;
  IF previous.avatar IS DISTINCT FROM p_previous_avatar THEN RAISE EXCEPTION 'MARKET_PRODUCT_CHANGED'; END IF;
  UPDATE public.rehub_users SET nickname = p_profile->>'nickname', avatar = p_profile->>'avatar',
    school = p_profile->>'school', campus = p_profile->>'campus', bio = p_profile->>'bio',
    updated_at = floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint
    WHERE id = p_actor_id RETURNING * INTO profile;
  IF previous.avatar <> profile.avatar THEN
    PERFORM public.rehub_market_queue_cleanup(p_actor_id, profile.school, p_storage_prefix, 'avatar', ARRAY[previous.avatar]);
  END IF;
  RETURN to_jsonb(profile);
END;
$$;

CREATE FUNCTION public.rehub_market_write_product(p_actor_id text, p_school text, p_operation text,
  p_id text, p_storage_prefix text, p_product jsonb DEFAULT NULL, p_status text DEFAULT NULL,
  p_previous_images text[] DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE
  previous public.rehub_products%ROWTYPE;
  saved public.rehub_products%ROWTYPE;
  listing_id text;
  files text[];
  now_ms bigint;
BEGIN
  IF current_user <> 'service_role' THEN RAISE insufficient_privilege; END IF;
  -- Serialize seller writes without blocking the foreign-key checks of orders.
  PERFORM 1 FROM public.rehub_users WHERE id = p_actor_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE insufficient_privilege; END IF;
  now_ms := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  IF p_operation IN ('create', 'update') THEN
    SELECT array_agg(f ORDER BY n) INTO files FROM jsonb_array_elements_text(p_product->'images') WITH ORDINALITY AS t(f, n);
  END IF;

  IF p_operation = 'create' THEN
    IF (SELECT count(*) FROM public.rehub_products WHERE seller_id = p_actor_id AND status <> 'deleted'
      AND created_at >= now_ms - 86400000) >= 20 THEN RAISE EXCEPTION 'MARKET_PUBLISH_LIMIT'; END IF;
    listing_id := gen_random_uuid()::text;
    INSERT INTO public.rehub_product_refs(id, seller_id) VALUES (listing_id, p_actor_id);
    INSERT INTO public.rehub_products(id, seller_id, title, description, price, original_price, category,
      condition, images, location, school, status, created_at, updated_at)
    VALUES (listing_id, p_actor_id, p_product->>'title', p_product->>'description', (p_product->>'price')::numeric,
      (p_product->>'originalPrice')::numeric, p_product->>'category', p_product->>'condition', files,
      p_product->>'location', p_school, 'selling', now_ms, now_ms) RETURNING * INTO saved;
    RETURN to_jsonb(saved);
  END IF;

  SELECT * INTO previous FROM public.rehub_products WHERE id = p_id AND status <> 'deleted' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MARKET_PRODUCT_MISSING'; END IF;
  IF previous.seller_id <> p_actor_id THEN RAISE EXCEPTION 'MARKET_NOT_OWNER'; END IF;
  IF p_operation = 'update' THEN
    IF previous.status IN ('sold', 'reserved') OR previous.images IS DISTINCT FROM p_previous_images THEN
      RAISE EXCEPTION 'MARKET_PRODUCT_CHANGED';
    END IF;
    UPDATE public.rehub_products SET title = p_product->>'title', description = p_product->>'description',
      price = (p_product->>'price')::numeric, original_price = (p_product->>'originalPrice')::numeric,
      category = p_product->>'category', condition = p_product->>'condition', images = files,
      location = p_product->>'location', school = p_school, updated_at = now_ms WHERE id = p_id RETURNING * INTO saved;
    PERFORM public.rehub_market_queue_cleanup(p_actor_id, p_school, p_storage_prefix, 'product', previous.images, p_id);
  ELSIF p_operation = 'status' THEN
    IF previous.moderation_status = 'blocked' AND p_status = 'selling' THEN RAISE EXCEPTION 'MARKET_BLOCKED_PRODUCT'; END IF;
    IF p_status IS NULL OR NOT ((previous.status = 'selling' AND p_status IN ('sold', 'offline'))
      OR (previous.status = 'offline' AND p_status = 'selling')) THEN RAISE EXCEPTION 'MARKET_PRODUCT_STATUS'; END IF;
    UPDATE public.rehub_products SET status = p_status, updated_at = now_ms WHERE id = p_id RETURNING * INTO saved;
  ELSIF p_operation = 'delete' THEN
    IF previous.status = 'reserved' THEN RAISE EXCEPTION 'MARKET_PRODUCT_CHANGED'; END IF;
    UPDATE public.rehub_products SET status = 'deleted', updated_at = now_ms WHERE id = p_id RETURNING * INTO saved;
    DELETE FROM public.rehub_favorites WHERE product_id = p_id;
    PERFORM public.rehub_market_queue_cleanup(p_actor_id, p_school, p_storage_prefix, 'product', previous.images, p_id);
  ELSE
    RAISE insufficient_privilege;
  END IF;
  RETURN to_jsonb(saved);
END;
$$;

CREATE FUNCTION public.rehub_market_favorite(p_actor_id text, p_product_id text, p_school text, p_favorited boolean) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
  IF current_user <> 'service_role' OR p_favorited IS NULL THEN RAISE insufficient_privilege; END IF;
  PERFORM 1 FROM public.rehub_users WHERE id = p_actor_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE insufficient_privilege; END IF;
  IF NOT p_favorited THEN
    DELETE FROM public.rehub_favorites WHERE user_id = p_actor_id AND product_id = p_product_id;
    RETURN;
  END IF;
  PERFORM 1 FROM public.rehub_products WHERE id = p_product_id AND school = p_school
    AND status = 'selling' AND moderation_status IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MARKET_PRODUCT_UNAVAILABLE'; END IF;
  IF EXISTS (SELECT 1 FROM public.rehub_favorites WHERE user_id = p_actor_id AND product_id = p_product_id) THEN RETURN; END IF;
  IF (SELECT count(*) FROM public.rehub_favorites WHERE user_id = p_actor_id) >= 500 THEN RAISE EXCEPTION 'MARKET_FAVORITE_LIMIT'; END IF;
  INSERT INTO public.rehub_favorites(id, user_id, product_id, created_at)
    VALUES (gen_random_uuid()::text, p_actor_id, p_product_id, floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint);
END;
$$;

CREATE FUNCTION public.rehub_market_record_view(p_actor_id text, p_product_id text, p_school text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE view_time bigint;
BEGIN
  IF current_user <> 'service_role' THEN RAISE insufficient_privilege; END IF;
  PERFORM 1 FROM public.rehub_users WHERE id = p_actor_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE insufficient_privilege; END IF;
  PERFORM 1 FROM public.rehub_products WHERE id = p_product_id AND school = p_school
    AND status IN ('selling', 'reserved', 'sold') AND moderation_status IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MARKET_VIEW_UNAVAILABLE'; END IF;
  IF EXISTS (SELECT 1 FROM public.rehub_recent_views WHERE user_id = p_actor_id AND product_id = p_product_id
    AND school <> p_school) THEN RAISE EXCEPTION 'MARKET_VIEW_OWNER'; END IF;
  SELECT greatest(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint, coalesce(max(viewed_at), 0) + 1)
    INTO view_time FROM public.rehub_recent_views WHERE user_id = p_actor_id AND school = p_school;
  INSERT INTO public.rehub_recent_views(id, user_id, product_id, school, viewed_at)
    VALUES (gen_random_uuid()::text, p_actor_id, p_product_id, p_school, view_time)
    ON CONFLICT (user_id, product_id) DO UPDATE SET viewed_at = excluded.viewed_at;
  DELETE FROM public.rehub_recent_views WHERE id IN (
    SELECT id FROM public.rehub_recent_views WHERE user_id = p_actor_id AND school = p_school
    ORDER BY viewed_at DESC, id OFFSET 50
  );
END;
$$;

CREATE FUNCTION public.rehub_market_clear_views(p_actor_id text, p_school text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
  IF current_user <> 'service_role' THEN RAISE insufficient_privilege; END IF;
  PERFORM 1 FROM public.rehub_users WHERE id = p_actor_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE insufficient_privilege; END IF;
  DELETE FROM public.rehub_recent_views WHERE user_id = p_actor_id AND school = p_school;
END;
$$;

DO $permissions$
DECLARE signature regprocedure;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.rehub_market_login(text,text,text,text)'::regprocedure,
    'public.rehub_market_search(text,text,text,numeric,numeric,text)'::regprocedure,
    'public.rehub_market_queue_cleanup(text,text,text,text,text[],text)'::regprocedure,
    'public.rehub_market_update_profile(text,jsonb,text,text)'::regprocedure,
    'public.rehub_market_write_product(text,text,text,text,text,jsonb,text,text[])'::regprocedure,
    'public.rehub_market_favorite(text,text,text,boolean)'::regprocedure,
    'public.rehub_market_record_view(text,text,text)'::regprocedure,
    'public.rehub_market_clear_views(text,text)'::regprocedure
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', signature);
  END LOOP;
END;
$permissions$;

GRANT INSERT ON public.rehub_users, public.rehub_wechat_identities, public.rehub_product_refs,
  public.rehub_products, public.rehub_favorites, public.rehub_recent_views, public.rehub_reports TO service_role;
GRANT UPDATE (nickname, avatar, school, campus, bio, updated_at) ON public.rehub_users TO service_role;
GRANT UPDATE (title, description, price, original_price, category, condition, images, location, school)
  ON public.rehub_products TO service_role;
GRANT UPDATE (viewed_at) ON public.rehub_recent_views TO service_role;
GRANT DELETE ON public.rehub_favorites, public.rehub_recent_views TO service_role;

COMMIT;
