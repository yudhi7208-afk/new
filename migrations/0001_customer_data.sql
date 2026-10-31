-- Schema only. Generated customer data must stay outside the repository.
PRAGMA foreign_keys = ON;

CREATE TABLE migration_runs (
  id TEXT PRIMARY KEY,
  source_sha256 TEXT NOT NULL UNIQUE,
  source_prefix TEXT NOT NULL,
  source_snapshot_at TEXT NOT NULL,
  source_dump_completed_at TEXT,
  prepared_at TEXT NOT NULL,
  order_count INTEGER NOT NULL,
  contact_profile_count INTEGER NOT NULL,
  meta_count INTEGER NOT NULL,
  validation_sha256 TEXT NOT NULL
);

CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  migration_run_id TEXT NOT NULL REFERENCES migration_runs(id),
  identity_sha256 TEXT NOT NULL UNIQUE,
  display_name TEXT,
  whatsapp TEXT,
  email TEXT,
  normalized_name TEXT NOT NULL,
  normalized_whatsapp TEXT NOT NULL,
  normalized_email TEXT NOT NULL,
  first_source_post_id INTEGER NOT NULL,
  row_sha256 TEXT NOT NULL
);

CREATE TABLE orders (
  source_post_id INTEGER PRIMARY KEY,
  migration_run_id TEXT NOT NULL REFERENCES migration_runs(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  order_number TEXT,
  post_status TEXT NOT NULL,
  business_status TEXT,
  customer_name_original TEXT,
  whatsapp_original TEXT,
  email_original TEXT,
  city TEXT,
  package_id TEXT,
  package_name TEXT,
  base_amount INTEGER NOT NULL,
  unique_code INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  ordered_at_local TEXT NOT NULL,
  ordered_at_gmt TEXT NOT NULL,
  modified_at_local TEXT NOT NULL,
  raw_post_json TEXT NOT NULL,
  source_post_sha256 TEXT NOT NULL,
  row_sha256 TEXT NOT NULL
);

CREATE TABLE order_meta (
  source_meta_id INTEGER PRIMARY KEY,
  migration_run_id TEXT NOT NULL REFERENCES migration_runs(id),
  order_id INTEGER NOT NULL REFERENCES orders(source_post_id),
  source_position INTEGER NOT NULL,
  meta_key TEXT,
  meta_value TEXT,
  row_sha256 TEXT NOT NULL
);

CREATE INDEX orders_customer_idx ON orders(customer_id);
CREATE INDEX orders_order_number_idx ON orders(order_number);
CREATE INDEX orders_status_idx ON orders(post_status, business_status);
CREATE INDEX order_meta_order_idx ON order_meta(order_id, source_meta_id);
