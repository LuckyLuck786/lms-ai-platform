import { describe, expect, it } from 'vitest';
import { AppError, badRequest, notFound, unauthorized } from '../src/utils/errors';

describe('standard error format (PRD §8.8)', () => {
  it('serializes to { error: { code, message } }', () => {
    expect(notFound('Course not found').toJSON()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Course not found' },
    });
  });

  it('includes field when provided', () => {
    const err = badRequest('email must be a valid email address', 'email');
    expect(err.toJSON()).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'email must be a valid email address',
        field: 'email',
      },
    });
    expect(err.status).toBe(400);
  });

  it('defaults to 401 for unauthorized', () => {
    const err: AppError = unauthorized();
    expect(err.status).toBe(401);
    expect(err.code).toBe('UNAUTHORIZED');
  });
});
