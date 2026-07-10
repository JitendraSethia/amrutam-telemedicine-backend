-- Up Migration
-- AUDIT_LOGS: append-only, tamper-evident audit trail for every sensitive
-- action (compliance requirement). This is the highest-volume table (one row
-- per mutating action), so it is DECLARATIVELY RANGE-PARTITIONED BY MONTH:
--   * cheap retention/archival — drop or detach an old partition in O(1);
--   * smaller per-partition indexes keep writes fast at 100k+/day;
--   * queries with a time filter prune to a single partition.
-- The partition key (created_at) must be part of the primary key.
CREATE TABLE audit_logs (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid,
  actor_role    user_role,
  action        text NOT NULL,        -- e.g. 'consultation.booked'
  resource_type text NOT NULL,        -- e.g. 'consultation'
  resource_id   text,
  outcome       text NOT NULL DEFAULT 'success',  -- success | failure
  ip            inet,
  user_agent    text,
  request_id    text,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,  -- PII-free structured detail
  row_hash      char(64) NOT NULL,    -- sha256 of canonical row → tamper evidence
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_user_id, created_at DESC);
CREATE INDEX audit_logs_resource_idx ON audit_logs (resource_type, resource_id, created_at DESC);
CREATE INDEX audit_logs_action_idx ON audit_logs (action, created_at DESC);

-- A DEFAULT partition guarantees inserts never fail even if the monthly
-- partition maintenance job is late. Rows here are migrated by the job.
CREATE TABLE audit_logs_default PARTITION OF audit_logs DEFAULT;

-- Helper to create a month partition idempotently. In production a scheduled
-- job (pg_partman or the app's partition-maintenance job) calls this to
-- pre-create the next N months. Bootstrap a few months here.
CREATE OR REPLACE FUNCTION ensure_audit_partition(month_start date)
RETURNS void AS $$
DECLARE
  part_name text := 'audit_logs_' || to_char(month_start, 'YYYYMM');
  start_ts  text := to_char(month_start, 'YYYY-MM-01');
  end_ts    text := to_char((month_start + interval '1 month')::date, 'YYYY-MM-01');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = part_name) THEN
    EXECUTE format(
      'CREATE TABLE %I PARTITION OF audit_logs FOR VALUES FROM (%L) TO (%L)',
      part_name, start_ts, end_ts
    );
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Bootstrap current month ± 2 (uses the DB clock, so migration is deterministic
-- relative to when it runs).
SELECT ensure_audit_partition(date_trunc('month', now())::date + (n || ' month')::interval)
FROM generate_series(-1, 2) AS n;

-- Down Migration
DROP FUNCTION IF EXISTS ensure_audit_partition(date);
DROP TABLE IF EXISTS audit_logs;
