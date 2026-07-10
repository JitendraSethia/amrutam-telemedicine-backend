import { startTracing, shutdownTracing } from './observability/tracing.js';
import { logger } from './observability/logger.js';
import { env } from './config/env.js';

/**
 * Process entrypoint. Tracing is started FIRST, then the app is imported
 * dynamically so OpenTelemetry can patch pg/ioredis/http before they are loaded
 * (ESM evaluates static imports eagerly, so the instrumented libraries must be
 * pulled in only after the SDK is running).
 */
async function main(): Promise<void> {
  await startTracing();

  const [{ buildApp }, { db }, { redis }, { closeQueue }] = await Promise.all([
    import('./app.js'),
    import('./db/pool.js'),
    import('./cache/redis.js'),
    import('./jobs/queue.js'),
  ]);

  const app = await buildApp();
  await app.listen({ host: env.HOST, port: env.PORT });
  logger.info(`API listening on http://${env.HOST}:${env.PORT} (docs at /docs)`);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Graceful shutdown initiated');
    try {
      await app.close(); // stop accepting, drain in-flight
      await closeQueue();
      await redis.quit();
      await db.close();
      await shutdownTracing();
      logger.info('Shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };

  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => void shutdown(sig));
  }
  process.on('unhandledRejection', (reason) => logger.error({ reason }, 'unhandledRejection'));
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaughtException');
    void shutdown('uncaughtException');
  });
}

main().catch((err) => {
  logger.error({ err }, 'Fatal boot error');
  process.exit(1);
});
