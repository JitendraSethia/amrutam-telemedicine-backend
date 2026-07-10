import type { FastifyInstance } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { reqMeta } from '../../http/request-meta.js';
import { commonErrors } from '../../http/common-schema.js';
import {
  LoginBody,
  LoginResponse,
  MeResponse,
  MfaCompleteBody,
  MfaEnableBody,
  MfaSetupResponse,
  RefreshBody,
  RegisterBody,
  RegisterResponse,
  TokenPairResponse,
} from './auth.schemas.js';

/**
 * Auth routes. Login/refresh are deliberately under a tighter rate limit
 * (configured per-route) to blunt credential-stuffing.
 */
export async function authRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<TypeBoxTypeProvider>();
  const { auth } = app.container;

  const strictLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

  r.post(
    '/register',
    {
      config: strictLimit,
      schema: {
        tags: ['auth'],
        summary: 'Register a new patient (or self-serve doctor, pending verification)',
        body: RegisterBody,
        response: { 201: RegisterResponse, ...commonErrors },
      },
    },
    async (req, reply) => {
      const result = await auth.register(req.body, reqMeta(req));
      return reply.status(201).send(result);
    },
  );

  r.post(
    '/login',
    {
      config: strictLimit,
      schema: {
        tags: ['auth'],
        summary: 'Password login (step 1). Returns tokens, or an MFA challenge.',
        body: LoginBody,
        response: { 200: LoginResponse, ...commonErrors },
      },
    },
    async (req) => auth.login(req.body, reqMeta(req)),
  );

  r.post(
    '/mfa/complete',
    {
      config: strictLimit,
      schema: {
        tags: ['auth'],
        summary: 'Complete MFA challenge (step 2) and receive tokens',
        body: MfaCompleteBody,
        response: { 200: TokenPairResponse, ...commonErrors },
      },
    },
    async (req) => auth.completeMfa(req.body, reqMeta(req)),
  );

  r.post(
    '/refresh',
    {
      config: strictLimit,
      schema: {
        tags: ['auth'],
        summary: 'Exchange a refresh token for a new token pair (rotating)',
        body: RefreshBody,
        response: { 200: TokenPairResponse, ...commonErrors },
      },
    },
    async (req) => auth.refresh(req.body, reqMeta(req)),
  );

  r.post(
    '/logout',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['auth'],
        summary: 'Revoke the current session',
        security: [{ bearerAuth: [] }],
        response: { 204: { type: 'null' }, ...commonErrors },
      },
    },
    async (req, reply) => {
      await auth.logout(req.user!.sessionId);
      return reply.status(204).send();
    },
  );

  r.post(
    '/logout-all',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['auth'],
        summary: 'Revoke all sessions for the current user',
        security: [{ bearerAuth: [] }],
        response: { 204: { type: 'null' }, ...commonErrors },
      },
    },
    async (req, reply) => {
      await auth.logoutAll(req.user!.id);
      return reply.status(204).send();
    },
  );

  r.post(
    '/mfa/setup',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['auth'],
        summary: 'Begin TOTP MFA enrolment; returns provisioning URI + QR',
        security: [{ bearerAuth: [] }],
        response: { 200: MfaSetupResponse, ...commonErrors },
      },
    },
    async (req) => auth.setupMfa(req.user!.id),
  );

  r.post(
    '/mfa/enable',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['auth'],
        summary: 'Confirm a TOTP code to enable MFA (revokes other sessions)',
        security: [{ bearerAuth: [] }],
        body: MfaEnableBody,
        response: { 204: { type: 'null' }, ...commonErrors },
      },
    },
    async (req, reply) => {
      await auth.enableMfa(req.user!.id, req.body.code, reqMeta(req));
      return reply.status(204).send();
    },
  );

  r.get(
    '/me',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['auth'],
        summary: 'Current authenticated user',
        security: [{ bearerAuth: [] }],
        response: { 200: MeResponse, ...commonErrors },
      },
    },
    async (req) => auth.getMe(req.user!.id),
  );
}
