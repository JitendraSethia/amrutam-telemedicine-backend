-- Up Migration
-- REVIEWS: a patient rates a completed consultation. Doctor rating_avg/count are
-- recomputed asynchronously (rating.recompute job) to avoid hot-row contention
-- on the doctors table under load.
CREATE TABLE reviews (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id uuid NOT NULL UNIQUE REFERENCES consultations(id) ON DELETE CASCADE,
  doctor_id       uuid NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  patient_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating          smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment         text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reviews_doctor_idx ON reviews (doctor_id, created_at DESC);

-- Down Migration
DROP TABLE IF EXISTS reviews;
