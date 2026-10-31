-- Schema only. Source filenames, paths, and file inventory contain private data.
-- Keep generated SQL, manifests, and staged R2 objects outside the repository.
PRAGMA foreign_keys = ON;

CREATE TABLE order_files (
  id TEXT PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(source_post_id),
  migration_run_id TEXT NOT NULL REFERENCES migration_runs(id),
  kind TEXT NOT NULL CHECK (kind IN ('proof', 'material')),
  position INTEGER NOT NULL CHECK (position >= 0),
  source_path TEXT NOT NULL,
  original_name TEXT,
  mime TEXT,
  storage_key TEXT,
  sha256 TEXT CHECK (sha256 IS NULL OR (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*')),
  byte_count INTEGER CHECK (byte_count IS NULL OR byte_count >= 0),
  missing INTEGER NOT NULL CHECK (missing IN (0, 1)),
  row_sha256 TEXT NOT NULL CHECK (length(row_sha256) = 64 AND row_sha256 NOT GLOB '*[^0-9a-f]*'),
  CHECK (
    (missing = 1 AND storage_key IS NULL AND sha256 IS NULL AND byte_count IS NULL)
    OR
    (missing = 0 AND storage_key IS NOT NULL AND sha256 IS NOT NULL AND byte_count IS NOT NULL)
  )
);

CREATE UNIQUE INDEX order_files_order_kind_position_idx ON order_files(order_id, kind, position);
CREATE INDEX order_files_storage_key_idx ON order_files(storage_key);
