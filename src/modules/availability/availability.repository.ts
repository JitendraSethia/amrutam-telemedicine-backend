import type { DbClient } from '../../db/pool.js';
import { db } from '../../db/pool.js';

export interface SlotRow {
  id: string;
  doctor_id: string;
  start_ts: string;
  end_ts: string;
  status: 'available' | 'held' | 'booked' | 'blocked';
  version: number;
  held_by: string | null;
  hold_expires_at: string | null;
}

export interface PublicSlot {
  id: string;
  doctorId: string;
  startTs: string;
  endTs: string;
  status: SlotRow['status'];
}

function toPublic(r: SlotRow): PublicSlot {
  return {
    id: r.id,
    doctorId: r.doctor_id,
    startTs: r.start_ts,
    endTs: r.end_ts,
    status: r.status,
  };
}

export class AvailabilityRepository {
  /** Bulk-insert generated slots; duplicates (same doctor+start) are ignored. */
  async bulkInsert(doctorId: string, slots: { start: string; end: string }[]): Promise<number> {
    if (!slots.length) return 0;
    const values: string[] = [];
    const params: unknown[] = [doctorId];
    slots.forEach((s) => {
      params.push(s.start, s.end);
      values.push(`($1, $${params.length - 1}, $${params.length})`);
    });
    const res = await db.query(
      `INSERT INTO availability_slots (doctor_id, start_ts, end_ts)
       VALUES ${values.join(', ')}
       ON CONFLICT (doctor_id, start_ts) DO NOTHING`,
      params,
    );
    return res.rowCount ?? 0;
  }

  async listAvailable(
    doctorId: string,
    from: string,
    to: string,
    limit: number,
  ): Promise<PublicSlot[]> {
    const res = await db.read<SlotRow>(
      `SELECT * FROM availability_slots
        WHERE doctor_id = $1 AND status = 'available'
          AND start_ts >= $2 AND start_ts < $3
        ORDER BY start_ts ASC
        LIMIT $4`,
      [doctorId, from, to, limit],
    );
    return res.rows.map(toPublic);
  }

  async findById(id: string): Promise<SlotRow | null> {
    const res = await db.query<SlotRow>(`SELECT * FROM availability_slots WHERE id = $1`, [id]);
    return res.rows[0] ?? null;
  }

  /**
   * Take a ROW-LEVEL LOCK on a slot inside the caller's transaction. This is
   * the linchpin of double-booking prevention: concurrent bookers serialise
   * here, and only the first sees status='available'. `FOR UPDATE` blocks other
   * writers until the transaction commits/rolls back.
   */
  async lockSlot(client: DbClient, slotId: string): Promise<SlotRow | null> {
    const res = await client.query<SlotRow>(
      `SELECT * FROM availability_slots WHERE id = $1 FOR UPDATE`,
      [slotId],
    );
    return res.rows[0] ?? null;
  }

  async setStatus(
    client: DbClient,
    slotId: string,
    status: SlotRow['status'],
    opts: { heldBy?: string | null; holdExpiresAt?: string | null } = {},
  ): Promise<void> {
    await client.query(
      `UPDATE availability_slots
          SET status = $2, version = version + 1,
              held_by = $3, hold_expires_at = $4
        WHERE id = $1`,
      [slotId, status, opts.heldBy ?? null, opts.holdExpiresAt ?? null],
    );
  }

  /** Reaper: free slots whose hold expired without a completed payment. */
  async releaseExpiredHolds(limit = 500): Promise<number> {
    const res = await db.query(
      `UPDATE availability_slots
          SET status = 'available', held_by = NULL, hold_expires_at = NULL,
              version = version + 1
        WHERE id IN (
          SELECT id FROM availability_slots
           WHERE status = 'held' AND hold_expires_at < now()
           ORDER BY hold_expires_at ASC
           LIMIT $1
           FOR UPDATE SKIP LOCKED
        )`,
      [limit],
    );
    return res.rowCount ?? 0;
  }
}
