import type { DbClient } from '../../db/pool.js';
import { db } from '../../db/pool.js';
import { decodeCursor, buildPage, type Page } from '../../utils/pagination.js';

export type ConsultationStatus =
  | 'pending_payment'
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'no_show';

export interface ConsultationRow {
  id: string;
  patient_id: string;
  doctor_id: string;
  slot_id: string;
  status: ConsultationStatus;
  mode: 'video' | 'audio' | 'chat';
  reason_enc: string | null;
  notes_enc: string | null;
  scheduled_start: string;
  scheduled_end: string;
  started_at: string | null;
  ended_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  fee_amount: string;
  currency: string;
  created_at: string;
}

export class ConsultationsRepository {
  async create(
    client: DbClient,
    input: {
      patientId: string;
      doctorId: string;
      slotId: string;
      mode: 'video' | 'audio' | 'chat';
      reasonEnc: string | null;
      scheduledStart: string;
      scheduledEnd: string;
      feeAmount: number;
      currency: string;
    },
  ): Promise<ConsultationRow> {
    const res = await client.query<ConsultationRow>(
      `INSERT INTO consultations
         (patient_id, doctor_id, slot_id, status, mode, reason_enc,
          scheduled_start, scheduled_end, fee_amount, currency)
       VALUES ($1,$2,$3,'pending_payment',$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        input.patientId,
        input.doctorId,
        input.slotId,
        input.mode,
        input.reasonEnc,
        input.scheduledStart,
        input.scheduledEnd,
        input.feeAmount,
        input.currency,
      ],
    );
    return res.rows[0];
  }

  async findById(id: string): Promise<ConsultationRow | null> {
    const res = await db.query<ConsultationRow>(`SELECT * FROM consultations WHERE id = $1`, [id]);
    return res.rows[0] ?? null;
  }

  async updateStatus(
    id: string,
    status: ConsultationStatus,
    extra: Partial<{
      startedAt: string;
      endedAt: string;
      cancelledAt: string;
      cancellationReason: string;
    }> = {},
    client?: DbClient,
  ): Promise<void> {
    const runner = client ?? db;
    await runner.query(
      `UPDATE consultations
          SET status = $2,
              started_at = COALESCE($3, started_at),
              ended_at = COALESCE($4, ended_at),
              cancelled_at = COALESCE($5, cancelled_at),
              cancellation_reason = COALESCE($6, cancellation_reason)
        WHERE id = $1`,
      [
        id,
        status,
        extra.startedAt ?? null,
        extra.endedAt ?? null,
        extra.cancelledAt ?? null,
        extra.cancellationReason ?? null,
      ],
    );
  }

  async setNotes(id: string, notesEnc: string): Promise<void> {
    await db.query(`UPDATE consultations SET notes_enc = $2 WHERE id = $1`, [id, notesEnc]);
  }

  async listForParty(
    party: 'patient' | 'doctor',
    id: string,
    filters: { status?: ConsultationStatus; limit: number; cursor?: string },
  ): Promise<Page<ConsultationRow>> {
    const col = party === 'patient' ? 'patient_id' : 'doctor_id';
    const params: unknown[] = [id];
    const where = [`${col} = $1`];
    if (filters.status) {
      params.push(filters.status);
      where.push(`status = $${params.length}`);
    }
    const cur = decodeCursor<{ start: string; id: string }>(filters.cursor);
    if (cur) {
      params.push(cur.start, cur.id);
      where.push(`(scheduled_start, id) < ($${params.length - 1}, $${params.length})`);
    }
    params.push(filters.limit + 1);
    const res = await db.read<ConsultationRow>(
      `SELECT * FROM consultations
        WHERE ${where.join(' AND ')}
        ORDER BY scheduled_start DESC, id DESC
        LIMIT $${params.length}`,
      params,
    );
    return buildPage(res.rows, filters.limit, (r) => ({ start: r.scheduled_start, id: r.id }));
  }

  /** Find scheduled consultations whose slot has passed (for no-show sweep). */
  async findOverdueScheduled(graceMinutes: number, limit = 200): Promise<ConsultationRow[]> {
    const res = await db.query<ConsultationRow>(
      `SELECT * FROM consultations
        WHERE status = 'scheduled'
          AND scheduled_end < now() - ($1 || ' minutes')::interval
        ORDER BY scheduled_end ASC
        LIMIT $2`,
      [String(graceMinutes), limit],
    );
    return res.rows;
  }
}
