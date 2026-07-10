import { Queue, type JobsOptions, type ConnectionOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../observability/logger.js';

/**
 * Async job queue (BullMQ over Redis) for heavy/deferrable work — notifications,
 * PDF generation, refunds, rating recomputation, saga timeouts. Keeping these
 * off the request path protects the API's p95 latency SLOs.
 *
 * BullMQ requires a dedicated connection with `maxRetriesPerRequest: null`.
 */
export const bullConnection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
bullConnection.on('error', (err) => logger.error({ err }, 'BullMQ redis error'));

// BullMQ bundles its own ioredis; the structural types differ from our ioredis
// version, so we present the shared connection through BullMQ's type.
export const bullConn = bullConnection as unknown as ConnectionOptions;

export const QUEUE_NAME = 'amrutam-jobs';

export type JobName =
  | 'notification.send'
  | 'payment.refund'
  | 'rating.recompute'
  | 'prescription.pdf'
  | 'booking.timeout'
  | 'audit.partition.maintain'
  | 'slots.reap_holds';

export interface JobDataMap {
  'notification.send': { to: string; template: string; data: Record<string, unknown> };
  'payment.refund': { paymentId: string; reason: string };
  'rating.recompute': { doctorId: string };
  'prescription.pdf': { prescriptionId: string };
  'booking.timeout': { consultationId: string; sagaId: string };
  'audit.partition.maintain': Record<string, never>;
  'slots.reap_holds': Record<string, never>;
}

export const jobsQueue = new Queue(QUEUE_NAME, {
  connection: bullConn,
  defaultJobOptions: {
    // Exponential backoff with jitter is applied by the worker's settings too;
    // this is the retry policy for transient job failures.
    attempts: 5,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
});

export async function enqueue<N extends JobName>(
  name: N,
  data: JobDataMap[N],
  opts?: JobsOptions,
): Promise<void> {
  await jobsQueue.add(name, data, opts);
}

export async function closeQueue(): Promise<void> {
  await jobsQueue.close();
  await bullConnection.quit();
}
