import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import type { AccessTokenClaims, RefreshTokenClaims } from '../../types/context.js';
import { UnauthorizedError } from '../../utils/errors.js';

/**
 * Stateless access tokens (short-lived, 15m) + opaque-ish refresh tokens
 * (long-lived, rotated). Access tokens are verified on every request without a
 * DB hit; refresh tokens are checked against the sessions table so they can be
 * revoked. Signed with separate secrets so an access-token leak can't mint
 * refresh tokens.
 */
export function signAccessToken(claims: AccessTokenClaims): string {
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_TTL,
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    algorithm: 'HS256',
  });
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET, {
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      algorithms: ['HS256'],
    }) as AccessTokenClaims;
  } catch {
    throw new UnauthorizedError('Invalid or expired access token', 'TOKEN_INVALID');
  }
}

export function signRefreshToken(claims: RefreshTokenClaims): string {
  return jwt.sign(claims, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_TTL,
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    algorithm: 'HS256',
  });
}

export function verifyRefreshToken(token: string): RefreshTokenClaims {
  try {
    return jwt.verify(token, env.JWT_REFRESH_SECRET, {
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      algorithms: ['HS256'],
    }) as RefreshTokenClaims;
  } catch {
    throw new UnauthorizedError('Invalid or expired refresh token', 'REFRESH_INVALID');
  }
}

/**
 * Short-lived token issued after step-1 login when MFA is enabled. It uses a
 * DISTINCT audience so it can never be replayed as an API access token.
 */
const MFA_AUDIENCE = `${env.JWT_AUDIENCE}.mfa`;

export function signMfaToken(userId: string): string {
  return jwt.sign({ sub: userId, typ: 'mfa' }, env.JWT_ACCESS_SECRET, {
    expiresIn: 300,
    issuer: env.JWT_ISSUER,
    audience: MFA_AUDIENCE,
    algorithm: 'HS256',
  });
}

export function verifyMfaToken(token: string): { sub: string } {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET, {
      issuer: env.JWT_ISSUER,
      audience: MFA_AUDIENCE,
      algorithms: ['HS256'],
    }) as { sub: string };
  } catch {
    throw new UnauthorizedError('Invalid or expired MFA token', 'MFA_TOKEN_INVALID');
  }
}
