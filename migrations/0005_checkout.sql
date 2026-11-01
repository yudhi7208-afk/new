-- Native Cloudflare commerce stays separate from immutable WordPress snapshots.
PRAGMA foreign_keys = ON;

CREATE TABLE commerce_settings (
  key TEXT PRIMARY KEY CHECK (key IN ('catalog_json','payout_json','mode')),
  value_json TEXT NOT NULL
);
INSERT INTO commerce_settings(key,value_json) VALUES('mode','"preview"');

CREATE TABLE checkout_sessions (
  token_hash TEXT PRIMARY KEY,
  csrf_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX checkout_sessions_expiry_idx ON checkout_sessions(expires_at);

CREATE TABLE checkout_rate_limits (
  bucket_hash TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL CHECK(attempts > 0)
);
CREATE INDEX checkout_rate_limits_window_idx ON checkout_rate_limits(window_start);

CREATE TABLE checkout_quotes (
  id TEXT PRIMARY KEY,
  session_hash TEXT NOT NULL REFERENCES checkout_sessions(token_hash),
  city TEXT NOT NULL,
  package_id TEXT NOT NULL,
  package_name TEXT NOT NULL,
  features_json TEXT NOT NULL,
  payout_json TEXT NOT NULL,
  base_amount INTEGER NOT NULL CHECK(base_amount >= 0),
  unique_code INTEGER NOT NULL CHECK(unique_code BETWEEN 0 AND 99),
  amount INTEGER NOT NULL CHECK(amount >= 0 AND amount=base_amount+unique_code),
  is_test INTEGER NOT NULL CHECK(is_test IN (0,1)),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  CHECK((base_amount=0 AND unique_code=0) OR (base_amount>0 AND unique_code BETWEEN 1 AND 99))
);
CREATE INDEX checkout_quotes_session_idx ON checkout_quotes(session_hash,created_at);

CREATE TABLE checkout_code_reservations (
  slot_key TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL UNIQUE REFERENCES checkout_quotes(id),
  expires_at INTEGER NOT NULL
);

CREATE TABLE commerce_orders (
  id TEXT PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  quote_id TEXT NOT NULL UNIQUE REFERENCES checkout_quotes(id),
  session_hash TEXT NOT NULL REFERENCES checkout_sessions(token_hash),
  idempotency_key TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  whatsapp TEXT NOT NULL,
  email TEXT NOT NULL,
  city TEXT NOT NULL,
  package_id TEXT NOT NULL,
  package_name TEXT NOT NULL,
  features_json TEXT NOT NULL,
  base_amount INTEGER NOT NULL,
  unique_code INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  ad_text TEXT NOT NULL,
  caption TEXT NOT NULL,
  notes TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  post_status TEXT NOT NULL DEFAULT 'publish' CHECK(post_status IN ('publish','trash')),
  ordered_at_local TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  admin_note TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  updated_by INTEGER REFERENCES admin_users(id),
  is_test INTEGER NOT NULL CHECK(is_test IN (0,1)),
  UNIQUE(session_hash,idempotency_key),
  CHECK(amount=base_amount+unique_code)
);
CREATE INDEX commerce_orders_time_idx ON commerce_orders(created_at,id);
CREATE INDEX commerce_orders_status_idx ON commerce_orders(post_status,status);

CREATE TABLE commerce_files (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES commerce_orders(id),
  kind TEXT NOT NULL CHECK(kind IN ('proof','material')),
  position INTEGER NOT NULL CHECK(position >= 0),
  original_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL,
  byte_count INTEGER NOT NULL CHECK(byte_count > 0),
  created_at INTEGER NOT NULL,
  UNIQUE(order_id,kind,position)
);

CREATE TABLE commerce_events (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES commerce_orders(id),
  admin_id INTEGER REFERENCES admin_users(id),
  action TEXT NOT NULL CHECK(action IN ('created','update')),
  previous_status TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
  previous_note TEXT NOT NULL,
  note TEXT NOT NULL,
  reason TEXT NOT NULL,
  revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(order_id,revision)
);
CREATE INDEX commerce_events_order_idx ON commerce_events(order_id,created_at,id);

CREATE TABLE checkout_submissions (
  session_hash TEXT NOT NULL REFERENCES checkout_sessions(token_hash),
  idempotency_key TEXT NOT NULL,
  quote_id TEXT NOT NULL UNIQUE REFERENCES checkout_quotes(id),
  claim_id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK(state IN ('processing','complete')),
  order_id TEXT UNIQUE REFERENCES commerce_orders(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(session_hash,idempotency_key)
);
