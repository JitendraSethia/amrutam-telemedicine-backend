import type { FastifyInstance } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { commonErrors, IdempotencyHeader } from '../../http/common-schema.js';
import { reqMeta } from '../../http/request-meta.js';
import { ConsultationSchema } from '../consultations/consultations.schemas.js';
import { BookBody } from './booking.schemas.js';

export async function bookingRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<TypeBoxTypeProvider>();
  const { bookings } = app.container;

  r.post(
    '/bookings',
    {
      // Requires: patient role, an Idempotency-Key, and (elevated) MFA state.
      preHandler: [app.authorize('booking:create'), app.idempotent],
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['bookings'],
        summary: 'Book a consultation slot (idempotent, concurrency-safe, saga-driven)',
        description:
          'Reserves the slot, creates a pending consultation, charges payment, and confirms — ' +
          'compensating automatically on failure. Send a unique Idempotency-Key header.',
        security: [{ bearerAuth: [] }],
        headers: IdempotencyHeader,
        body: BookBody,
        response: { 201: ConsultationSchema, ...commonErrors, 402: commonErrors[409] },
      },
    },
    async (req, reply) => {
      const consultation = await bookings.book(req.user!, req.body, reqMeta(req));
      return reply.status(201).send(consultation);
    },
  );
}
