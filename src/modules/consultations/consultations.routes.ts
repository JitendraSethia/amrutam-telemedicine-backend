import type { FastifyInstance } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { commonErrors, IdParam } from '../../http/common-schema.js';
import { reqMeta } from '../../http/request-meta.js';
import {
  CancelBody,
  ConsultationListQuery,
  ConsultationPageResponse,
  ConsultationSchema,
  NotesBody,
  ReviewBody,
} from './consultations.schemas.js';

export async function consultationRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<TypeBoxTypeProvider>();
  const { consultations } = app.container;

  r.get(
    '/consultations',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['consultations'],
        summary: 'List my consultations (patient timeline or doctor calendar)',
        security: [{ bearerAuth: [] }],
        querystring: ConsultationListQuery,
        response: { 200: ConsultationPageResponse, ...commonErrors },
      },
    },
    async (req) => consultations.list(req.user!, { ...req.query, limit: req.query.limit ?? 20 }),
  );

  r.get(
    '/consultations/:id',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['consultations'],
        summary: 'Get a consultation (participants only; PHI decrypted for them)',
        security: [{ bearerAuth: [] }],
        params: IdParam,
        response: { 200: ConsultationSchema, ...commonErrors },
      },
    },
    async (req) => consultations.getForViewer(req.user!, req.params.id),
  );

  r.post(
    '/consultations/:id/start',
    {
      preHandler: [app.authorize('consultation:update_clinical')],
      schema: {
        tags: ['consultations'],
        summary: 'Doctor starts the consultation (scheduled → in_progress)',
        security: [{ bearerAuth: [] }],
        params: IdParam,
        response: { 200: ConsultationSchema, ...commonErrors },
      },
    },
    async (req) => consultations.start(req.user!, req.params.id, reqMeta(req)),
  );

  r.post(
    '/consultations/:id/complete',
    {
      preHandler: [app.authorize('consultation:update_clinical')],
      schema: {
        tags: ['consultations'],
        summary: 'Doctor completes the consultation (in_progress → completed)',
        security: [{ bearerAuth: [] }],
        params: IdParam,
        response: { 200: ConsultationSchema, ...commonErrors },
      },
    },
    async (req) => consultations.complete(req.user!, req.params.id, reqMeta(req)),
  );

  r.put(
    '/consultations/:id/notes',
    {
      preHandler: [app.authorize('consultation:update_clinical')],
      schema: {
        tags: ['consultations'],
        summary: 'Doctor sets encrypted clinical notes',
        security: [{ bearerAuth: [] }],
        params: IdParam,
        body: NotesBody,
        response: { 204: { type: 'null' }, ...commonErrors },
      },
    },
    async (req, reply) => {
      await consultations.addNotes(req.user!, req.params.id, req.body.notes, reqMeta(req));
      return reply.status(204).send();
    },
  );

  r.post(
    '/consultations/:id/cancel',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['consultations'],
        summary: 'Cancel a consultation (patient or doctor); refunds + frees the slot',
        security: [{ bearerAuth: [] }],
        params: IdParam,
        body: CancelBody,
        response: { 200: ConsultationSchema, ...commonErrors },
      },
    },
    async (req) => consultations.cancel(req.user!, req.params.id, req.body.reason, reqMeta(req)),
  );

  r.post(
    '/consultations/:id/review',
    {
      preHandler: [app.authorize('consultation:read_own')],
      schema: {
        tags: ['consultations'],
        summary: 'Patient reviews a completed consultation (updates doctor rating)',
        security: [{ bearerAuth: [] }],
        params: IdParam,
        body: ReviewBody,
        response: { 204: { type: 'null' }, ...commonErrors },
      },
    },
    async (req, reply) => {
      await consultations.review(req.user!, req.params.id, req.body.rating, req.body.comment, reqMeta(req));
      return reply.status(204).send();
    },
  );
}
