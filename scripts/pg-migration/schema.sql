-- Phase 2 review artifact. Apply locally with simulate.mjs.
BEGIN;

CREATE DOMAIN public.rehub_epoch_ms AS bigint CHECK (VALUE >= 0);
CREATE DOMAIN public.rehub_price AS numeric
  CHECK (VALUE BETWEEN 0.01 AND 100000 AND VALUE = round(VALUE, 2));

CREATE TABLE public.rehub_users (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  nickname text NOT NULL,
  avatar text NOT NULL,
  school text NOT NULL,
  campus text NOT NULL,
  bio text NOT NULL DEFAULT '',
  created_at public.rehub_epoch_ms NOT NULL,
  updated_at public.rehub_epoch_ms NOT NULL
);

CREATE TABLE public.rehub_wechat_identities (
  app_id text NOT NULL CHECK (app_id ~ '^wx[0-9a-f]{16}$'),
  open_id text NOT NULL CHECK (open_id <> '' AND open_id = btrim(open_id)),
  user_id text NOT NULL REFERENCES public.rehub_users(id),
  PRIMARY KEY (app_id, open_id),
  UNIQUE (user_id, app_id)
);

CREATE TABLE public.rehub_admins (
  id text PRIMARY KEY,
  app_id text NOT NULL,
  open_id text NOT NULL,
  role text NOT NULL CHECK (role = 'admin'),
  enabled boolean NOT NULL DEFAULT false,
  created_at public.rehub_epoch_ms NOT NULL,
  UNIQUE (app_id, open_id),
  FOREIGN KEY (app_id, open_id) REFERENCES public.rehub_wechat_identities(app_id, open_id)
);

-- A reference survives deletion of an old listing and does not create a fake listing.
CREATE TABLE public.rehub_product_refs (
  id text PRIMARY KEY,
  seller_id text REFERENCES public.rehub_users(id),
  UNIQUE (id, seller_id)
);

CREATE TABLE public.rehub_products (
  id text PRIMARY KEY,
  seller_id text NOT NULL REFERENCES public.rehub_users(id),
  title text NOT NULL,
  description text NOT NULL,
  price public.rehub_price NOT NULL,
  original_price public.rehub_price,
  category text NOT NULL CHECK (category IN ('books', 'digital', 'daily', 'sports', 'fashion', 'other')),
  condition text NOT NULL,
  images text[] NOT NULL CHECK (cardinality(images) BETWEEN 1 AND 3 AND array_position(images, NULL) IS NULL),
  location text,
  school text NOT NULL,
  status text NOT NULL CHECK (status IN ('selling', 'reserved', 'sold', 'offline', 'deleted')),
  created_at public.rehub_epoch_ms,
  updated_at public.rehub_epoch_ms NOT NULL,
  moderated_at public.rehub_epoch_ms,
  moderated_by text REFERENCES public.rehub_users(id),
  moderation_reason text,
  moderation_status text CHECK (moderation_status = 'blocked'),
  FOREIGN KEY (id, seller_id) REFERENCES public.rehub_product_refs(id, seller_id),
  CHECK (moderation_status IS NULL OR status IN ('offline', 'deleted')),
  UNIQUE (id, seller_id)
);

CREATE TABLE public.rehub_orders (
  id text PRIMARY KEY,
  product_id text NOT NULL,
  buyer_id text NOT NULL REFERENCES public.rehub_users(id),
  seller_id text NOT NULL REFERENCES public.rehub_users(id),
  product_title text NOT NULL,
  product_image text NOT NULL,
  amount public.rehub_price NOT NULL,
  active_key text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled')),
  created_at public.rehub_epoch_ms NOT NULL,
  updated_at public.rehub_epoch_ms NOT NULL,
  completed_at public.rehub_epoch_ms,
  cancelled_at public.rehub_epoch_ms,
  reserved_at public.rehub_epoch_ms,
  cancel_reason text CHECK (cancel_reason IS NULL OR (status = 'cancelled' AND cancel_reason = 'seller_selected_other_buyer')),
  buyer_unread boolean NOT NULL DEFAULT false,
  seller_unread boolean NOT NULL DEFAULT false,
  FOREIGN KEY (product_id, seller_id) REFERENCES public.rehub_products(id, seller_id),
  CHECK (buyer_id <> seller_id),
  CHECK ((status = 'completed') = (completed_at IS NOT NULL)),
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  CHECK (status <> 'pending' OR reserved_at IS NULL),
  UNIQUE (id, product_id, buyer_id, seller_id, status)
);

