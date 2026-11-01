-- Editable business settings/content remain separate from imported order data.
PRAGMA foreign_keys = ON;

CREATE TABLE business_admin_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  site_json TEXT,
  updated_at INTEGER NOT NULL,
  updated_by INTEGER REFERENCES admin_users(id)
);
INSERT INTO business_admin_state(id,revision,site_json,updated_at,updated_by) VALUES(1,0,NULL,0,NULL);

CREATE TABLE page_content (
  path TEXT PRIMARY KEY,
  data_json TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  updated_at INTEGER NOT NULL,
  updated_by INTEGER NOT NULL REFERENCES admin_users(id)
);

CREATE TABLE business_admin_events (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('business','content')),
  path TEXT NOT NULL,
  admin_id INTEGER NOT NULL REFERENCES admin_users(id),
  previous_json TEXT NOT NULL,
  next_json TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 3 AND 500),
  revision INTEGER NOT NULL CHECK (revision > 0),
  created_at INTEGER NOT NULL,
  UNIQUE(scope,path,revision)
);
CREATE INDEX business_admin_events_recent_idx ON business_admin_events(scope,created_at DESC);
