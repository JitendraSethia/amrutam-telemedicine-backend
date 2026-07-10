import type { DbClient } from '../../db/pool.js';
import { db } from '../../db/pool.js';

export interface PaymentRow {
  id: string;
  consultation_id: string;
  patient_id: string;
  amount: string;
  currency: string;
  status: 'requires_payment' | 'processing' | 'succeeded' | 'failed' | 'refunded';
  provider: string;
  provider_ref: string | null;
  provider_intent: string | null;
  idempotency_key: string;
  failure_reason: string | null;
  refunded_amount: string;
  created_at: string;
}

export class PaymentsRepository {
  async create(
    client: DbClient,
    input: {
      consultationId: string;
      patientId: string;
      amount: number;
      currency: string;
      idempotencyKey: string;
    },
  ): Promise<PaymentRow> {
    const res = await client.query<PaymentRow>(
      `INSERT INTO payments (consultation_id, patient_id, amount, currency, status, idempotency_key)
       VALUES ($1,$2,$3,$4,'requires_payment',$5)
       RETURNING *`,
      [input.consultationId, input.patientId, input.amount, input.currency, input.idempotencyKey],
    );
    return res.rows[0];
  }

  async findByConsultation(consultationId: string): Promise<PaymentRow | null> {
    const res = await db.query<PaymentRow>(
      `SELECT * FROM payments WHERE consultation_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [consultationId],
    );
    return res.rows[0] ?? null;
  }

  async findById(id: string): Promise<PaymentRow | null> {
    const res = await db.query<PaymentRow>(`SELECT * FROM payments WHERE id = $1`, [id]);
    return res.rows[0] ?? null;
  }

  async findByProviderRef(ref: string): Promise<PaymentRow | null> {
    const res = await db.query<PaymentRow>(`SELECT * FROM payments WHERE provider_ref = $1`, [ref]);
    return res.rows[0] ?? null;
  }

  async updateStatus(
    id: string,
    status: PaymentRow['status'],
    opts: { providerRef?: string; providerIntent?: string; failureReason?: string } = {},
    client?: DbClient,
  ): Promise<void> {
    const runner = client ?? db;
    await runner.query(
      `UPDATE payments
          SET status = $2,
              provider_ref = COALESCE($3, provider_ref),
              provider_intent = COALESCE($4, provider_intent),
              failure_reason = $5
        WHERE id = $1`,
      [id, status, opts.providerRef ?? null, opts.providerIntent ?? null, opts.failureReason ?? null],
    );
  }

  async markRefunded(id: string, amount: number, client?: DbClient): Promise<void> {
    const runner = client ?? db;
    await runner.query(
      `UPDATE payments SET status = 'refunded', refunded_amount = $2 WHERE id = $1`,
      [id, amount],
    );
  }
}
