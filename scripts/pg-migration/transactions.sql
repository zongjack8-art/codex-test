BEGIN;

CREATE FUNCTION public.rehub_check_product_transition() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.status <> OLD.status AND NOT (
    (OLD.status = 'selling' AND NEW.status IN ('reserved', 'sold', 'offline', 'deleted')) OR
    (OLD.status = 'reserved' AND NEW.status IN ('selling', 'sold', 'offline')) OR
    (OLD.status = 'offline' AND NEW.status IN ('selling', 'deleted')) OR
    (OLD.status = 'sold' AND (NEW.status = 'deleted' OR
      (NEW.status = 'offline' AND NEW.moderation_status IS NOT DISTINCT FROM 'blocked')))
  ) THEN
    RAISE check_violation USING MESSAGE = 'INVALID_PRODUCT_TRANSITION';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER rehub_product_transition BEFORE UPDATE OF status ON public.rehub_products
FOR EACH ROW EXECUTE FUNCTION public.rehub_check_product_transition();

CREATE FUNCTION public.rehub_check_reservation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE
  listing_id text;
  listing_status text;
  listing_moderation text;
  confirmed public.rehub_orders%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'rehub_orders' THEN
    IF TG_OP = 'DELETE' THEN
      listing_id := OLD.product_id;
    ELSE
      listing_id := NEW.product_id;
      IF TG_OP = 'UPDATE' AND OLD.product_id <> NEW.product_id THEN
        RAISE check_violation USING MESSAGE = 'ORDER_PRODUCT_IMMUTABLE';
      END IF;
    END IF;
  ELSE
    listing_id := NEW.id;
  END IF;
  SELECT status, moderation_status INTO listing_status, listing_moderation FROM public.rehub_products WHERE id = listing_id;
  SELECT * INTO confirmed FROM public.rehub_orders WHERE product_id = listing_id AND status = 'confirmed';
  IF listing_status = 'reserved' THEN
    IF confirmed.id IS NULL OR EXISTS (
      SELECT 1 FROM public.rehub_orders WHERE product_id = listing_id AND status = 'pending'
    ) THEN
      RAISE check_violation USING MESSAGE = 'INVALID_RESERVATION';
    END IF;
  ELSIF confirmed.id IS NOT NULL AND NOT (
    listing_status = 'offline' OR
    (confirmed.reserved_at IS NULL AND listing_status IN ('selling', 'sold', 'deleted')) OR
    (listing_status = 'deleted' AND listing_moderation IS NOT DISTINCT FROM 'blocked')
  ) THEN
    RAISE check_violation USING MESSAGE = 'INVALID_CONFIRMED_ORDER_PRODUCT';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER rehub_product_reservation AFTER INSERT OR UPDATE ON public.rehub_products
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.rehub_check_reservation();
CREATE CONSTRAINT TRIGGER rehub_order_reservation AFTER INSERT OR UPDATE OR DELETE ON public.rehub_orders
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.rehub_check_reservation();

CREATE FUNCTION public.rehub_create_order(p_actor_id text, p_product_id text) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE
  listing public.rehub_products%ROWTYPE;
  order_id text := gen_random_uuid()::text;
  at_ms bigint;
BEGIN
  IF current_user <> 'service_role' THEN RAISE insufficient_privilege; END IF;
  SELECT * INTO listing FROM public.rehub_products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND OR listing.status <> 'selling' OR listing.moderation_status IS NOT NULL THEN
    RAISE check_violation USING MESSAGE = 'PRODUCT_NOT_ORDERABLE';
  END IF;
  IF p_actor_id IS NULL OR listing.seller_id = p_actor_id OR NOT EXISTS (
    SELECT 1 FROM public.rehub_users WHERE id = p_actor_id AND school = listing.school
  ) THEN RAISE insufficient_privilege; END IF;
  IF EXISTS (SELECT 1 FROM public.rehub_orders WHERE product_id = p_product_id AND buyer_id = p_actor_id
    AND status IN ('pending', 'confirmed')) THEN RAISE unique_violation USING MESSAGE = 'ORDER_ALREADY_ACTIVE'; END IF;
  IF EXISTS (SELECT 1 FROM public.rehub_orders WHERE product_id = p_product_id AND status = 'confirmed') THEN
    RAISE check_violation USING MESSAGE = 'ORDER_ALREADY_CONFIRMED';
  END IF;

  at_ms := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  UPDATE public.rehub_products SET updated_at = at_ms WHERE id = listing.id;
  INSERT INTO public.rehub_orders (
    id, product_id, buyer_id, seller_id, product_title, product_image, amount,
    active_key, status, created_at, updated_at, buyer_unread, seller_unread
  ) VALUES (
    order_id, listing.id, p_actor_id, listing.seller_id, listing.title, listing.images[1], listing.price,
    'pg_' || order_id, 'pending', at_ms, at_ms, false, true
  );
  RETURN order_id;
