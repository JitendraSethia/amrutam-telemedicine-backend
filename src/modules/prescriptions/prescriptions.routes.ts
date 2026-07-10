import type { FastifyInstance } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { commonErrors, IdParam, IdempotencyHeader, PaginationQuery } from '../../http/common-schema.js';
import { reqMeta } from '../../http/request-meta.js';
import {
  IssuePrescriptionBody,
  PrescriptionPageResponse,
  PrescriptionSchema,
} from './prescriptions.schemas.js';

export async function prescriptionRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<TypeBoxTypeProvider>();
  const { prescriptions } = app.container;

  r.post(
    '/prescriptions',
    {
      preHandler: [app.authorize('doctor:write_prescription'), app.idempotent],
      schema: {
        tags: ['prescriptions'],
        summary: 'Doctor issues a prescription for a consultation (encrypted at rest)',
        security: [{ bearerAuth: [] }],
        headers: IdempotencyHeader,
        body: IssuePrescriptionBody,
        response: { 201: PrescriptionSchema, ...commonErrors },
      },
    },
    async (req, reply) => {
      const created = await prescriptions.issue(
        req.user!,
        req.body.consultationId,
        req.body.content,
        reqMeta(req),
        req.body.supersedesId,
      );
      return reply.status(201).send(created);
    },
  );

  r.get(
    '/prescriptions',
    {
      preHandler: [app.authorize('consultation:read_own')],
      schema: {
        tags: ['prescriptions'],
        summary: 'List my prescriptions (patient)',
        security: [{ bearerAuth: [] }],
        querystring: PaginationQuery,
        response: { 200: PrescriptionPageResponse, ...commonErrors },
      },
    },
    async (req) => prescriptions.listMine(req.user!, { limit: req.query.limit ?? 20, cursor: req.query.cursor }),
  );

  r.get(
    '/prescriptions/:id',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['prescriptions'],
        summary: 'Get a prescription (patient owner or issuing doctor)',
        security: [{ bearerAuth: [] }],
        params: IdParam,
        response: { 200: PrescriptionSchema, ...commonErrors },
      },
    },
    async (req) => prescriptions.getForViewer(req.user!, req.params.id),
  );
}
