import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { httpRequestDuration, httpRequestsTotal, metricsText } from '../observability/metrics.js';

/**
 * Records per-request latency/throughput and exposes GET /metrics for
 * Prometheus. The route label uses the *route pattern* (e.g. /doctors/:id)
 * rather than the concrete path, keeping metric cardinality bounded.
 */
export const metricsPlugin = fp(async function metricsPlugin(app: FastifyInstance) {
  app.addHook('onResponse', async (req, reply) => {
    const route = req.routeOptions?.url ?? 'unmatched';
    const labels = {
      method: req.method,
      route,
      status_code: String(reply.statusCode),
    };
    // reply.elapsedTime is in milliseconds.
    httpRequestDuration.observe(labels, reply.elapsedTime / 1000);
    httpRequestsTotal.inc(labels);
  });

  app.get('/metrics', { logLevel: 'warn', config: { public: true } }, async (_req, reply) => {
    reply.header('Content-Type', 'text/plain; version=0.0.4');
    return metricsText();
  });
});
