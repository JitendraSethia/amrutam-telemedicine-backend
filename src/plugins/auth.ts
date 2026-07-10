import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyAccessToken } from '../modules/auth/tokens.js';
import { ForbiddenError, UnauthorizedError } from '../utils/errors.js';
import { roleHasPermission, type Permission } from '../types/roles.js';
import type { AuthenticatedUser } from '../types/context.js';

/**
 * Authentication + authorization decorators.
 *   - `authenticate` verifies the bearer access token and attaches req.user.
 *   - `authorize(permission)` runs authenticate, then checks RBAC.
 *   - `requireMfa` additionally asserts the session cleared an MFA challenge.
 * Authorization is centralised here so the permission model is auditable and
 * routes stay declarative (see fastify.d.ts).
 */
function extractBearer(req: FastifyRequest): string {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing bearer token');
  }
  return header.slice('Bearer '.length).trim();
}

export const authPlugin = fp(async function authPlugin(app: FastifyInstance) {
  app.decorateRequest('user', undefined);

  app.decorate('authenticate', async function authenticate(req: FastifyRequest) {
    const token = extractBearer(req);
    const claims = verifyAccessToken(token);
    const user: AuthenticatedUser = {
      id: claims.sub,
      role: claims.role,
      email: claims.email,
      mfaVerified: claims.mfa,
      doctorId: claims.did,
      sessionId: claims.sid,
    };
    req.user = user;
  });

  app.decorate('authorize', function authorize(permission: Permission) {
    return async function authorizeHandler(req: FastifyRequest, reply: FastifyReply) {
      await app.authenticate(req, reply);
      const user = req.user!;
      if (!roleHasPermission(user.role, permission)) {
        throw new ForbiddenError('Missing required permission', { permission });
      }
    };
  });

  app.decorate('requireMfa', async function requireMfa(req: FastifyRequest, reply: FastifyReply) {
    await app.authenticate(req, reply);
    if (!req.user!.mfaVerified) {
      throw new UnauthorizedError('MFA verification required', 'MFA_REQUIRED');
    }
  });
});
