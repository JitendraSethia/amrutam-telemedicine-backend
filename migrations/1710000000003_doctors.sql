-- Up Migration
CREATE TABLE specializations (
  id    smallserial PRIMARY KEY,
  slug  text NOT NULL UNIQUE,
  name  text NOT NULL
);

-- DOCTORS: professional profile for users with role 'doctor'. Non-PII
-- professional data is stored in the clear so it is searchable/filterable.
CREATE TABLE doctors (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  display_name       text NOT NULL,
  bio                text,
  years_experience   int NOT NULL DEFAULT 0 CHECK (years_experience >= 0),
  consultation_fee   numeric(10,2) NOT NULL CHECK (consultation_fee >= 0),
  currency           char(3) NOT NULL DEFAULT 'INR',
  languages          text[] NOT NULL DEFAULT '{}',
  rating_avg         numeric(3,2) NOT NULL DEFAULT 0 CHECK (rating_avg >= 0 AND rating_avg <= 5),
  rating_count       int NOT NULL DEFAULT 0,
  is_verified        boolean NOT NULL DEFAULT false,
  is_accepting       boolean NOT NULL DEFAULT true,
  timezone           text NOT NULL DEFAULT 'Asia/Kolkata',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER doctors_set_updated_at BEFORE UPDATE ON doctors
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Search-supporting indexes (see search module + architecture doc).
CREATE INDEX doctors_fee_idx ON doctors (consultation_fee) WHERE is_accepting;
CREATE INDEX doctors_rating_idx ON doctors (rating_avg DESC) WHERE is_accepting;
CREATE INDEX doctors_name_trgm_idx ON doctors USING gin (display_name gin_trgm_ops);
CREATE INDEX doctors_languages_gin ON doctors USING gin (languages);

CREATE TABLE doctor_specializations (
  doctor_id         uuid NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  specialization_id smallint NOT NULL REFERENCES specializations(id) ON DELETE RESTRICT,
  PRIMARY KEY (doctor_id, specialization_id)
);
CREATE INDEX doctor_spec_by_spec_idx ON doctor_specializations (specialization_id);

-- Down Migration
DROP TABLE IF EXISTS doctor_specializations;
DROP TABLE IF EXISTS doctors;
DROP TABLE IF EXISTS specializations;
