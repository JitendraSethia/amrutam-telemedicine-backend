import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../observability/logger.js';

/**
 * Shared Redis connection used for caching, rate limiting, idempotency records
 * and distributed locks. BullMQ uses its own connections (it requires
 * `maxRetriesPerRequest: null`), created in the jobs module.
 */
export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: true, // connect on first use — avoids eager connects at import
  retryStrategy: (times) => Math.min(times * 200, 2000),
});

redis.on('error', (err) => logger.error({ err }, 'Redis connection error'));
redis.on('connect', () => logger.info('Redis connected'));

export const cache = {
  async get<T>(key: string): Promise<T | null> {
    const raw = await redis.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  },

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  },

  async del(...keys: string[]): Promise<void> {
    if (keys.length) await redis.del(...keys);
  },

  /** Invalidate every key matching a glob, using SCAN to avoid blocking Redis. */
  async invalidatePattern(pattern: string): Promise<void> {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      cursor = next;
      if (keys.length) await redis.del(...keys);
    } while (cursor !== '0');
  },

  /**
   * Cache-aside with single-flight-ish protection: on miss, compute and store.
   * A short negative-cache is intentionally NOT applied here; callers decide.
   */
  async remember<T>(key: string, ttlSeconds: number, compute: () => Promise<T>): Promise<T> {
    const hit = await this.get<T>(key);
    if (hit !== null) return hit;
    const value = await compute();
    await this.set(key, value, ttlSeconds);
    return value;
  },
};

/**
 * Best-effort distributed lock (Redlock-lite, single node). Acquire with a
 * random token, release only if we still own it (atomic Lua CAS) so we never
 * release someone else's lock. Used to serialise saga steps / re-key jobs.
 */
export async function withLock<T>(
  resource: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T | null> {
  const key = `lock:${resource}`;
  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const acquired = await redis.set(key, token, 'PX', ttlMs, 'NX');
  if (!acquired) return null;
  try {
    return await fn();
  } finally {
    // Atomic compare-and-delete.
    await redis.eval(
      `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
      1,
      key,
      token,
    );
  }
}
