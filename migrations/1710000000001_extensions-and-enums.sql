-- Up Migration
-- pgcrypto: gen_random_uuid(); citext: case-insensitive blind-index columns.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm; -- trigram indexes for fuzzy doctor search

CREATE TYPE user_role AS ENUM ('patient', 'doctor', 'admin');
CREATE TYPE user_status AS ENUM ('active', 'suspended', 'deleted');
CREATE TYPE slot_status AS ENUM ('available', 'held', 'booked', 'blocked');
CREATE TYPE consultation_status AS ENUM (
  'pending_payment', 'scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'
);
CREATE TYPE consultation_mode AS ENUM ('video', 'audio', 'chat');
CREATE TYPE payment_status AS ENUM (
  'requires_payment', 'processing', 'succeeded', 'failed', 'refunded'
);
CREATE TYPE saga_status AS ENUM ('running', 'completed', 'compensating', 'compensated', 'failed');

-- Reusable trigger to maintain updated_at.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Down Migration
DROP FUNCTION IF EXISTS set_updated_at();
DROP TYPE IF EXISTS saga_status;
DROP TYPE IF EXISTS payment_status;
DROP TYPE IF EXISTS consultation_mode;
DROP TYPE IF EXISTS consultation_status;
DROP TYPE IF EXISTS slot_status;
DROP TYPE IF EXISTS user_status;
DROP TYPE IF EXISTS user_role;
DROP EXTENSION IF EXISTS pg_trgm;
DROP EXTENSION IF EXISTS citext;
DROP EXTENSION IF EXISTS pgcrypto;
