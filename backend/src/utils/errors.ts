/**
 * Standard API error shape (PRD §8.8):
 * { "error": { "code": "...", "message": "...", "field": "..." } }
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly field?: string;

  constructor(status: number, code: string, message: string, field?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.field = field;
    Error.captureStackTrace?.(this, AppError);
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.field ? { field: this.field } : {}),
      },
    };
  }
}

export const badRequest = (message: string, field?: string) =>
  new AppError(400, 'VALIDATION_ERROR', message, field);

export const unauthorized = (message = 'Authentication required') =>
  new AppError(401, 'UNAUTHORIZED', message);

export const forbidden = (message = 'You do not have permission to perform this action') =>
  new AppError(403, 'FORBIDDEN', message);

export const notFound = (message = 'Resource not found') => new AppError(404, 'NOT_FOUND', message);

export const conflict = (message: string, field?: string) =>
  new AppError(409, 'CONFLICT', message, field);

export const tooManyRequests = (message = 'Rate limit exceeded, please retry later') =>
  new AppError(429, 'RATE_LIMITED', message);

export const internal = (message = 'Internal server error') =>
  new AppError(500, 'INTERNAL_ERROR', message);
