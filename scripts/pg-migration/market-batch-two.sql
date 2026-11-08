-- Phase 3 batch 2. Apply after schema.sql, transactions.sql and market-batch-one.sql.
BEGIN;

CREATE FUNCTION public.rehub_market_order_unread(p_actor_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE
  buyer_count bigint;
  seller_count bigint;
BEGIN
  IF current_user <> 'service_role' THEN RAISE insufficient_privilege; END IF;
  SELECT (SELECT count(*) FROM public.rehub_orders WHERE buyer_id = p_actor_id AND buyer_unread),
    (SELECT count(*) FROM public.rehub_orders WHERE seller_id = p_actor_id AND seller_unread)
    INTO buyer_count, seller_count;
  RETURN jsonb_build_object('buyer', buyer_count, 'seller', seller_count, 'total', buyer_count + seller_count);
END;
$$;

CREATE FUNCTION public.rehub_market_mark_orders_read(p_actor_id text, p_role text) RETURNS bigint
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE
  target_ids text[];
  cleared bigint;
BEGIN
  IF current_user <> 'service_role' OR p_actor_id IS NULL OR p_role IS NULL OR p_role NOT IN ('buyer', 'seller') THEN
    RAISE insufficient_privilege;
  END IF;
  IF p_role = 'buyer' THEN
    SELECT array_agg(id) INTO target_ids FROM public.rehub_orders WHERE buyer_id = p_actor_id AND buyer_unread;
  ELSE
    SELECT array_agg(id) INTO target_ids FROM public.rehub_orders WHERE seller_id = p_actor_id AND seller_unread;
  END IF;
  IF target_ids IS NULL THEN RETURN 0; END IF;

  -- Use the same lock order as order transitions: product before orders.
  PERFORM p.id FROM public.rehub_products p WHERE p.id IN (
    SELECT product_id FROM public.rehub_orders WHERE id = ANY(target_ids)
  ) ORDER BY p.id FOR UPDATE;
  IF p_role = 'buyer' THEN
    UPDATE public.rehub_orders SET buyer_unread = false WHERE id = ANY(target_ids) AND buyer_id = p_actor_id AND buyer_unread;
  ELSE
    UPDATE public.rehub_orders SET seller_unread = false WHERE id = ANY(target_ids) AND seller_id = p_actor_id AND seller_unread;
  END IF;
  GET DIAGNOSTICS cleared = ROW_COUNT;
  RETURN cleared;
END;
$$;

CREATE FUNCTION public.rehub_market_start_chat(p_actor_id text, p_product_id text, p_school text) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE
  listing public.rehub_products%ROWTYPE;
  chat_id text;
  at_ms bigint;
BEGIN
  IF current_user <> 'service_role' OR p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.rehub_users WHERE id = p_actor_id AND school = p_school
  ) THEN RAISE insufficient_privilege; END IF;
  SELECT * INTO listing FROM public.rehub_products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND OR listing.school IS DISTINCT FROM p_school OR listing.status <> 'selling' OR listing.moderation_status IS NOT NULL THEN
    RAISE EXCEPTION 'MARKET_CHAT_UNAVAILABLE';
  END IF;
  IF listing.seller_id = p_actor_id THEN RAISE EXCEPTION 'MARKET_CHAT_SELF'; END IF;

  SELECT id INTO chat_id FROM public.rehub_conversations WHERE product_id = p_product_id AND buyer_id = p_actor_id;
  IF FOUND THEN RETURN chat_id; END IF;
  at_ms := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  INSERT INTO public.rehub_conversations(id, product_id, buyer_id, seller_id, product_snapshot, last_message_at,
    status, created_at, updated_at)
    VALUES (gen_random_uuid()::text, listing.id, p_actor_id, listing.seller_id,
      jsonb_build_object('title', listing.title, 'price', listing.price, 'image', listing.images[1], 'status', listing.status),
      at_ms, 'active', at_ms, at_ms) RETURNING id INTO chat_id;
  RETURN chat_id;
END;
$$;

CREATE FUNCTION public.rehub_market_chat_unread(p_actor_id text) RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
  IF current_user <> 'service_role' THEN RAISE insufficient_privilege; END IF;
  RETURN coalesce((SELECT sum(buyer_unread_count) FROM public.rehub_conversations WHERE buyer_id = p_actor_id), 0)
    + coalesce((SELECT sum(seller_unread_count) FROM public.rehub_conversations WHERE seller_id = p_actor_id), 0);
END;
$$;

CREATE FUNCTION public.rehub_market_chat_messages(p_actor_id text, p_conversation_id text, p_before text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE
  chat public.rehub_conversations%ROWTYPE;
  before_at bigint;
BEGIN
  IF current_user <> 'service_role' THEN RAISE insufficient_privilege; END IF;
  SELECT * INTO chat FROM public.rehub_conversations WHERE id = p_conversation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'MARKET_CHAT_MISSING'; END IF;
  IF p_actor_id IS NULL OR p_actor_id NOT IN (chat.buyer_id, chat.seller_id) THEN
    RAISE insufficient_privilege USING MESSAGE = 'MARKET_CHAT_FORBIDDEN';
  END IF;
  IF p_before IS NOT NULL THEN
    SELECT created_at INTO before_at FROM public.rehub_messages WHERE id = p_before AND conversation_id = p_conversation_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'MARKET_CHAT_CURSOR'; END IF;
  END IF;
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(page) ORDER BY page.created_at, page.id), '[]'::jsonb) FROM (
    SELECT m.id, m.conversation_id, m.sender_id, m.receiver_id, m.content, m.created_at
    FROM public.rehub_messages m WHERE m.conversation_id = p_conversation_id
      AND (p_before IS NULL OR (m.created_at, m.id) < (before_at, p_before))
    ORDER BY m.created_at DESC, m.id DESC LIMIT 100
  ) page);
END;
$$;

REVOKE ALL ON FUNCTION public.rehub_market_order_unread(text), public.rehub_market_mark_orders_read(text, text),
  public.rehub_market_start_chat(text, text, text), public.rehub_market_chat_unread(text),
  public.rehub_market_chat_messages(text, text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rehub_market_order_unread(text), public.rehub_market_mark_orders_read(text, text),
  public.rehub_market_start_chat(text, text, text), public.rehub_market_chat_unread(text),
  public.rehub_market_chat_messages(text, text, text) TO service_role;
GRANT INSERT ON public.rehub_conversations TO service_role;

COMMIT;
