import rateLimit, { Store } from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import { Request, Response } from 'express';
import { env } from '../config/env';
import { redis } from '../db/redis';
import { verifyAccessToken } from '../utils/jwt';

function sendLimited(_req: Request, res: Response): void {
  res.status(429).json({
    error: { code: 'RATE_LIMITED', message: 'Rate limit exceeded, please retry later' },
  });
}

/**
 * Counters live in Redis so every API instance shares them. With the default
 * in-memory store each Cloud Run instance counted on its own, and the real
 * ceiling was the PRD limit multiplied by the instance count. Tests keep the
 * memory store: they run without a Redis server.
 */
function store(prefix: string): Store | undefined {
  if (env.nodeEnv === 'test') return undefined;
  return new RedisStore({
    prefix: `rl:${prefix}:`,
    sendCommand: (command: string, ...args: string[]) =>
      redis.call(command, ...args) as Promise<RedisReply>,
  });
}

/**
 * The general limiter is mounted before any router authenticates, so
 * `req.user` is never set when it runs. Read the bearer token here instead,
 * so limits are per user as PRD §8.9 specifies rather than per IP — many
 * learners behind one campus NAT would otherwise share a single budget.
 * An invalid token falls back to the IP; the route itself still rejects it.
 */
export function userOrIpKey(req: Request): string {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      return `u:${verifyAccessToken(header.slice(7)).sub}`;
    } catch {
      /* fall through to IP */
    }
  }
  return `ip:${req.ip ?? 'unknown'}`;
}

/**
 * PRD §8.9:
 *  - /auth/*        10 req/min/IP
 *  - /ai/chat/*     20 req/min/user
 *  - everything else 100 req/min/user (falls back to IP when unauthenticated)
 *
 * `passOnStoreError`: a Redis outage must degrade to "no limiting", not to
 * every request failing.
 */
export const authRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: env.rateLimits.authPerMinute,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip ?? 'unknown',
  handler: sendLimited,
  store: store('auth'),
  passOnStoreError: true,
});

export const aiChatRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: env.rateLimits.aiChatPerMinute,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user?.id ? `u:${req.user.id}` : userOrIpKey(req)),
  handler: sendLimited,
  store: store('ai-chat'),
  passOnStoreError: true,
});

export const generalRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: env.rateLimits.generalPerMinute,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  handler: sendLimited,
  skip: (req) => req.path.startsWith('/auth') || req.path.startsWith('/ai/chat'),
  store: store('general'),
  passOnStoreError: true,
});
