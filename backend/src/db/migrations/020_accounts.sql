-- 020_accounts.sql — self-service accounts: phone, email verification, email change.
--
-- phone is personal data and is stored encrypted like email (utils/pii.ts).
-- Verification tokens are stored only as SHA-256 hashes: a database leak must
-- not hand out working links. One table serves both "verify my address" and
-- "change my address" (the latter carries the pending new address).
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS email_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    purpose VARCHAR(10) NOT NULL CHECK (purpose IN ('verify', 'change')),
    new_email TEXT,
    new_email_hash TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_verifications_user_id ON email_verifications(user_id);
