import type { Job } from 'bullmq';
import { db } from '../db/pool.js';
import { logger } from '../observability/logger.js';
import { jobDuration } from '../observability/metrics.js';
import { randomToken } from '../utils/crypto.js';
import type { Container } from '../container.js';
import type { JobName, JobDataMap } from './queue.js';

/**
 * Job processor factory. One switch over job names keeps the worker simple; the
 * heavy lifting lives in the domain services (reused from the API's container).
 * Each branch is idempotent so BullMQ's at-least-once retries are safe.
 */
export function makeProcessor(container: Container) {
  return async function process(job: Job): Promise<void> {
    const end = jobDuration.startTimer({ queue: job.name });
    try {
      switch (job.name as JobName) {
        case 'notification.send': {
          const d = job.data as JobDataMap['notification.send'];
          // Mock delivery. Real impl → email/SMS/push provider (also idempotent).
          logger.info({ to: d.to, template: d.template }, 'notification.sent');
          break;
        }
        case 'payment.refund': {
          const d = job.data as JobDataMap['payment.refund'];
          await container.payments.refund(d.paymentId, d.reason);
          break;
        }
        case 'rating.recompute': {
          const d = job.data as JobDataMap['rating.recompute'];
          await container.doctors.recomputeRating(d.doctorId);
          break;
        }
        case 'prescription.pdf': {
          const d = job.data as JobDataMap['prescription.pdf'];
          // Mock: pretend we rendered + uploaded a PDF to object storage.
          const key = `prescriptions/${d.prescriptionId}/${randomToken(6)}.pdf`;
          await container.repos.prescriptionsRepo.setPdfKey(d.prescriptionId, key);
          break;
        }
        case 'booking.timeout': {
          const d = job.data as JobDataMap['booking.timeout'];
          await container.bookings.handleTimeout(d.consultationId, d.sagaId);
          break;
        }
        case 'slots.reap_holds': {
          const released = await container.repos.availabilityRepo.releaseExpiredHolds();
          if (released > 0) logger.info({ released }, 'reaped expired slot holds');
          break;
        }
        case 'audit.partition.maintain': {
          // Pre-create the next 3 monthly audit partitions.
          await db.query(
            `SELECT ensure_audit_partition((date_trunc('month', now()) + (n || ' month')::interval)::date)
               FROM generate_series(0, 3) AS n`,
          );
          logger.info('audit partitions ensured');
          break;
        }
        default:
          logger.warn({ name: job.name }, 'Unknown job');
      }
      end({ status: 'ok' });
    } catch (err) {
      end({ status: 'error' });
      logger.error({ err, job: job.name, id: job.id }, 'Job failed');
      throw err; // let BullMQ apply its retry/backoff policy
    }
  };
}

/**
 * Transactional-outbox relay: publishes committed domain events at-least-once.
 * Uses FOR UPDATE SKIP LOCKED so multiple workers can relay concurrently
 * without double-processing a row.
 */
export async function relayOutbox(batch = 100): Promise<number> {
  return db.tx(async (client) => {
    const res = await client.query<{ id: string; event_type: string; aggregate_id: string; payload: unknown }>(
      `SELECT id, event_type, aggregate_id, payload
         FROM outbox WHERE published_at IS NULL
        ORDER BY created_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [batch],
    );
    for (const row of res.rows) {
      // In production this publishes to a message bus (Kafka/SNS). Here we log.
      logger.info({ event: row.event_type, aggregateId: row.aggregate_id }, 'outbox.published');
      await client.query(
        `UPDATE outbox SET published_at = now(), attempts = attempts + 1 WHERE id = $1`,
        [row.id],
      );
    }
    return res.rows.length;
  });
}
