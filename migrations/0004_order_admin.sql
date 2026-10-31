-- Working state is separate from the immutable WordPress migration snapshot.
CREATE TABLE order_admin_state (
  order_id INTEGER PRIMARY KEY REFERENCES orders(source_post_id),
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
  admin_note TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL CHECK(revision > 0),
  updated_at INTEGER NOT NULL,
  updated_by INTEGER NOT NULL REFERENCES admin_users(id),
  last_change_id TEXT NOT NULL UNIQUE
);

CREATE TABLE order_admin_events (
  id TEXT PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(source_post_id),
  admin_id INTEGER NOT NULL REFERENCES admin_users(id),
  action TEXT NOT NULL CHECK(action='update'),
  previous_status TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
  previous_note TEXT NOT NULL,
  note TEXT NOT NULL,
  reason TEXT NOT NULL,
  revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(order_id,revision)
);
CREATE INDEX order_admin_events_order_idx ON order_admin_events(order_id,created_at,id);
