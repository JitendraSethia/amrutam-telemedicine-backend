-- Up Migration
-- PAYMENTS: one row per payment attempt for a consultation. The unique index on
-- (consultation_id) WHERE status IN active-money states guarantees we never
-- double-charge for the same consultation even if the booking saga retries.
CREATE TABLE payments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id    uuid NOT NULL REFERENCES consultations(id) ON DELETE RESTRICT,
  patient_id         uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount             numeric(10,2) NOT NULL CHECK (amount >= 0),
  currency           char(3) NOT NULL DEFAULT 'INR',
  status             payment_status NOT NULL DEFAULT 'requires_payment',
  provider           text NOT NULL DEFAULT 'mock',
  provider_ref       text,                    -- gateway charge id
  provider_intent    text,                    -- client secret / intent id
  idempotency_key    text NOT NULL,           -- key sent to the gateway
  failure_reason     text,
  refunded_amount    numeric(10,2) NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER payments_set_updated_at BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE UNIQUE INDEX payments_active_consultation_uq
  ON payments (consultation_id)
  WHERE status IN ('requires_payment', 'processing', 'succeeded');

CREATE UNIQUE INDEX payments_idempotency_uq ON payments (idempotency_key);
CREATE INDEX payments_patient_idx ON payments (patient_id, created_at DESC);
CREATE UNIQUE INDEX payments_provider_ref_uq ON payments (provider_ref) WHERE provider_ref IS NOT NULL;

-- Down Migration
DROP TABLE IF EXISTS payments;
