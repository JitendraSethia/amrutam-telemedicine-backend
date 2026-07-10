import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { db } from '../../src/db/pool.js';
import { redis } from '../../src/cache/redis.js';
import { encryptField, blindIndex } from '../../src/utils/crypto.js';

/**
 * Integration coverage for the two hard requirements: no double-booking under
 * concurrency, and idempotent writes. Requires Postgres + Redis with migrations
 * applied. Enable with RUN_DB_TESTS=1 (CI provides the services + runs
 * `npm run migrate:up` first).
 */
const RUN = process.env.RUN_DB_TESTS === '1';

async function makeBookableSlot(startOffsetMs: number): Promise<{ slotId: string; doctorId: string }> {
  const email = `doc_${Math.random().toString(36).slice(2)}@t.com`;
  const u = await db.query<{ id: string }>(
    `INSERT INTO users (email_enc, email_bidx, password_hash, role, email_verified)
     VALUES ($1,$2,'x','doctor',true) RETURNING id`,
    [encryptField(email), blindIndex(email, { lowercase: true })],
  );
  const d = await db.query<{ id: string }>(
    `INSERT INTO doctors (user_id, display_name, consultation_fee, currency, is_accepting, is_verified)
     VALUES ($1,'Dr Test',500,'INR',true,true) RETURNING id`,
    [u.rows[0].id],
  );
  const start = new Date(Date.now() + startOffsetMs).toISOString();
  const end = new Date(Date.now() + startOffsetMs + 30 * 60_000).toISOString();
  const s = await db.query<{ id: string }>(
    `INSERT INTO availability_slots (doctor_id, start_ts, end_ts, status)
     VALUES ($1,$2,$3,'available') RETURNING id`,
    [d.rows[0].id, start, end],
  );
  return { slotId: s.rows[0].id, doctorId: d.rows[0].id };
}

describe.skipIf(!RUN)('booking flow (integration)', () => {
  let app: FastifyInstance;
  let patientToken: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const email = `pat_${Math.random().toString(36).slice(2)}@t.com`;
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email, password: 'Patient@12345' },
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password: 'Patient@12345' },
    });
    patientToken = login.json().accessToken;
    expect(patientToken).toBeTruthy();
  });

  afterAll(async () => {
    await app.close();
    await redis.quit();
    await db.close();
  });

  it('allows exactly one booking when many race for the same slot', async () => {
    const { slotId } = await makeBookableSlot(3600_000);

    const attempts = Array.from({ length: 6 }, (_, i) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/bookings',
        headers: {
          authorization: `Bearer ${patientToken}`,
          'idempotency-key': `race-${slotId}-${i}`,
        },
        payload: { slotId, mode: 'video' },
      }),
    );
    const results = await Promise.all(attempts);
    const statuses = results.map((r) => r.statusCode);
    const created = statuses.filter((s) => s === 201);
    const conflicts = statuses.filter((s) => s === 409);

    expect(created).toHaveLength(1);
    expect(conflicts.length).toBe(5);

    const active = await db.query(
      `SELECT count(*)::int AS n FROM consultations
        WHERE slot_id = $1 AND status IN ('pending_payment','scheduled','in_progress')`,
      [slotId],
    );
    expect(active.rows[0].n).toBe(1);
  });

  it('is idempotent: same key returns the same response and books once', async () => {
    const { slotId } = await makeBookableSlot(7200_000);
    const key = `idem-${slotId}`;
    const headers = { authorization: `Bearer ${patientToken}`, 'idempotency-key': key };
    const payload = { slotId, mode: 'video' as const };

    const first = await app.inject({ method: 'POST', url: '/api/v1/bookings', headers, payload });
    const second = await app.inject({ method: 'POST', url: '/api/v1/bookings', headers, payload });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(first.json().id).toBe(second.json().id);

    const count = await db.query(`SELECT count(*)::int AS n FROM consultations WHERE slot_id = $1`, [
      slotId,
    ]);
    expect(count.rows[0].n).toBe(1);
  });

  it('rejects reusing an idempotency key with a different body', async () => {
    const a = await makeBookableSlot(10800_000);
    const b = await makeBookableSlot(14400_000);
    const key = `reuse-${a.slotId}`;
    const headers = { authorization: `Bearer ${patientToken}`, 'idempotency-key': key };

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/bookings',
      headers,
      payload: { slotId: a.slotId, mode: 'video' },
    });
    const reused = await app.inject({
      method: 'POST',
      url: '/api/v1/bookings',
      headers,
      payload: { slotId: b.slotId, mode: 'video' },
    });

    expect(first.statusCode).toBe(201);
    expect(reused.statusCode).toBe(409);
    expect(reused.json().error.code).toBe('IDEMPOTENCY_KEY_REUSE');
  });
});