END;
$$;

CREATE FUNCTION public.rehub_transition_order(p_actor_id text, p_order_id text, p_action text) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE
  listing public.rehub_products%ROWTYPE;
  target_order public.rehub_orders%ROWTYPE;
  expected_status text;
  at_ms bigint;
BEGIN
  IF current_user <> 'service_role' THEN RAISE insufficient_privilege; END IF;
  SELECT p.* INTO listing FROM public.rehub_products p
    JOIN public.rehub_orders o ON o.product_id = p.id WHERE o.id = p_order_id FOR UPDATE OF p;
  SELECT * INTO target_order FROM public.rehub_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MARKET_ORDER_MISSING'; END IF;
  IF p_actor_id IS NULL OR p_actor_id NOT IN (target_order.buyer_id, target_order.seller_id) THEN
    RAISE insufficient_privilege USING MESSAGE = 'MARKET_ORDER_FORBIDDEN';
  END IF;
  at_ms := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;

  IF p_action = 'cancel' THEN
    IF target_order.status NOT IN ('pending', 'confirmed') THEN RAISE check_violation USING MESSAGE = 'MARKET_ORDER_CANCEL_STATE'; END IF;
    IF target_order.status = 'confirmed' AND listing.status = 'reserved' THEN
      UPDATE public.rehub_products SET status = 'selling', updated_at = at_ms WHERE id = listing.id;
    END IF;
    UPDATE public.rehub_orders SET status = 'cancelled', active_key = 'closed_' || id,
      cancelled_at = at_ms, updated_at = at_ms, buyer_unread = p_actor_id = target_order.seller_id,
      seller_unread = p_actor_id = target_order.buyer_id WHERE id = p_order_id;
    RETURN p_order_id;
  END IF;
  IF p_actor_id <> target_order.seller_id THEN RAISE insufficient_privilege USING MESSAGE = 'MARKET_ORDER_SELLER_ONLY'; END IF;
  expected_status := CASE WHEN p_action = 'confirm' THEN 'pending' ELSE 'confirmed' END;
  IF p_action IS NULL OR p_action NOT IN ('confirm', 'complete') OR
    target_order.status <> expected_status THEN
    RAISE check_violation USING MESSAGE = 'INVALID_ORDER_TRANSITION';
  END IF;
  IF listing.id IS NULL OR listing.status = 'deleted' OR listing.seller_id <> target_order.seller_id THEN
    RAISE check_violation USING MESSAGE = 'MARKET_ORDER_PRODUCT_GONE';
  END IF;
  IF p_action = 'confirm' THEN
    IF listing.status <> 'selling' OR listing.moderation_status IS NOT NULL THEN
      RAISE check_violation USING MESSAGE = 'MARKET_ORDER_CONFIRM_STATE';
    END IF;
    IF EXISTS (SELECT 1 FROM public.rehub_orders WHERE product_id = listing.id AND status = 'confirmed') THEN
      RAISE check_violation USING MESSAGE = 'ORDER_ALREADY_CONFIRMED';
    END IF;
    UPDATE public.rehub_products SET status = 'reserved', updated_at = at_ms WHERE id = listing.id;
    UPDATE public.rehub_orders SET status = 'confirmed', reserved_at = at_ms,
      buyer_unread = true, seller_unread = false, updated_at = at_ms WHERE id = p_order_id;
    UPDATE public.rehub_orders SET status = 'cancelled', active_key = 'closed_' || id,
      cancel_reason = 'seller_selected_other_buyer', cancelled_at = at_ms, updated_at = at_ms,
      buyer_unread = true, seller_unread = false WHERE product_id = listing.id AND status = 'pending';
  ELSE
    IF NOT (listing.status = 'reserved' OR (listing.status = 'selling' AND target_order.reserved_at IS NULL)) THEN
      RAISE check_violation USING MESSAGE = 'MARKET_ORDER_COMPLETE_STATE';
    END IF;
    UPDATE public.rehub_products SET status = 'sold', updated_at = at_ms WHERE id = listing.id;
    UPDATE public.rehub_orders SET status = 'completed', active_key = 'closed_' || id,
      completed_at = at_ms, updated_at = at_ms, buyer_unread = true, seller_unread = false WHERE id = p_order_id;
  END IF;
  RETURN p_order_id;
