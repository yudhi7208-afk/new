-- Authentication schema only. Bootstrap tokens and credentials stay private.
PRAGMA foreign_keys = ON;

CREATE TABLE admin_users (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  email TEXT NOT NULL UNIQUE,
  password_salt TEXT NOT NULL CHECK (length(password_salt) = 64),
  password_hash TEXT NOT NULL CHECK (length(password_hash) = 64),
  password_iterations INTEGER NOT NULL CHECK (password_iterations = 100000),
  created_at INTEGER NOT NULL
);

CREATE TABLE admin_setup (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  token_hash TEXT NOT NULL CHECK (length(token_hash) = 64),
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);

CREATE TABLE admin_sessions (
  token_hash TEXT PRIMARY KEY CHECK (length(token_hash) = 64),
  user_id INTEGER NOT NULL REFERENCES admin_users(id),
  csrf_token TEXT NOT NULL CHECK (length(csrf_token) = 64),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX admin_sessions_expiry_idx ON admin_sessions(expires_at);

CREATE TABLE admin_rate_limits (
  bucket_hash TEXT PRIMARY KEY CHECK (length(bucket_hash) = 64),
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts > 0)
);

CREATE INDEX admin_rate_limits_window_idx ON admin_rate_limits(window_start);
