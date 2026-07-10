import argon2 from 'argon2';
import { authenticator } from 'otplib';
import qrcode from 'qrcode';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../db/pool.js';
import { env } from '../../config/env.js';
import {
  blindIndex,
  decryptField,
  encryptField,
  randomToken,
  safeEqual,
} from '../../utils/crypto.js';
import { sha256Hex } from '../../utils/hash.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  signMfaToken,
  verifyMfaToken,
} from './tokens.js';
import { AuthRepository, type UserRow } from './auth.repository.js';
import { AuditService } from '../audit/audit.service.js';
import {
  ConflictError,
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
} from '../../utils/errors.js';
import type { Role } from '../../types/roles.js';

export interface RequestMeta {
  userAgent?: string;
  ip?: string;
  requestId?: string;
}

export interface TokenPair {
  tokenType: 'Bearer';
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export type LoginResult =
  | ({ mfaRequired: false } & TokenPair)
  | { mfaRequired: true; mfaToken: string };

// A fixed dummy hash so failed lookups still cost an argon2 verify (defeats
// user-enumeration via response timing).
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHRzb21lc2FsdA$RdescudvJCsgt3ub+b+dWRWJTmaEM6Ti';

export class AuthService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly audit: AuditService,
  ) {}

  private async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 4 });
  }

  async register(
    input: { email: string; password: string; phone?: string; role?: Role },
    meta: RequestMeta,
  ): Promise<{ id: string }> {
    // Public registration is limited to patients; doctors/admins are onboarded
    // by an admin (privilege escalation guard).
    const role: Role = input.role === 'doctor' ? 'doctor' : 'patient';
    const emailBidx = blindIndex(input.email, { lowercase: true });

    const existing = await this.repo.findByEmailBidx(emailBidx);
    if (existing) throw new ConflictError('An account with this email already exists', 'EMAIL_TAKEN');

    const passwordHash = await this.hashPassword(input.password);
    const created = await this.repo.createUser({
      emailEnc: encryptField(input.email)!,
      emailBidx,
      phoneEnc: input.phone ? encryptField(input.phone) : null,
      phoneBidx: input.phone ? blindIndex(input.phone) : null,
      passwordHash,
      role,
    });

    await this.audit.record({
      actorUserId: created.id,
      actorRole: role,
      action: 'user.registered',
      resourceType: 'user',
      resourceId: created.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
      requestId: meta.requestId,
      metadata: { role },
    });
    return created;
  }

  async login(input: { email: string; password: string }, meta: RequestMeta): Promise<LoginResult> {
    const emailBidx = blindIndex(input.email, { lowercase: true });
    const user = await this.repo.findByEmailBidx(emailBidx);

    if (!user) {
      await argon2.verify(DUMMY_HASH, input.password).catch(() => false);
      throw new UnauthorizedError('Invalid credentials', 'INVALID_CREDENTIALS');
    }
    if (user.status !== 'active') {
      throw new ForbiddenError('Account is not active');
    }
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      throw new UnauthorizedError('Account temporarily locked, try again later', 'ACCOUNT_LOCKED');
    }

    const ok = await argon2.verify(user.password_hash, input.password).catch(() => false);
    if (!ok) {
      await this.repo.recordLoginResult(user.id, false);
      await this.audit.record({
        actorUserId: user.id,
        actorRole: user.role,
        action: 'user.login_failed',
        resourceType: 'user',
        resourceId: user.id,
        outcome: 'failure',
        ip: meta.ip,
        userAgent: meta.userAgent,
        requestId: meta.requestId,
      });
      throw new UnauthorizedError('Invalid credentials', 'INVALID_CREDENTIALS');
    }

    await this.repo.recordLoginResult(user.id, true);

    if (user.mfa_enabled) {
      return { mfaRequired: true, mfaToken: signMfaToken(user.id) };
    }
    const tokens = await this.issueTokens(user, meta, /* mfaSatisfied */ true);
    return { mfaRequired: false, ...tokens };
  }

  async completeMfa(input: { mfaToken: string; code: string }, meta: RequestMeta): Promise<TokenPair> {
    const { sub } = verifyMfaToken(input.mfaToken);
    const user = await this.repo.findById(sub);
    if (!user || !user.mfa_enabled || !user.mfa_secret_enc) {
      throw new UnauthorizedError('MFA not configured', 'MFA_NOT_CONFIGURED');
    }
    const secret = decryptField(user.mfa_secret_enc)!;
    if (!authenticator.verify({ token: input.code, secret })) {
      await this.audit.record({
        actorUserId: user.id,
        actorRole: user.role,
        action: 'user.mfa_failed',
        resourceType: 'user',
        resourceId: user.id,
        outcome: 'failure',
        ip: meta.ip,
        requestId: meta.requestId,
      });
      throw new UnauthorizedError('Invalid MFA code', 'MFA_INVALID');
    }
    return this.issueTokens(user, meta, /* mfaSatisfied */ true);
  }

  private async issueTokens(user: UserRow, meta: RequestMeta, mfaSatisfied: boolean): Promise<TokenPair> {
    const familyId = uuidv4();
    const refreshToken = randomToken(48);
    const refreshTokenHash = sha256Hex(refreshToken);
    const expiresAt = new Date(Date.now() + env.JWT_REFRESH_TTL * 1000);

    const session = await this.repo.createSession({
      userId: user.id,
      familyId,
      refreshTokenHash,
      expiresAt,
      userAgent: meta.userAgent,
      ip: meta.ip,
    });

    const doctorId = user.role === 'doctor' ? await this.lookupDoctorId(user.id) : undefined;
    const email = decryptField(user.email_enc)!;
    const accessToken = signAccessToken({
      sub: user.id,
      role: user.role,
      email,
      mfa: mfaSatisfied || !user.mfa_enabled,
      did: doctorId,
      sid: session.id,
    });
    // We embed the session id in the refresh JWT so rotation can find the row,
    // but the RAW token (not the JWT) is what we hash — see refresh().
    const refreshJwt = signRefreshToken({ sub: user.id, sid: session.id, fam: familyId });
    // Bundle: opaque refresh material is `${refreshJwt}.${refreshToken}` so we
    // both carry claims and keep a high-entropy secret hashed at rest.
    return {
      tokenType: 'Bearer',
      accessToken,
      refreshToken: `${refreshJwt}.${refreshToken}`,
      expiresIn: env.JWT_ACCESS_TTL,
    };
  }

  async refresh(input: { refreshToken: string }, meta: RequestMeta): Promise<TokenPair> {
    const sep = input.refreshToken.lastIndexOf('.');
    if (sep === -1) throw new UnauthorizedError('Malformed refresh token', 'REFRESH_INVALID');
    const jwtPart = input.refreshToken.slice(0, sep);
    const secretPart = input.refreshToken.slice(sep + 1);

    const claims = verifyRefreshToken(jwtPart);
    const hash = sha256Hex(secretPart);
    const session = await this.repo.findSessionByHash(hash);

    // Reuse detection: a valid JWT whose session row is missing/rotated/revoked
    // means the token was replayed → nuke the whole family (token theft).
    if (!session || session.revoked_at || session.replaced_by) {
      await this.repo.revokeFamily(claims.fam);
      await this.audit.record({
        actorUserId: claims.sub,
        action: 'user.refresh_reuse_detected',
        resourceType: 'session',
        resourceId: claims.sid,
        outcome: 'failure',
        ip: meta.ip,
        requestId: meta.requestId,
      });
      throw new UnauthorizedError('Refresh token reuse detected; session revoked', 'REFRESH_REUSE');
    }
    if (new Date(session.expires_at) < new Date()) {
      throw new UnauthorizedError('Refresh token expired', 'REFRESH_EXPIRED');
    }

    const user = await this.repo.findById(claims.sub);
    if (!user || user.status !== 'active') {
      throw new UnauthorizedError('Account not active', 'ACCOUNT_INACTIVE');
    }

    const newRefreshSecret = randomToken(48);
    const newExpiresAt = new Date(Date.now() + env.JWT_REFRESH_TTL * 1000);
    const rotated = await this.repo.rotateSession(session.id, {
      userId: user.id,
      familyId: session.family_id,
      refreshTokenHash: sha256Hex(newRefreshSecret),
      expiresAt: newExpiresAt,
    });

    const doctorId = user.role === 'doctor' ? await this.lookupDoctorId(user.id) : undefined;
    const accessToken = signAccessToken({
      sub: user.id,
      role: user.role,
      email: decryptField(user.email_enc)!,
      mfa: !user.mfa_enabled ? true : true, // refresh preserves the elevated state
      did: doctorId,
      sid: rotated.id,
    });
    const refreshJwt = signRefreshToken({ sub: user.id, sid: rotated.id, fam: session.family_id });
    return {
      tokenType: 'Bearer',
      accessToken,
      refreshToken: `${refreshJwt}.${newRefreshSecret}`,
      expiresIn: env.JWT_ACCESS_TTL,
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.repo.revokeSession(sessionId);
  }

  async logoutAll(userId: string): Promise<void> {
    await this.repo.revokeAllForUser(userId);
  }

  // ── MFA enrolment ──────────────────────────────────────────────────────────
  async setupMfa(userId: string): Promise<{ otpauthUrl: string; qrDataUrl: string }> {
    const user = await this.repo.findById(userId);
    if (!user) throw new UnauthorizedError();
    const secret = authenticator.generateSecret();
    await this.repo.setMfaSecret(userId, encryptField(secret)!);
    const email = decryptField(user.email_enc)!;
    const otpauthUrl = authenticator.keyuri(email, env.MFA_ISSUER, secret);
    const qrDataUrl = await qrcode.toDataURL(otpauthUrl);
    return { otpauthUrl, qrDataUrl };
  }

  async enableMfa(userId: string, code: string, meta: RequestMeta): Promise<void> {
    const user = await this.repo.findById(userId);
    if (!user || !user.mfa_secret_enc) {
      throw new ValidationError('Start MFA setup first');
    }
    const secret = decryptField(user.mfa_secret_enc)!;
    if (!authenticator.verify({ token: code, secret })) {
      throw new UnauthorizedError('Invalid MFA code', 'MFA_INVALID');
    }
    await this.repo.enableMfa(userId);
    // Enabling MFA invalidates other sessions to force re-auth with MFA.
    await this.repo.revokeAllForUser(userId);
    await this.audit.record({
      actorUserId: userId,
      actorRole: user.role,
      action: 'user.mfa_enabled',
      resourceType: 'user',
      resourceId: userId,
      ip: meta.ip,
      requestId: meta.requestId,
    });
  }

  async getMe(userId: string): Promise<{
    id: string;
    email: string;
    role: Role;
    mfaEnabled: boolean;
    emailVerified: boolean;
  }> {
    const user = await this.repo.findById(userId);
    if (!user) throw new UnauthorizedError();
    return {
      id: user.id,
      email: decryptField(user.email_enc)!,
      role: user.role,
      mfaEnabled: user.mfa_enabled,
      emailVerified: user.email_verified,
    };
  }

  private async lookupDoctorId(userId: string): Promise<string | undefined> {
    const res = await db.query<{ id: string }>(`SELECT id FROM doctors WHERE user_id = $1`, [userId]);
    return res.rows[0]?.id;
  }

  /** Exposed for tests / constant-time helpers. */
  static tokensMatch(a: string, b: string): boolean {
    return safeEqual(a, b);
  }
}
