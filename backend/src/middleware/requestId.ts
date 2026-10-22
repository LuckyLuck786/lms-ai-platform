import { NextFunction, Request, Response } from 'express';
import crypto from 'crypto';

/**
 * Per-request correlation id (observability).
 *
 * `Express.Request.requestId` was declared but never populated, so a single
 * user action produced several unrelated log lines. This middleware assigns
 * one id per request, echoes it to the client, and every log line on that
 * request carries it. The AI-service forward adds the same id as a header, so
 * an answer that takes 20 s can be followed across both services' logs.
 *
 * An inbound `X-Request-Id` is honoured so a gateway or client can stitch
 * traces together — but only after validation, because it is caller-controlled
 * input that ends up inside JSON log lines.
 */

const HEADER = 'x-request-id';

/** Accept only a short, inert token; anything else is replaced. */
export function sanitizeRequestId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 64) return null;
  if (!/^[A-Za-z0-9._:-]+$/.test(trimmed)) return null;
  return trimmed;
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const id = sanitizeRequestId(req.headers[HEADER]) ?? crypto.randomUUID();
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}