CREATE UNIQUE INDEX rehub_orders_active_buyer_product ON public.rehub_orders(buyer_id, product_id)
  WHERE status IN ('pending', 'confirmed');
CREATE UNIQUE INDEX rehub_orders_confirmed_product ON public.rehub_orders(product_id) WHERE status = 'confirmed';

CREATE TABLE public.rehub_conversations (
  id text PRIMARY KEY,
  product_id text NOT NULL,
  buyer_id text NOT NULL REFERENCES public.rehub_users(id),
  seller_id text NOT NULL REFERENCES public.rehub_users(id),
  participant_low text GENERATED ALWAYS AS (least(buyer_id, seller_id)) STORED,
  participant_high text GENERATED ALWAYS AS (greatest(buyer_id, seller_id)) STORED,
  product_snapshot jsonb NOT NULL CHECK (jsonb_typeof(product_snapshot) = 'object'),
  last_message text NOT NULL DEFAULT '',
  last_message_at public.rehub_epoch_ms NOT NULL,
  buyer_unread_count integer NOT NULL DEFAULT 0 CHECK (buyer_unread_count >= 0),
  seller_unread_count integer NOT NULL DEFAULT 0 CHECK (seller_unread_count >= 0),
  status text NOT NULL CHECK (status = 'active'),
  created_at public.rehub_epoch_ms NOT NULL,
  updated_at public.rehub_epoch_ms NOT NULL,
  CHECK (buyer_id <> seller_id),
  FOREIGN KEY (product_id, seller_id) REFERENCES public.rehub_product_refs(id, seller_id),
  UNIQUE (buyer_id, product_id),
  UNIQUE (id, participant_low, participant_high)
);

CREATE TABLE public.rehub_messages (
  id text PRIMARY KEY,
  conversation_id text NOT NULL,
  sender_id text NOT NULL,
  receiver_id text NOT NULL,
  participant_low text GENERATED ALWAYS AS (least(sender_id, receiver_id)) STORED,
  participant_high text GENERATED ALWAYS AS (greatest(sender_id, receiver_id)) STORED,
  type text NOT NULL CHECK (type = 'text'),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 500 AND content ~ '[^[:space:]]'),
  created_at public.rehub_epoch_ms NOT NULL,
  CHECK (sender_id <> receiver_id),
  FOREIGN KEY (conversation_id, participant_low, participant_high)
    REFERENCES public.rehub_conversations(id, participant_low, participant_high)
);

CREATE TABLE public.rehub_favorites (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.rehub_users(id),
  product_id text NOT NULL REFERENCES public.rehub_products(id),
  created_at public.rehub_epoch_ms,
  UNIQUE (user_id, product_id)
);

CREATE TABLE public.rehub_recent_views (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.rehub_users(id),
  product_id text NOT NULL REFERENCES public.rehub_products(id),
  school text NOT NULL,
  viewed_at public.rehub_epoch_ms NOT NULL,
  UNIQUE (user_id, product_id)
);

CREATE TABLE public.rehub_reports (
  id text PRIMARY KEY,
  type text NOT NULL CHECK (type IN ('product', 'image_cleanup')),
  reporter_id text REFERENCES public.rehub_users(id),
  product_id text REFERENCES public.rehub_product_refs(id),
  reason text NOT NULL,
  description text,
  file_ids text[],
  cleanup_kind text CHECK (cleanup_kind IN ('product', 'avatar', 'discarded_upload')),
  cleanup_user_id text REFERENCES public.rehub_users(id),
  school text,
  status text NOT NULL CHECK (status IN ('pending', 'resolved', 'dismissed')),
  created_at public.rehub_epoch_ms NOT NULL,
  updated_at public.rehub_epoch_ms NOT NULL,
  resolution text CHECK (resolution IN ('dismiss', 'takedown')),
  resolved_at public.rehub_epoch_ms,
  resolved_by text REFERENCES public.rehub_users(id),
  CHECK ((type = 'product' AND product_id IS NOT NULL AND reporter_id IS NOT NULL
           AND file_ids IS NULL AND cleanup_kind IS NULL AND cleanup_user_id IS NULL)
      OR (type = 'image_cleanup' AND reporter_id IS NULL AND file_ids IS NOT NULL AND cleanup_kind IS NOT NULL
           AND (product_id IS NOT NULL) = (cleanup_kind = 'product')
           AND (cleanup_user_id IS NOT NULL) = (cleanup_kind = 'avatar'))),
  CHECK (type <> 'product' OR reason IN ('prohibited', 'misleading', 'fraud', 'other'))
);

