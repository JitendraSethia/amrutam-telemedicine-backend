import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { env, corsOrigins, isProd } from './config/env.js';
import { loggerOptions } from './observability/logger.js';
import { redis } from './cache/redis.js';
import { db } from './db/pool.js';
import { buildContainer } from './container.js';
import { ErrorResponse } from './http/common-schema.js';
import { errorHandlerPlugin } from './plugins/errorHandler.js';
import { authPlugin } from './plugins/auth.js';
import { idempotencyPlugin } from './plugins/idempotency.js';
import { metricsPlugin } from './plugins/metrics.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { doctorRoutes } from './modules/doctors/doctors.routes.js';
import { availabilityRoutes } from './modules/availability/availability.routes.js';
import { bookingRoutes } from './modules/bookings/booking.routes.js';
import { consultationRoutes } from './modules/consultations/consultations.routes.js';
import { prescriptionRoutes } from './modules/prescriptions/prescriptions.routes.js';
import { paymentRoutes } from './modules/payments/payments.routes.js';
import { adminRoutes } from './modules/admin/admin.routes.js';

const API_PREFIX = '/api/v1';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions,
    trustProxy: true, // behind a load balancer; derive client IP from XFF
    requestIdHeader: 'x-request-id',
    genReqId: (req) => (req.headers['x-request-id'] as string) || randomUUID(),
    bodyLimit: 1_048_576, // 1 MiB
    ajv: { customOptions: { removeAdditional: 'failing', coerceTypes: true } },
  });

  // Capture raw body (needed for webhook HMAC verification) while still parsing.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    (req as { rawBody?: string }).rawBody = body as string;
    if (!body || (body as string).length === 0) return done(null, {});
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      (err as { statusCode?: number }).statusCode = 400;
      done(err as Error, undefined);
    }
  });

  // Shared schemas referenced via $ref in route response definitions.
  app.addSchema(ErrorResponse);

  // ── Security middleware ────────────────────────────────────────────────────
  await app.register(helmet, {
    // A JSON API renders no HTML except the docs page (which sets its own CSP).
    contentSecurityPolicy: false,
    hsts: isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
  });
  await app.register(cors, {
    origin: corsOrigins(),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
  });
  await app.register(cookie, {});

  // ── DI + cross-cutting plugins ─────────────────────────────────────────────
  app.decorate('container', buildContainer());
  await app.register(errorHandlerPlugin);
  await app.register(authPlugin);
  await app.register(idempotencyPlugin);
  await app.register(metricsPlugin);

  // ── OpenAPI docs ───────────────────────────────────────────────────────────
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Amrutam Telemedicine API',
        description:
          'Production-grade telemedicine backend: auth/MFA, doctor availability & booking ' +
          '(idempotent, saga-driven), consultations, prescriptions, payments, admin analytics.',
        version: '1.0.0',
      },
      servers: [{ url: API_PREFIX }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
      tags: [
        { name: 'auth', description: 'Authentication, MFA, sessions' },
        { name: 'doctors', description: 'Doctor profiles & search' },
        { name: 'availability', description: 'Slots' },
        { name: 'bookings', description: 'Idempotent, saga-driven booking' },
        { name: 'consultations', description: 'Consultation lifecycle' },
        { name: 'prescriptions', description: 'Prescriptions' },
        { name: 'payments', description: 'Payments & webhooks' },
        { name: 'admin', description: 'Analytics & audit' },
      ],
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  // ── Health / readiness (unauthenticated, unlimited) ────────────────────────
  app.get('/health', { logLevel: 'warn', config: { public: true } }, async () => ({
    status: 'ok',
    service: env.APP_NAME,
    time: new Date().toISOString(),
  }));

  app.get('/ready', { logLevel: 'warn', config: { public: true } }, async (_req, reply) => {
    const [dbOk, redisOk] = await Promise.all([
      db.healthcheck().catch(() => false),
      redis.ping().then((r) => r === 'PONG').catch(() => false),
    ]);
    const ready = dbOk && redisOk;
    return reply.status(ready ? 200 : 503).send({ ready, deps: { db: dbOk, redis: redisOk } });
  });

  // ── API routes (rate-limited scope) ────────────────────────────────────────
  await app.register(
    async (api) => {
      await api.register(rateLimit, {
        global: true,
        max: env.RATE_LIMIT_MAX,
        timeWindow: env.RATE_LIMIT_WINDOW,
        redis,
        nameSpace: 'amrutam-rl:',
        keyGenerator: (req) => `${req.user?.id ?? req.ip}`,
        skipOnError: true, // fail open if Redis is unavailable (availability SLO)
      });

      await api.register(authRoutes, { prefix: '/auth' });
      await api.register(doctorRoutes);
      await api.register(availabilityRoutes);
      await api.register(bookingRoutes);
      await api.register(consultationRoutes);
      await api.register(prescriptionRoutes);
      await api.register(paymentRoutes);
      await api.register(adminRoutes);
    },
    { prefix: API_PREFIX },
  );

  return app;
}
