import pg from 'pg';
import { env } from '../config/env.js';
import { logger } from '../observability/logger.js';

const { Pool } = pg;

/**
 * Postgres access with read/write splitting. Writes and read-your-writes go to
 * the primary; heavy analytical / search reads can be routed to a replica when
 * `DATABASE_REPLICA_URL` is set. Pools are bounded (see PGPOOL_MAX) so a traffic
 * spike cannot exhaust database connections — excess requests queue briefly and
 * shed via the connection timeout instead of toppling the DB.
 */

// Return DATE/TIMESTAMP as ISO strings handled at the app layer; keep BIGINT
// as string to avoid precision loss, numeric as number.
pg.types.setTypeParser(20, (v) => (v === null ? null : v)); // int8 -> string

export interface DbClient {
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<pg.QueryResult<T>>;
}

const primary = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.PGPOOL_MAX,
  idleTimeoutMillis: env.PGPOOL_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: env.PGPOOL_CONN_TIMEOUT_MS,
  application_name: env.APP_NAME,
});

const replica = env.DATABASE_REPLICA_URL
  ? new Pool({
      connectionString: env.DATABASE_REPLICA_URL,
      max: env.PGPOOL_MAX,
      idleTimeoutMillis: env.PGPOOL_IDLE_TIMEOUT_MS,
      connectionTimeoutMillis: env.PGPOOL_CONN_TIMEOUT_MS,
      application_name: `${env.APP_NAME}-ro`,
    })
  : primary;

primary.on('error', (err) => logger.error({ err }, 'Unexpected error on idle primary client'));
if (replica !== primary) {
  replica.on('error', (err) => logger.error({ err }, 'Unexpected error on idle replica client'));
}

export const db = {
  /** Read/write pool (primary). */
  async query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]) {
    return primary.query<T>(text, params);
  },

  /** Read-only pool (replica when configured, else primary). */
  async read<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]) {
    return replica.query<T>(text, params);
  },

  /**
   * Run `fn` inside a transaction. Retries on serialization / deadlock failures
   * (SQLSTATE 40001 / 40P01) with exponential backoff — the correct pattern for
   * SERIALIZABLE isolation and for lock contention under concurrent bookings.
   */
  async tx<T>(
    fn: (client: DbClient) => Promise<T>,
    opts: { isolation?: 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE'; retries?: number } = {},
  ): Promise<T> {
    const isolation = opts.isolation ?? 'READ COMMITTED';
    const maxRetries = opts.retries ?? 3;
    let attempt = 0;

    for (;;) {
      const client = await primary.connect();
      try {
        await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        const code = (err as { code?: string }).code;
        const retryable = code === '40001' || code === '40P01';
        if (retryable && attempt < maxRetries) {
          attempt += 1;
          const backoff = Math.min(50 * 2 ** attempt, 500);
          logger.warn({ code, attempt }, 'Retrying transaction after serialization failure');
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
        throw err;
      } finally {
        client.release();
      }
    }
  },

  async healthcheck(): Promise<boolean> {
    const res = await primary.query('SELECT 1 AS ok');
    return res.rows[0]?.ok === 1;
  },

  async close(): Promise<void> {
    await primary.end();
    if (replica !== primary) await replica.end();
  },
};
