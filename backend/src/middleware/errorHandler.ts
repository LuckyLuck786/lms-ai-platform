import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';

/** Maps thrown errors to the standard { error: { code, message, field } } envelope. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    if (err.status >= 500) {
      logger.error('request_failed', { path: req.path, code: err.code, message: err.message });
    }
    res.status(err.status).json(err.toJSON());
    return;
  }

  if (err instanceof ZodError) {
    const first = err.issues[0];
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: first ? `${first.path.join('.') || 'body'}: ${first.message}` : 'Validation failed',
        field: first?.path.join('.') || undefined,
      },
    });
    return;
  }

  logger.error('unhandled_error', {
    path: req.path,
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
}

/** 404 fallback for unknown routes — keeps the standard error envelope. */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `Route not found: ${req.method} ${req.originalUrl}` },
  });
}

/** Structured per-request access log (observability requirement). */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    logger.info('request', {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      duration_ms: Math.round(durationMs * 100) / 100,
      user_id: req.user?.id,
    });
  });
  next();
}
