-- 014_payments_checkout.sql — Razorpay checkout columns (PRD §15 item 4)
--
-- 010 created `payments` with only (user_id, course_id, amount, status,
-- created_at), which is enough for admin reporting but not for driving a real
-- checkout: the order id is the idempotency key, the payment id is the
-- gateway's receipt, and the status lifecycle needs 'initiated' / 'success' /
-- 'failed' / 'refunded'. This migration adds those without touching 010 so
-- existing deployments keep their rows.

ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS currency            VARCHAR(3) DEFAULT 'INR',
    ADD COLUMN IF NOT EXISTS razorpay_order_id   VARCHAR(64),
    ADD COLUMN IF NOT EXISTS razorpay_payment_id VARCHAR(64),
    ADD COLUMN IF NOT EXISTS updated_at          TIMESTAMPTZ DEFAULT now();

-- The webhook and the client-side verify step both look a payment up by order
-- id, and the ordering receipt prints it, so it must be unique. Partial index:
-- legacy rows from 010 have NULL order ids and must not collide.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_razorpay_order_id
    ON payments(razorpay_order_id)
    WHERE razorpay_order_id IS NOT NULL;

-- "has this learner paid for this course?" is the hot eligibility check; the
-- composite covers it without a second lookup.
CREATE INDEX IF NOT EXISTS idx_payments_user_course_status
    ON payments(user_id, course_id, status);
