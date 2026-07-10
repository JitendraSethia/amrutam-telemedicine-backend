-- Up Migration
-- AVAILABILITY_SLOTS: discrete bookable slots. The booking flow takes a
-- row-level lock (SELECT ... FOR UPDATE) on the target slot and asserts
-- status='available' before flipping it to 'held'/'booked', which prevents
-- double booking under concurrency. `version` supports optimistic paths and
-- `hold_expires_at` lets a background job release abandoned holds.
CREATE TABLE availability_slots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id       uuid NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  start_ts        timestamptz NOT NULL,
  end_ts          timestamptz NOT NULL,
  status          slot_status NOT NULL DEFAULT 'available',
  version         int NOT NULL DEFAULT 0,
  held_by         uuid REFERENCES users(id),
  hold_expires_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT slot_time_valid CHECK (end_ts > start_ts)
);
CREATE TRIGGER slots_set_updated_at BEFORE UPDATE ON availability_slots
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A doctor cannot have two slots starting at the same instant.
CREATE UNIQUE INDEX slots_doctor_start_uq ON availability_slots (doctor_id, start_ts);

-- Fast "find available slots for doctor in window" (the hot read path).
CREATE INDEX slots_doctor_available_idx
  ON availability_slots (doctor_id, start_ts)
  WHERE status = 'available';

-- Lets the hold-reaper job efficiently find expired holds.
CREATE INDEX slots_hold_expiry_idx
  ON availability_slots (hold_expires_at)
  WHERE status = 'held';

-- Prevent overlapping slots for the same doctor (defence in depth vs. bad input).
-- Requires btree_gist for the equality part of the exclusion constraint.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE availability_slots
  ADD CONSTRAINT slots_no_overlap
  EXCLUDE USING gist (
    doctor_id WITH =,
    tstzrange(start_ts, end_ts) WITH &&
  );

-- Down Migration
DROP TABLE IF EXISTS availability_slots;
DROP EXTENSION IF EXISTS btree_gist;
