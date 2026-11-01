-- Visibility changes are reversible and never edit the WordPress snapshot.
ALTER TABLE order_admin_state ADD COLUMN post_status TEXT CHECK(post_status IN ('publish','private','pending','draft','future','auto-draft','inherit','trash'));
ALTER TABLE order_admin_state ADD COLUMN restore_post_status TEXT CHECK(restore_post_status IN ('publish','private','pending','draft','future','auto-draft','inherit'));
ALTER TABLE order_admin_events ADD COLUMN archive_action TEXT CHECK(archive_action IN ('archive','restore'));
ALTER TABLE order_admin_events ADD COLUMN previous_post_status TEXT;
ALTER TABLE order_admin_events ADD COLUMN post_status TEXT;
ALTER TABLE commerce_events ADD COLUMN archive_action TEXT CHECK(archive_action IN ('archive','restore'));
ALTER TABLE commerce_events ADD COLUMN previous_post_status TEXT;
ALTER TABLE commerce_events ADD COLUMN post_status TEXT;
