import { db } from '../../db/pool.js';
import { decodeCursor, buildPage, type Page } from '../../utils/pagination.js';

export interface PrescriptionRow {
  id: string;
  consultation_id: string;
  doctor_id: string;
  patient_id: string;
  content_enc: string;
  supersedes_id: string | null;
  issued_at: string;
  pdf_object_key: string | null;
}

export class PrescriptionsRepository {
  async create(input: {
    consultationId: string;
    doctorId: string;
    patientId: string;
    contentEnc: string;
    supersedesId?: string;
  }): Promise<PrescriptionRow> {
    const res = await db.query<PrescriptionRow>(
      `INSERT INTO prescriptions (consultation_id, doctor_id, patient_id, content_enc, supersedes_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [
        input.consultationId,
        input.doctorId,
        input.patientId,
        input.contentEnc,
        input.supersedesId ?? null,
      ],
    );
    return res.rows[0];
  }

  async findById(id: string): Promise<PrescriptionRow | null> {
    const res = await db.query<PrescriptionRow>(`SELECT * FROM prescriptions WHERE id = $1`, [id]);
    return res.rows[0] ?? null;
  }

  async listForPatient(
    patientId: string,
    filters: { limit: number; cursor?: string },
  ): Promise<Page<PrescriptionRow>> {
    const cur = decodeCursor<{ issuedAt: string; id: string }>(filters.cursor);
    const params: unknown[] = [patientId];
    let cursorClause = '';
    if (cur) {
      params.push(cur.issuedAt, cur.id);
      cursorClause = `AND (issued_at, id) < ($2, $3)`;
    }
    params.push(filters.limit + 1);
    const res = await db.read<PrescriptionRow>(
      `SELECT * FROM prescriptions
        WHERE patient_id = $1 ${cursorClause}
        ORDER BY issued_at DESC, id DESC
        LIMIT $${params.length}`,
      params,
    );
    return buildPage(res.rows, filters.limit, (r) => ({ issuedAt: r.issued_at, id: r.id }));
  }

  async setPdfKey(id: string, key: string): Promise<void> {
    await db.query(`UPDATE prescriptions SET pdf_object_key = $2 WHERE id = $1`, [id, key]);
  }
}
