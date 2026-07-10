import { startTracing, shutdownTracing } from '../observability/tracing.js';
import { logger } from '../observability/logger.js';

/**
 * Standalone worker process. Runs BullMQ job processing, schedules the
 * recurring maintenance jobs (hold reaper, partition maintenance), and runs the
 * outbox relay loop. Kept separate from the API so CPU-heavy jobs never impact
 * request-path latency, and so workers can be scaled independently.
 */
async function main(): Promise<void> {
  await startTracing();

  const [{ Worker }, queueMod, { buildContainer }, { makeProcessor, relayOutbox }, { db }, { redis }] =
    await Promise.all([
      import('bullmq'),
      import('./queue.js'),
      import('../container.js'),
      import('./processors.js'),
      import('../db/pool.js'),
      import('../cache/redis.js'),
    ]);

  const container = buildContainer();
  const worker = new Worker(queueMod.QUEUE_NAME, makeProcessor(container), {
    connection: queueMod.bullConn,
    concurrency: 10,
  });
  worker.on('failed', (job, err) => logger.error({ err, job: job?.name }, 'job failed (final)'));
  worker.on('completed', (job) => logger.debug({ job: job.name }, 'job completed'));

  // Recurring maintenance jobs (idempotent; safe if scheduled more than once).
  await queueMod.jobsQueue.add(
    'slots.reap_holds',
    {},
    { repeat: { every: 60_000 }, jobId: 'cron:reap-holds' },
  );
  await queueMod.jobsQueue.add(
    'audit.partition.maintain',
    {},
    { repeat: { pattern: '0 3 * * *' }, jobId: 'cron:audit-partition' }, // 03:00 daily
  );

  // Outbox relay loop.
  const relayTimer = setInterval(() => {
    relayOutbox().catch((err) => logger.error({ err }, 'outbox relay error'));
  }, 2000);

  logger.info('Worker started');

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Worker shutting down');
    clearInterval(relayTimer);
    await worker.close();
    await queueMod.closeQueue();
    await redis.quit();
    await db.close();
    await shutdownTracing();
    process.exit(0);
  };
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => void shutdown(sig));
  }
}

main().catch((err) => {
  logger.error({ err }, 'Worker fatal error');
  process.exit(1);
});
