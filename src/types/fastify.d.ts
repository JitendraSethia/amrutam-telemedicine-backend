import type { AuthenticatedUser } from './context.js';
import type { Permission } from './roles.js';
import type { Container } from '../container.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Dependency-injection container: all services/repositories. */
    container: Container;
    /** preHandler that requires a valid access token. */
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** preHandler factory that requires a permission (implies authenticate). */
    authorize: (
      permission: Permission,
    ) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** preHandler that additionally requires the session to have passed MFA. */
    requireMfa: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** preHandler enforcing idempotency (requires an Idempotency-Key header). */
    idempotent: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  }

  interface FastifyRequest {
    /** Authenticated principal, present after the `authenticate` preHandler. */
    user?: AuthenticatedUser;
    /** Raw request body string, captured for webhook signature verification. */
    rawBody?: string;
  }
}

export {};
