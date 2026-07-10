-- Up Migration
-- IDEMPOTENCY_KEYS: durable record of processed write requests. The fingerprint
-- scopes a client's Idempotency-Key to (user, method, path) so keys can't
-- collide across users or endpoints. `request_hash` detects the same key being
-- reused with a *different* body (a client bug) → we reject with 409.
-- The row also caches the original response so a retry returns byte-identical
-- results. Redis is the fast path; this table is the durable source of truth.
CREATE TABLE idempotency_keys (
  fingerprint     char(64) PRIMARY KEY,        -- sha256(user_id|method|path|key)
  idem_key        text NOT NULL,
  user_id         uuid,
  method          text NOT NULL,
  path            text NOT NULL,
  request_hash    char(64) NOT NULL,
  status          text NOT NULL DEFAULT 'in_progress',  -- in_progress | completed
  response_status int,
  response_body   jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL
);
CREATE INDEX idempotency_expiry_idx ON idempotency_keys (expires_at);

-- SAGA_INSTANCES: orchestration state for long-running, multi-step workflows
-- (e.g. booking = reserve slot → create consultation → charge payment →
-- confirm). Persisted so a crash mid-saga can resume/compensate.
CREATE TABLE saga_instances (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type           text NOT NULL,               -- 'booking'
  status         saga_status NOT NULL DEFAULT 'running',
  current_step   text NOT NULL,
  correlation_id text,                        -- e.g. consultation id
  context        jsonb NOT NULL DEFAULT '{}'::jsonb,
  completed_steps text[] NOT NULL DEFAULT '{}',
  attempts       int NOT NULL DEFAULT 0,
  last_error     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER saga_set_updated_at BEFORE UPDATE ON saga_instances
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX saga_status_idx ON saga_instances (status, updated_at);
CREATE INDEX saga_correlation_idx ON saga_instances (correlation_id);

-- OUTBOX: transactional outbox. Domain events are written in the SAME
-- transaction as the state change, then a relay publishes them to the job
-- queue / message bus at-least-once. Guarantees no "committed but never
-- published" gaps (the dual-write problem).
CREATE TABLE outbox (
  id             bigserial PRIMARY KEY,
  aggregate_type text NOT NULL,
  aggregate_id   text NOT NULL,
  event_type     text NOT NULL,
  payload        jsonb NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  published_at   timestamptz,
  attempts       int NOT NULL DEFAULT 0
);
CREATE INDEX outbox_unpublished_idx ON outbox (created_at) WHERE published_at IS NULL;

-- Down Migration
DROP TABLE IF EXISTS outbox;
DROP TABLE IF EXISTS saga_instances;
DROP TABLE IF EXISTS idempotency_keys;
