import type { DbClient } from '../../db/pool.js';
import { db } from '../../db/pool.js';

export type SagaStatus = 'running' | 'completed' | 'compensating' | 'compensated' | 'failed';

export interface SagaInstance {
  id: string;
  type: string;
  status: SagaStatus;
  current_step: string;
  correlation_id: string | null;
  context: Record<string, unknown>;
  completed_steps: string[];
  attempts: number;
  last_error: string | null;
}

/** Persistence for saga orchestration state + the transactional outbox. */
export class SagaRepository {
  async create(
    client: DbClient,
    input: { type: string; currentStep: string; correlationId?: string; context: Record<string, unknown> },
  ): Promise<string> {
    const res = await client.query<{ id: string }>(
      `INSERT INTO saga_instances (type, current_step, correlation_id, context)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [input.type, input.currentStep, input.correlationId ?? null, JSON.stringify(input.context)],
    );
    return res.rows[0].id;
  }

  async findById(id: string): Promise<SagaInstance | null> {
    const res = await db.query<SagaInstance>(`SELECT * FROM saga_instances WHERE id = $1`, [id]);
    return res.rows[0] ?? null;
  }

  async advance(
    id: string,
    input: { currentStep: string; completedStep?: string; context?: Record<string, unknown> },
    client?: DbClient,
  ): Promise<void> {
    const runner = client ?? db;
    await runner.query(
      `UPDATE saga_instances
          SET current_step = $2,
              completed_steps = CASE WHEN $3::text IS NULL THEN completed_steps
                                     ELSE array_append(completed_steps, $3) END,
              context = COALESCE($4, context)
        WHERE id = $1`,
      [id, input.currentStep, input.completedStep ?? null, input.context ? JSON.stringify(input.context) : null],
    );
  }

  async setStatus(
    id: string,
    status: SagaStatus,
    opts: { lastError?: string } = {},
    client?: DbClient,
  ): Promise<void> {
    const runner = client ?? db;
    await runner.query(
      `UPDATE saga_instances
          SET status = $2, last_error = $3, attempts = attempts + 1
        WHERE id = $1`,
      [id, status, opts.lastError ?? null],
    );
  }

  /** Write a domain event to the outbox in the caller's transaction. A relay
   * publishes these at-least-once, avoiding the dual-write problem. */
  async emit(
    client: DbClient,
    event: { aggregateType: string; aggregateId: string; eventType: string; payload: Record<string, unknown> },
  ): Promise<void> {
    await client.query(
      `INSERT INTO outbox (aggregate_type, aggregate_id, event_type, payload)
       VALUES ($1,$2,$3,$4)`,
      [event.aggregateType, event.aggregateId, event.eventType, JSON.stringify(event.payload)],
    );
  }
}
