import Redis from 'ioredis';
import { env } from '../config/env';

/**
 * Redis client used for caching (catalog, leaderboards) and BullMQ queues
 * in later phases. Connection failures are tolerated so the API keeps
 * serving when Redis is briefly unavailable (cache falls back to Postgres).
 */
export const redis = new Redis(env.redisUrl, {
  maxRetriesPerRequest: 2,
  lazyConnect: false,
  retryStrategy: (times) => Math.min(times * 500, 5_000),
});

redis.on('error', (err) => {
  // Avoid crashing the process on transient Redis outages.
  // eslint-disable-next-line no-console
  console.warn(JSON.stringify({ level: 'warn', msg: 'redis_error', error: err.message }));
});

/** Cache get with JSON parse. Returns null on miss or parse failure. */
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await redis.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** Cache set with JSON stringify + TTL in seconds. Errors are swallowed. */
export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch {
    /* cache is best-effort */
  }
}

export async function cacheDel(pattern: string): Promise<void> {
  try {
    const keys = await redis.keys(pattern);
    if (keys.length) await redis.del(...keys);
  } catch {
    /* best-effort */
  }
}
