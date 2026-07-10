import type { Role } from './roles.js';

/** The authenticated principal attached to each request by the auth plugin. */
export interface AuthenticatedUser {
  id: string;
  role: Role;
  email: string;
  /** Present when the access token was minted after an MFA challenge. */
  mfaVerified: boolean;
  /** Doctor profile id, only for role === 'doctor'. */
  doctorId?: string;
  sessionId: string;
}

/** JWT payload for access tokens. */
export interface AccessTokenClaims {
  sub: string;
  role: Role;
  email: string;
  mfa: boolean;
  did?: string; // doctor id
  sid: string; // session id
}

/** JWT payload for refresh tokens. */
export interface RefreshTokenClaims {
  sub: string;
  sid: string;
  /** Rotating token family id for refresh-token reuse detection. */
  fam: string;
}
