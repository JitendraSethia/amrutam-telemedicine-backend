import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db } from '../db/pool.js';
import { cache } from '../cache/redis.js';
import { env } from '../config/env.js';
import { fingerprint, sha256Hex, stableStringify } from '../utils/hash.js';
import { AppError, IdempotencyConflictError } from '../utils/errors.js';
import { idempotencyHits } from '../observability/metrics.js';

/**
 * IDEMPOTENCY FOR WRITES (a hard requirement of this assignment).
 *
 * Any route that opts in (preHandler: [..., app.idempotent]) MUST carry an
 * `Idempotency-Key` header. The guarantee: retrying the same request (same key
 * + same body) executes the side effect AT MOST ONCE and returns the original
 * response byte-for-byte.
 *
 * Mechanism:
 *   1. fingerprint = sha256(userId | method | routePattern | key). Scoping by
 *      user+route stops keys colliding across clients/endpoints.
 *   2. Atomically CLAIM the fingerprint via INSERT ... ON CONFLICT DO NOTHING
 *      (Postgres = source of truth; Redis = fast replay cache).
 *   3. Winner runs the handler; the response is captured in onSend and stored.
 *   4. A retry sees status='completed' and REPLAYS the stored response.
 *   5. A concurrent retry (status='in_progress') gets 409 + Retry-After.
 *   6. Same key + DIFFERENT body ⇒ 409 IDEMPOTENCY_KEY_REUSE (client bug).
 *   7. If the handler 5xx'd (transient), the claim is RELEASED so a retry can
 *      genuinely re-attempt — we never cache a transient failure.
 */

interface IdemState {
  fingerprint: string;
  requestHash: string;
  owns: boolean;
}
const state = new WeakMap<FastifyRequest, IdemState>();

function redisKey(fp: string): string {
  return `idem:${fp}`;
}

interface StoredResponse {
  status: number;
  ct: string;
  body: string;
  requestHash: string;
}

async function replay(reply: FastifyReply, stored: StoredResponse, route: string): Promise<void> {
  idempotencyHits.inc({ route });
  reply
    .header('content-type', stored.ct)
    .header('idempotent-replayed', 'true')
    .status(stored.status)
    .send(stored.body);
}

export const idempotencyPlugin = fp(async function idempotencyPlugin(app: FastifyInstance) {
  app.decorate('idempotent', async function idempotent(req: FastifyRequest, reply: FastifyReply) {
    const key = req.headers['idempotency-key'];
    if (!key || typeof key !== 'string' || key.length < 8 || key.length > 200) {
      throw new AppError('A valid Idempotency-Key header is required for this operation', {
        statusCode: 400,
        code: 'IDEMPOTENCY_KEY_REQUIRED',
      });
    }

    const route = req.routeOptions?.url ?? req.url;
    const userId = req.user?.id;
    const fp = fingerprint([userId, req.method, route, key]);
    const requestHash = sha256Hex(stableStringify(req.body ?? {}));

    // Fast path: completed response cached in Redis.
    const cached = await cache.get<StoredResponse>(redisKey(fp));
    if (cached) {
      if (cached.requestHash !== requestHash) throw new IdempotencyConflictError();
      await replay(reply, cached, route);
      return reply;
    }

    // Durable atomic claim.
    const claim = await db.query<{ fingerprint: string }>(
      `INSERT INTO idempotency_keys
         (fingerprint, idem_key, user_id, method, path, request_hash, status, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,'in_progress', now() + ($7 || ' seconds')::interval)
       ON CONFLICT (fingerprint) DO NOTHING
       RETURNING fingerprint`,
      [fp, key, userId ?? null, req.method, route, requestHash, String(env.IDEMPOTENCY_TTL_SECONDS)],
    );

    if (claim.rowCount === 1) {
      // We own the claim — let the handler run; onSend will persist the result.
      state.set(req, { fingerprint: fp, requestHash, owns: true });
      return;
    }

    // Someone else already claimed this fingerprint.
    const existing = await db.query<{
      status: string;
      request_hash: string;
      response_status: number | null;
      response_body: StoredResponse | null;
    }>(
      `SELECT status, request_hash, response_status, response_body
         FROM idempotency_keys WHERE fingerprint = $1`,
      [fp],
    );
    const row = existing.rows[0];
    if (!row) {
      // Rare race: row vanished (expired) between our INSERT and SELECT — retry-claim once.
      throw new AppError('Idempotency conflict, please retry', {
        statusCode: 409,
        code: 'IDEMPOTENCY_RACE',
      });
    }
    if (row.request_hash !== requestHash) throw new IdempotencyConflictError();

    if (row.status === 'completed' && row.response_body) {
      await replay(reply, row.response_body, route);
      return reply;
    }

    // Still in progress elsewhere.
    reply.header('retry-after', '1');
    throw new AppError('A request with this Idempotency-Key is still being processed', {
      statusCode: 409,
      code: 'IDEMPOTENCY_IN_PROGRESS',
    });
  });

  // Persist the response for owners; release the claim on transient failure.
  app.addHook('onSend', async (req, reply, payload) => {
    const s = state.get(req);
    if (!s || !s.owns) return payload;

    const status = reply.statusCode;
    // 5xx = transient/unknown → release the claim so a retry can re-run.
    if (status >= 500) {
      await db.query('DELETE FROM idempotency_keys WHERE fingerprint = $1', [s.fingerprint]);
      return payload;
    }

    // Only string payloads are safely replayable (all our JSON routes qualify).
    if (typeof payload !== 'string') return payload;

    const stored: StoredResponse = {
      status,
      ct: (reply.getHeader('content-type') as string) ?? 'application/json; charset=utf-8',
      body: payload,
      requestHash: s.requestHash,
    };

    await db.query(
      `UPDATE idempotency_keys
         SET status = 'completed', response_status = $2, response_body = $3
       WHERE fingerprint = $1`,
      [s.fingerprint, status, JSON.stringify(stored)],
    );
    await cache.set(redisKey(s.fingerprint), stored, env.IDEMPOTENCY_TTL_SECONDS);
    return payload;
  });
});