END;
$$;

CREATE FUNCTION public.rehub_send_message(p_actor_id text, p_conversation_id text, p_content text) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE
  conversation public.rehub_conversations%ROWTYPE;
  message_id text := gen_random_uuid()::text;
  receiver_id text;
  wall_ms bigint;
  at_ms bigint;
BEGIN
  IF current_user <> 'service_role' THEN RAISE insufficient_privilege; END IF;
  SELECT * INTO conversation FROM public.rehub_conversations WHERE id = p_conversation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MARKET_CHAT_MISSING'; END IF;
  IF p_actor_id IS NULL OR p_actor_id NOT IN (conversation.buyer_id, conversation.seller_id) THEN
    RAISE insufficient_privilege USING MESSAGE = 'MARKET_CHAT_FORBIDDEN';
  END IF;
  wall_ms := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  at_ms := greatest(wall_ms, conversation.last_message_at + 1);
  IF (SELECT count(*) FROM public.rehub_messages
      WHERE conversation_id = p_conversation_id AND sender_id = p_actor_id AND created_at >= wall_ms - 60000) >= 20 THEN
    RAISE check_violation USING MESSAGE = 'MESSAGE_RATE_LIMIT';
  END IF;
  receiver_id := CASE WHEN p_actor_id = conversation.buyer_id THEN conversation.seller_id ELSE conversation.buyer_id END;
  INSERT INTO public.rehub_messages (id, conversation_id, sender_id, receiver_id, type, content, created_at)
    VALUES (message_id, p_conversation_id, p_actor_id, receiver_id, 'text', btrim(p_content), at_ms);
  UPDATE public.rehub_conversations SET last_message = left(btrim(p_content), 80), last_message_at = at_ms,
    buyer_unread_count = buyer_unread_count + (receiver_id = buyer_id)::integer,
    seller_unread_count = seller_unread_count + (receiver_id = seller_id)::integer,
    updated_at = at_ms WHERE id = p_conversation_id;
  RETURN message_id;
END;
$$;

CREATE FUNCTION public.rehub_mark_conversation_read(p_actor_id text, p_conversation_id text) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
  IF current_user <> 'service_role' THEN RAISE insufficient_privilege; END IF;
  UPDATE public.rehub_conversations SET
    buyer_unread_count = CASE WHEN buyer_id = p_actor_id THEN 0 ELSE buyer_unread_count END,
    seller_unread_count = CASE WHEN seller_id = p_actor_id THEN 0 ELSE seller_unread_count END
    WHERE id = p_conversation_id AND p_actor_id IN (buyer_id, seller_id);
  IF NOT FOUND THEN
    IF NOT EXISTS (SELECT 1 FROM public.rehub_conversations WHERE id = p_conversation_id) THEN
      RAISE EXCEPTION 'MARKET_CHAT_MISSING';
    END IF;
    RAISE insufficient_privilege USING MESSAGE = 'MARKET_CHAT_FORBIDDEN';
  END IF;
  RETURN p_conversation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.rehub_check_product_transition(), public.rehub_check_reservation(),
  public.rehub_create_order(text, text), public.rehub_transition_order(text, text, text),
  public.rehub_send_message(text, text, text), public.rehub_mark_conversation_read(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rehub_create_order(text, text), public.rehub_transition_order(text, text, text),
  public.rehub_send_message(text, text, text), public.rehub_mark_conversation_read(text, text) TO service_role;
GRANT INSERT ON public.rehub_orders, public.rehub_messages TO service_role;
GRANT UPDATE (status, updated_at) ON public.rehub_products TO service_role;
GRANT UPDATE (status, reserved_at, completed_at, cancelled_at, active_key, cancel_reason,
  buyer_unread, seller_unread, updated_at) ON public.rehub_orders TO service_role;
GRANT UPDATE (last_message, last_message_at, buyer_unread_count, seller_unread_count, updated_at)
  ON public.rehub_conversations TO service_role;

COMMIT;
