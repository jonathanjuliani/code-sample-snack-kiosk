CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  sort INTEGER NOT NULL
);

-- option_groups_json holds the item's option groups and choices as one read-only document:
-- they are only ever read with their item, never queried on their own.
CREATE TABLE IF NOT EXISTS menu_items (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES categories(id),
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  available INTEGER NOT NULL CHECK (available IN (0, 1)),
  sort INTEGER NOT NULL,
  option_groups_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  kiosk_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending_payment', 'paid', 'payment_failed')),
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('card', 'tap')),
  last4 TEXT,
  payment_ref TEXT,
  pickup_day TEXT,
  pickup_number TEXT,
  response_status INTEGER,
  response_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS orders_pickup_unique ON orders (pickup_day, pickup_number)
  WHERE pickup_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS order_lines (
  order_id TEXT NOT NULL REFERENCES orders(id),
  line_no INTEGER NOT NULL,
  item_id TEXT NOT NULL,
  name TEXT NOT NULL,
  choice_ids_json TEXT NOT NULL,
  option_labels_json TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  line_total_cents INTEGER NOT NULL CHECK (line_total_cents >= 0),
  PRIMARY KEY (order_id, line_no)
);

CREATE TABLE IF NOT EXISTS pickup_counters (
  day TEXT PRIMARY KEY,
  last_number INTEGER NOT NULL
);
