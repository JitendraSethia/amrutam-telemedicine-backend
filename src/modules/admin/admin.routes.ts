import type { FastifyInstance } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { commonErrors, IdParam } from '../../http/common-schema.js';
import {
  AuditPageResponse,
  AuditQuery,
  OverviewResponse,
  RangeQuery,
  TimeSeriesResponse,
  TopDoctorsQuery,
  TopDoctorsResponse,
} from './admin.schemas.js';

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<TypeBoxTypeProvider>();
  const { admin } = app.container;

  r.get(
    '/admin/analytics/overview',
    {
      preHandler: [app.authorize('admin:read_analytics')],
      schema: {
        tags: ['admin'],
        summary: 'KPI overview for a time window (cached)',
        security: [{ bearerAuth: [] }],
        querystring: RangeQuery,
        response: { 200: OverviewResponse, ...commonErrors },
      },
    },
    async (req) => admin.overview(req.query.from, req.query.to),
  );

  r.get(
    '/admin/analytics/consultations-per-day',
    {
      preHandler: [app.authorize('admin:read_analytics')],
      schema: {
        tags: ['admin'],
        summary: 'Consultations per day time series',
        security: [{ bearerAuth: [] }],
        querystring: RangeQuery,
        response: { 200: TimeSeriesResponse, ...commonErrors },
      },
    },
    async (req) => admin.consultationsPerDay(req.query.from, req.query.to),
  );

  r.get(
    '/admin/analytics/top-doctors',
    {
      preHandler: [app.authorize('admin:read_analytics')],
      schema: {
        tags: ['admin'],
        summary: 'Top doctors by completed consultations',
        security: [{ bearerAuth: [] }],
        querystring: TopDoctorsQuery,
        response: { 200: TopDoctorsResponse, ...commonErrors },
      },
    },
    async (req) => admin.topDoctors(req.query.limit ?? 10),
  );

  r.get(
    '/admin/audit-logs',
    {
      preHandler: [app.authorize('admin:read_audit')],
      schema: {
        tags: ['admin'],
        summary: 'Query the tamper-evident audit trail (keyset paginated)',
        security: [{ bearerAuth: [] }],
        querystring: AuditQuery,
        response: { 200: AuditPageResponse, ...commonErrors },
      },
    },
    async (req) => admin.queryAudit({ ...req.query, limit: req.query.limit ?? 50 }),
  );

  r.post(
    '/admin/doctors/:id/verify',
    {
      preHandler: [app.authorize('admin:manage_users')],
      schema: {
        tags: ['admin'],
        summary: 'Mark a doctor as verified',
        security: [{ bearerAuth: [] }],
        params: IdParam,
        response: { 204: { type: 'null' }, ...commonErrors },
      },
    },
    async (req, reply) => {
      await admin.verifyDoctor(req.user!.id, req.params.id);
      return reply.status(204).send();
    },
  );
}
