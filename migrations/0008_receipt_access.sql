-- Durable guest access is scoped to a minimal order receipt, never files or contacts.
-- Existing orders keep NULL and retain their original session-only access.
ALTER TABLE commerce_orders ADD COLUMN receipt_token_hash TEXT
  CHECK(receipt_token_hash IS NULL OR (length(receipt_token_hash)=64 AND receipt_token_hash NOT GLOB '*[^0-9a-f]*'));
