import type { FastifyRequest } from 'fastify';
import type { RequestMeta } from '../modules/auth/auth.service.js';

/** Extracts audit/security metadata (client IP, UA, correlation id) from a
 * request. `req.ip` respects the trustProxy setting configured in app.ts. */
export function reqMeta(req: FastifyRequest): RequestMeta {
  return {
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    requestId: req.id,
  };
}
