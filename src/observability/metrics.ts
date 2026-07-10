import client from 'prom-client';

/**
 * Prometheus metrics. Default process/runtime metrics plus domain-specific
 * counters and histograms. Exposed at GET /metrics (see app bootstrap).
 * Histogram buckets are tuned to the SLOs in the assignment:
 * p95 < 200ms reads, < 500ms writes.
 */
export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry, prefix: 'amrutam_' });

export const httpRequestDuration = new client.Histogram({
  name: 'amrutam_http_request_duration_seconds',
  help: 'HTTP request latency in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.01, 0.025, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 0.75, 1, 2, 5],
  registers: [registry],
});

export const httpRequestsTotal = new client.Counter({
  name: 'amrutam_http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [registry],
});

export const bookingsTotal = new client.Counter({
  name: 'amrutam_bookings_total',
  help: 'Booking attempts by outcome',
  labelNames: ['outcome'] as const, // confirmed | slot_taken | payment_failed | cancelled
  registers: [registry],
});

export const idempotencyHits = new client.Counter({
  name: 'amrutam_idempotency_replays_total',
  help: 'Idempotent write requests served from the idempotency store',
  labelNames: ['route'] as const,
  registers: [registry],
});

export const cacheOps = new client.Counter({
  name: 'amrutam_cache_ops_total',
  help: 'Cache operations by result',
  labelNames: ['result'] as const, // hit | miss
  registers: [registry],
});

export const sagaSteps = new client.Counter({
  name: 'amrutam_saga_steps_total',
  help: 'Saga step executions',
  labelNames: ['saga', 'step', 'status'] as const, // status: ok | compensated | failed
  registers: [registry],
});

export const jobDuration = new client.Histogram({
  name: 'amrutam_job_duration_seconds',
  help: 'Async job processing latency',
  labelNames: ['queue', 'status'] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
  registers: [registry],
});

export const dbPoolWaits = new client.Counter({
  name: 'amrutam_db_pool_waits_total',
  help: 'Times a query waited for a free DB connection',
  registers: [registry],
});

export async function metricsText(): Promise<string> {
  return registry.metrics();
}
