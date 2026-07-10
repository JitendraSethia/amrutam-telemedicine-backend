import type { FastifyInstance } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { commonErrors, IdParam } from '../../http/common-schema.js';
import {
  CreateDoctorProfileBody,
  DoctorPageResponse,
  DoctorProfileSchema,
  DoctorSearchQuery,
  UpdateDoctorProfileBody,
} from './doctors.schemas.js';

export async function doctorRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<TypeBoxTypeProvider>();
  const { doctors } = app.container;

  r.get(
    '/doctors',
    {
      schema: {
        tags: ['doctors'],
        summary: 'Search & filter doctors (cached, keyset-paginated)',
        querystring: DoctorSearchQuery,
        response: { 200: DoctorPageResponse, ...commonErrors },
      },
    },
    async (req) => doctors.search({ ...req.query, limit: req.query.limit ?? 20 }),
  );

  r.get(
    '/doctors/:id',
    {
      schema: {
        tags: ['doctors'],
        summary: 'Fetch a doctor profile (cache-aside)',
        params: IdParam,
        response: { 200: DoctorProfileSchema, ...commonErrors },
      },
    },
    async (req) => doctors.getById(req.params.id),
  );

  // ── Doctor self-service ────────────────────────────────────────────────────
  r.post(
    '/doctors/me/profile',
    {
      preHandler: [app.authorize('doctor:manage_availability')],
      schema: {
        tags: ['doctors'],
        summary: 'Create the calling doctor’s professional profile',
        security: [{ bearerAuth: [] }],
        body: CreateDoctorProfileBody,
        response: { 201: DoctorProfileSchema, ...commonErrors },
      },
    },
    async (req, reply) => {
      const created = await doctors.createMyProfile(req.user!.id, req.body);
      return reply.status(201).send(created);
    },
  );

  r.get(
    '/doctors/me/profile',
    {
      preHandler: [app.authorize('doctor:manage_availability')],
      schema: {
        tags: ['doctors'],
        summary: 'Fetch the calling doctor’s profile',
        security: [{ bearerAuth: [] }],
        response: { 200: DoctorProfileSchema, ...commonErrors },
      },
    },
    async (req) => doctors.getMyProfile(req.user!.id),
  );

  r.patch(
    '/doctors/me/profile',
    {
      preHandler: [app.authorize('doctor:manage_availability')],
      schema: {
        tags: ['doctors'],
        summary: 'Update the calling doctor’s profile',
        security: [{ bearerAuth: [] }],
        body: UpdateDoctorProfileBody,
        response: { 200: DoctorProfileSchema, ...commonErrors },
      },
    },
    async (req) => doctors.updateMyProfile(req.user!.id, req.body),
  );
}
