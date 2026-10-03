import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';
import { env } from '../config/env';

function sendLimited(_req: Request, res: Response): void {
  res.status(429).json({
    error: { code: 'RATE_LIMITED', message: 'Rate limit exceeded, please retry later' },
  });
}

/**
 * PRD §8.9:
 *  - /auth/*        10 req/min/IP
 *  - /ai/chat/*     20 req/min/user
 *  - everything else 100 req/min/user (falls back to IP when unauthenticated)
 */
export const authRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: env.rateLimits.authPerMinute,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip ?? 'unknown',
  handler: sendLimited,
});

export const aiChatRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: env.rateLimits.aiChatPerMinute,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id ?? req.ip ?? 'unknown',
  handler: sendLimited,
});

export const generalRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: env.rateLimits.generalPerMinute,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id ?? req.ip ?? 'unknown',
  handler: sendLimited,
  skip: (req) => req.path.startsWith('/auth') || req.path.startsWith('/ai/chat'),
});