CREATE UNIQUE INDEX rehub_reports_pending_once ON public.rehub_reports(reporter_id, product_id)
  WHERE type = 'product' AND status = 'pending';

CREATE TABLE public.rehub_reviews (
  id text PRIMARY KEY,
  order_id text NOT NULL UNIQUE,
  product_id text NOT NULL,
  buyer_id text NOT NULL,
  seller_id text NOT NULL,
  order_status text GENERATED ALWAYS AS ('completed'::text) STORED,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  content text NOT NULL CHECK (char_length(content) <= 200),
  created_at public.rehub_epoch_ms NOT NULL,
  school text NOT NULL,
  FOREIGN KEY (order_id, product_id, buyer_id, seller_id, order_status)
    REFERENCES public.rehub_orders(id, product_id, buyer_id, seller_id, status)
);

-- Migration owner only. The source document preserves original IDs, missing fields and snapshots.
CREATE TABLE public.rehub_legacy_documents (
  source_app_id text NOT NULL CHECK (source_app_id = 'wxdb3e3d718940eae6'),
  collection text NOT NULL CHECK (collection IN ('users', 'admins', 'products', 'orders', 'conversations',
    'messages', 'favorites', 'recentViews', 'reports', 'reviews')),
  document_id text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  PRIMARY KEY (source_app_id, collection, document_id)
);

CREATE INDEX rehub_products_feed ON public.rehub_products(school, created_at DESC, id)
  WHERE status IN ('selling', 'reserved') AND moderation_status IS NULL;
CREATE INDEX rehub_products_category_feed ON public.rehub_products(school, category, created_at DESC, id)
  WHERE status IN ('selling', 'reserved') AND moderation_status IS NULL;
CREATE INDEX rehub_products_price ON public.rehub_products(school, price, id)
  WHERE status IN ('selling', 'reserved') AND moderation_status IS NULL;
CREATE INDEX rehub_products_category_price ON public.rehub_products(school, category, price, id)
  WHERE status IN ('selling', 'reserved') AND moderation_status IS NULL;
CREATE INDEX rehub_products_seller ON public.rehub_products(seller_id, updated_at DESC);
CREATE INDEX rehub_orders_buyer ON public.rehub_orders(buyer_id, created_at DESC);
CREATE INDEX rehub_orders_seller ON public.rehub_orders(seller_id, created_at DESC);
CREATE INDEX rehub_orders_product_status ON public.rehub_orders(product_id, status);
CREATE INDEX rehub_orders_buyer_unread ON public.rehub_orders(buyer_id) WHERE buyer_unread;
CREATE INDEX rehub_orders_seller_unread ON public.rehub_orders(seller_id) WHERE seller_unread;
CREATE INDEX rehub_conversations_buyer ON public.rehub_conversations(buyer_id, last_message_at DESC);
CREATE INDEX rehub_conversations_seller ON public.rehub_conversations(seller_id, last_message_at DESC);
CREATE INDEX rehub_conversations_product ON public.rehub_conversations(product_id);
CREATE INDEX rehub_messages_conversation_time ON public.rehub_messages(conversation_id, created_at DESC, id DESC);
CREATE INDEX rehub_messages_sender_time ON public.rehub_messages(conversation_id, sender_id, created_at DESC);
CREATE INDEX rehub_favorites_user ON public.rehub_favorites(user_id, created_at DESC NULLS LAST);
CREATE INDEX rehub_favorites_product ON public.rehub_favorites(product_id);
CREATE INDEX rehub_recent_views_user ON public.rehub_recent_views(user_id, school, viewed_at DESC);
CREATE INDEX rehub_recent_views_product ON public.rehub_recent_views(product_id);
CREATE INDEX rehub_reports_reporter ON public.rehub_reports(reporter_id, created_at DESC) WHERE type = 'product';
CREATE INDEX rehub_reports_moderation_queue ON public.rehub_reports(status, school, created_at DESC) WHERE type = 'product';
CREATE INDEX rehub_reports_product ON public.rehub_reports(product_id);
CREATE INDEX rehub_reviews_seller ON public.rehub_reviews(seller_id, school, created_at DESC);

DO $permissions$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'users', 'wechat_identities', 'admins', 'product_refs', 'products', 'orders', 'conversations',
    'messages', 'favorites', 'recent_views', 'reports', 'reviews', 'legacy_documents'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', 'rehub_' || table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role', 'rehub_' || table_name);
    IF table_name <> 'legacy_documents' THEN
      EXECUTE format('GRANT SELECT ON TABLE public.%I TO service_role', 'rehub_' || table_name);
    END IF;
  END LOOP;
END;
$permissions$;

COMMIT;
