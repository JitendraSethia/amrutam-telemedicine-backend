-- Up Migration
-- PRESCRIPTIONS: issued by a doctor against a completed/in-progress
-- consultation. Clinical content is encrypted; it is append-only and versioned
-- (a correction creates a new row referencing the prior one) — prescriptions
-- are never edited in place, for medico-legal traceability.
CREATE TABLE prescriptions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id  uuid NOT NULL REFERENCES consultations(id) ON DELETE RESTRICT,
  doctor_id        uuid NOT NULL REFERENCES doctors(id) ON DELETE RESTRICT,
  patient_id       uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  content_enc      text NOT NULL,          -- encrypted JSON: medications, dosage, notes
  supersedes_id    uuid REFERENCES prescriptions(id),
  issued_at        timestamptz NOT NULL DEFAULT now(),
  pdf_object_key   text,                   -- populated asynchronously by a job
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX prescriptions_consultation_idx ON prescriptions (consultation_id);
CREATE INDEX prescriptions_patient_idx ON prescriptions (patient_id, issued_at DESC);
CREATE INDEX prescriptions_doctor_idx ON prescriptions (doctor_id, issued_at DESC);

-- Down Migration
DROP TABLE IF EXISTS prescriptions;
