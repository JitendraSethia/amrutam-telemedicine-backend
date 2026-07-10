-- Up Migration
-- CONSULTATIONS: the core clinical encounter. `reason_enc`/`notes_enc` are
-- encrypted health data (highest data-classification tier).
CREATE TABLE consultations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id          uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  doctor_id           uuid NOT NULL REFERENCES doctors(id) ON DELETE RESTRICT,
  slot_id             uuid NOT NULL REFERENCES availability_slots(id) ON DELETE RESTRICT,
  status              consultation_status NOT NULL DEFAULT 'pending_payment',
  mode                consultation_mode NOT NULL DEFAULT 'video',
  reason_enc          text,
  notes_enc           text,                  -- doctor's clinical notes (encrypted)
  scheduled_start     timestamptz NOT NULL,
  scheduled_end       timestamptz NOT NULL,
  started_at          timestamptz,
  ended_at            timestamptz,
  cancelled_at        timestamptz,
  cancellation_reason text,
  fee_amount          numeric(10,2) NOT NULL,
  currency            char(3) NOT NULL DEFAULT 'INR',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER consultations_set_updated_at BEFORE UPDATE ON consultations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- HARD double-booking guard: at most one *active* consultation per slot,
-- enforced by the database regardless of application logic.
CREATE UNIQUE INDEX consultations_active_slot_uq
  ON consultations (slot_id)
  WHERE status IN ('pending_payment', 'scheduled', 'in_progress');

-- Read paths: patient timeline, doctor calendar, admin analytics by day.
CREATE INDEX consultations_patient_idx ON consultations (patient_id, scheduled_start DESC);
CREATE INDEX consultations_doctor_idx ON consultations (doctor_id, scheduled_start DESC);
CREATE INDEX consultations_status_idx ON consultations (status, scheduled_start);
CREATE INDEX consultations_created_brin ON consultations USING brin (created_at);

-- Down Migration
DROP TABLE IF EXISTS consultations;
