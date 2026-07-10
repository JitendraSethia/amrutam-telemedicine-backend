import type { DbClient } from '../../db/pool.js';
import { db } from '../../db/pool.js';
import type { Role } from '../../types/roles.js';

export interface UserRow {
  id: string;
  email_enc: string;
  email_bidx: string;
  phone_enc: string | null;
  password_hash: string;
  role: Role;
  status: 'active' | 'suspended' | 'deleted';
  email_verified: boolean;
  mfa_enabled: boolean;
  mfa_secret_enc: string | null;
  failed_logins: number;
  locked_until: string | null;
  created_at: string;
}

export interface SessionRow {
  id: string;
  user_id: string;
  family_id: string;
  refresh_token_hash: string;
  expires_at: string;
  revoked_at: string | null;
  replaced_by: string | null;
}

export class AuthRepository {
  async createUser(
    input: {
      emailEnc: string;
      emailBidx: string;
      phoneEnc: string | null;
      phoneBidx: string | null;
      passwordHash: string;
      role: Role;
    },
    client?: DbClient,
  ): Promise<{ id: string }> {
    const runner = client ?? db;
    const res = await runner.query<{ id: string }>(
      `INSERT INTO users (email_enc, email_bidx, phone_enc, phone_bidx, password_hash, role)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id`,
      [
        input.emailEnc,
        input.emailBidx,
        input.phoneEnc,
        input.phoneBidx,
        input.passwordHash,
        input.role,
      ],
    );
    return res.rows[0];
  }

  async findByEmailBidx(emailBidx: string): Promise<UserRow | null> {
    const res = await db.query<UserRow>(`SELECT * FROM users WHERE email_bidx = $1`, [emailBidx]);
    return res.rows[0] ?? null;
  }

  async findById(id: string): Promise<UserRow | null> {
    const res = await db.query<UserRow>(`SELECT * FROM users WHERE id = $1`, [id]);
    return res.rows[0] ?? null;
  }

  async recordLoginResult(userId: string, success: boolean, lockThreshold = 5): Promise<void> {
    if (success) {
      await db.query(
        `UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1`,
        [userId],
      );
      return;
    }
    // Exponential lockout: lock 5 min once failures cross the threshold.
    await db.query(
      `UPDATE users
         SET failed_logins = failed_logins + 1,
             locked_until = CASE WHEN failed_logins + 1 >= $2
                                 THEN now() + interval '5 minutes' ELSE locked_until END
       WHERE id = $1`,
      [userId, lockThreshold],
    );
  }

  async setMfaSecret(userId: string, secretEnc: string): Promise<void> {
    await db.query(`UPDATE users SET mfa_secret_enc = $2, mfa_enabled = false WHERE id = $1`, [
      userId,
      secretEnc,
    ]);
  }

  async enableMfa(userId: string): Promise<void> {
    await db.query(`UPDATE users SET mfa_enabled = true WHERE id = $1`, [userId]);
  }

  // ── Sessions / refresh-token rotation ──────────────────────────────────────
  async createSession(
    input: {
      userId: string;
      familyId: string;
      refreshTokenHash: string;
      expiresAt: Date;
      userAgent?: string;
      ip?: string;
    },
    client?: DbClient,
  ): Promise<{ id: string }> {
    const runner = client ?? db;
    const res = await runner.query<{ id: string }>(
      `INSERT INTO sessions (user_id, family_id, refresh_token_hash, expires_at, user_agent, ip)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [
        input.userId,
        input.familyId,
        input.refreshTokenHash,
        input.expiresAt.toISOString(),
        input.userAgent ?? null,
        input.ip ?? null,
      ],
    );
    return res.rows[0];
  }

  async findSessionByHash(hash: string): Promise<SessionRow | null> {
    const res = await db.query<SessionRow>(
      `SELECT * FROM sessions WHERE refresh_token_hash = $1`,
      [hash],
    );
    return res.rows[0] ?? null;
  }

  async rotateSession(
    oldId: string,
    input: { userId: string; familyId: string; refreshTokenHash: string; expiresAt: Date },
  ): Promise<{ id: string }> {
    return db.tx(async (client) => {
      const created = await this.createSession(
        {
          userId: input.userId,
          familyId: input.familyId,
          refreshTokenHash: input.refreshTokenHash,
          expiresAt: input.expiresAt,
        },
        client,
      );
      await client.query(
        `UPDATE sessions SET revoked_at = now(), replaced_by = $2 WHERE id = $1`,
        [oldId, created.id],
      );
      return created;
    });
  }

  async revokeSession(sessionId: string): Promise<void> {
    await db.query(`UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`, [
      sessionId,
    ]);
  }

  async revokeFamily(familyId: string): Promise<void> {
    await db.query(
      `UPDATE sessions SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`,
      [familyId],
    );
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await db.query(
      `UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
  }
}
