-- 015_pii_encryption.sql — column-level encryption for users.email (NFR §6)
--
-- users.email now holds AES-256-GCM ciphertext (`v1:...`), which is longer
-- than 180 characters and different on every write, so:
--   * the column widens to TEXT,
--   * its UNIQUE constraint moves to email_hash, an HMAC blind index.
-- Existing plaintext rows are encrypted by the application at boot (see
-- db/migrate.ts): the database never sees the key.

ALTER TABLE users ALTER COLUMN email TYPE TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_hash_key ON users (email_hash);
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;
