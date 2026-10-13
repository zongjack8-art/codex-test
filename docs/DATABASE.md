# 数据库设计

建议使用 PostgreSQL。主键可使用 UUID，时间统一存储 UTC。以下为核心关系模型；金额以整数分保存。

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY,
  wechat_openid TEXT UNIQUE NOT NULL,
  nickname VARCHAR(64) NOT NULL,
  campus VARCHAR(80) NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id UUID PRIMARY KEY,
  seller_id UUID NOT NULL REFERENCES users(id),
  title VARCHAR(80) NOT NULL,
  description TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents > 0),
  original_price_cents INTEGER CHECK (original_price_cents > 0),
  category VARCHAR(32) NOT NULL CHECK (category IN ('books','digital','daily','sports','fashion','other')),
  condition VARCHAR(32) NOT NULL,
  campus VARCHAR(80) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'available' CHECK (status IN ('available','sold')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE product_images (
  id UUID PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  sort_order SMALLINT NOT NULL CHECK (sort_order BETWEEN 0 AND 2),
  UNIQUE (product_id, sort_order)
);

CREATE TABLE favorites (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product_id)
);

CREATE INDEX products_feed_idx ON products (status, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX products_category_idx ON products (category, status, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX products_seller_idx ON products (seller_id, created_at DESC);
```

查询商品时排除 `deleted_at IS NOT NULL`。发布、状态修改和删除必须按 `seller_id` 做授权检查。文本搜索量增加后可增加 PostgreSQL 全文索引。会话与审计日志可分别建表，并设置留存策略。
