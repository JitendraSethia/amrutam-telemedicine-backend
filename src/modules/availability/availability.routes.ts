import type { FastifyInstance } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { commonErrors, IdParam, IdempotencyHeader } from '../../http/common-schema.js';
import { reqMeta } from '../../http/request-meta.js';
import {
  CreateAvailabilityBody,
  CreatedSlotsResponse,
  SlotsListResponse,
  SlotsQuery,
} from './availability.schemas.js';

export async function availabilityRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<TypeBoxTypeProvider>();
  const { availability } = app.container;

  r.post(
    '/doctors/me/availability',
    {
      // Idempotent: re-submitting the same batch with a key won't duplicate slots
      // (and the unique constraint is the backstop).
      preHandler: [app.authorize('doctor:manage_availability'), app.idempotent],
      schema: {
        tags: ['availability'],
        summary: 'Create availability slots from time blocks',
        security: [{ bearerAuth: [] }],
        headers: IdempotencyHeader,
        body: CreateAvailabilityBody,
        response: { 201: CreatedSlotsResponse, ...commonErrors },
      },
    },
    async (req, reply) => {
      const result = await availability.createAvailability(req.user!.id, req.body, reqMeta(req));
      return reply.status(201).send(result);
    },
  );

  r.get(
    '/doctors/:id/slots',
    {
      schema: {
        tags: ['availability'],
        summary: 'List a doctor’s available slots within a time window',
        params: IdParam,
        querystring: SlotsQuery,
        response: { 200: SlotsListResponse, ...commonErrors },
      },
    },
    async (req) =>
      availability.listSlots(req.params.id, req.query.from, req.query.to, req.query.limit ?? 100),
  );
}
