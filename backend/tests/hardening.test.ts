import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import {
  resolveSecret,
  isDevPlaceholder,
  DEV_SECRET_PLACEHOLDERS,
} from '../src/config/secrets';
import { sanitizeRequestId } from '../src/middleware/requestId';

const JWT_PLACEHOLDER = 'dev-only-change-me-jwt-secret-32-chars-min';
const DB_PLACEHOLDER = 'postgresql://lms:lms_dev_password@localhost:5432/lms';

// ---------------------------------------------------------------------------

describe('resolveSecret — production rules', () => {
  it('refuses to boot when a secret is missing in production', () => {
    expect(() => resolveSecret('JWT_SECRET', undefined, { isProd: true })).toThrow(
      /Missing required secret in production: JWT_SECRET/,
    );
  });

  it('refuses a blank secret in production', () => {
    expect(() => resolveSecret('JWT_SECRET', '   ', { isProd: true })).toThrow(
      /Missing required secret/,
    );
  });

  it('refuses the public JWT placeholder in production', () => {
    // The core defect: .env.example values copy-pasted into production would
    // otherwise make every access token forgeable by any repo reader.
    expect(() => resolveSecret('JWT_SECRET', JWT_PLACEHOLDER, { isProd: true })).toThrow(
      /public development placeholder/,
    );
  });

  it('refuses the dev database URL in production', () => {
    expect(() => resolveSecret('DATABASE_URL', DB_PLACEHOLDER, { isProd: true })).toThrow(
      /public development placeholder/,
    );
  });

  it('refuses every registered placeholder, not just JWT', () => {
    for (const value of DEV_SECRET_PLACEHOLDERS) {
      expect(() => resolveSecret('ANY_SECRET', value, { isProd: true })).toThrow();
    }
  });

  it('accepts a real secret in production', () => {
    const value = 'kR9xQ2mT7vLpW1sY6bN4cF3gH8jD5zA0eU';
    expect(resolveSecret('JWT_SECRET', value, { isProd: true })).toBe(value);
  });

  it('names the offending variable so the operator knows what to fix', () => {
    expect(() => resolveSecret('JWT_REFRESH_SECRET', undefined, { isProd: true })).toThrow(
      /JWT_REFRESH_SECRET/,
    );
  });

  it('mentions the deployment doc for the fix', () => {
    expect(() => resolveSecret('DATABASE_URL', undefined, { isProd: true })).toThrow(
      /deploy-cloud-run/,
    );
  });
});

describe('resolveSecret — development behaviour is unchanged', () => {
  it('falls back so `npm run dev` needs no configuration', () => {
    expect(resolveSecret('JWT_SECRET', undefined, { isProd: false, devDefault: 'dev-secret' })).toBe(
      'dev-secret',
    );
  });

  it('keeps an unset secret as an empty string when no default is offered', () => {
    expect(resolveSecret('SOMETHING_OPTIONAL', undefined, { isProd: false })).toBe('');
  });

  it('still accepts the placeholder in development', () => {
    expect(resolveSecret('JWT_SECRET', JWT_PLACEHOLDER, { isProd: false })).toBe(JWT_PLACEHOLDER);
  });

  it('prefers a real value over the fallback', () => {
    expect(resolveSecret('JWT_SECRET', 'real-key', { isProd: false, devDefault: 'dev' })).toBe(
      'real-key',
    );
  });

  it('trims surrounding whitespace', () => {
    expect(resolveSecret('JWT_SECRET', '  real-key  ', { isProd: false })).toBe('real-key');
  });
});

describe('isDevPlaceholder', () => {
  it('flags empty and whitespace-only values', () => {
    expect(isDevPlaceholder('')).toBe(true);
    expect(isDevPlaceholder('   ')).toBe(true);
  });

  it('flags every registered placeholder', () => {
    for (const value of DEV_SECRET_PLACEHOLDERS) expect(isDevPlaceholder(value)).toBe(true);
  });

  it('does not flag an arbitrary generated secret', () => {
    expect(isDevPlaceholder('kR9xQ2mT7vLpW1sY6bN4cF3gH8jD5zA0eU')).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('sanitizeRequestId', () => {
  it('accepts a short inert token', () => {
    expect(sanitizeRequestId('abc-123_XYZ.9')).toBe('abc-123_XYZ.9');
  });

  it('trims padding', () => {
    expect(sanitizeRequestId('  req-1  ')).toBe('req-1');
  });

  it('rejects log-injection attempts', () => {
    // This value ends up inside JSON log lines, so control characters must
    // never survive.
    expect(sanitizeRequestId('a"b\nlevel')).toBeNull();
    expect(sanitizeRequestId('a\ncrlf')).toBeNull();
  });

  it('rejects oversized input', () => {
    expect(sanitizeRequestId('x'.repeat(65))).toBeNull();
    expect(sanitizeRequestId('x'.repeat(64))).not.toBeNull();
  });

  it('rejects non-strings and empties', () => {
    expect(sanitizeRequestId(undefined)).toBeNull();
    expect(sanitizeRequestId(42)).toBeNull();
    expect(sanitizeRequestId({})).toBeNull();
    expect(sanitizeRequestId('')).toBeNull();
    expect(sanitizeRequestId('   ')).toBeNull();
  });
});

// ---------------------------------------------------------------------------

afterEach(() => {
  vi.restoreAllMocks();
});

describe('request-id middleware', () => {
  const app = createApp();

  it('assigns an id and echoes it in the response header', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('honours a caller-supplied correlation id', async () => {
    const res = await request(app).get('/health').set('X-Request-Id', 'upstream-id-1');
    expect(res.headers['x-request-id']).toBe('upstream-id-1');
  });

  it('replaces a hostile inbound id instead of echoing it', async () => {
    // CR/LF cannot legally be sent in a header value at all (the HTTP client
    // refuses them), so the reachable attack surface is legal-but-nasty input
    // — quotes, spaces, and oversize — which must not reach JSON log lines.
    const res = await request(app)
      .get('/health')
      .set('X-Request-Id', 'bad "quoted" value; drop table');
    expect(res.headers['x-request-id']).not.toContain('"');
    expect(res.headers['x-request-id']).not.toContain(' ');
    expect(res.headers['x-request-id']).toMatch(
      /^[A-Za-z0-9._:-]+$/,
    );
  });

  it('drops an oversize inbound id rather than logging it', async () => {
    const res = await request(app).get('/health').set('X-Request-Id', 'x'.repeat(500));
    expect(res.headers['x-request-id']).toHaveLength(36); // freshly minted uuid
  });

  it('carries an id on a 404 too, so failed routes stay traceable', async () => {
    // Non-/api/v1: that prefix is guarded by blanket `authenticate`, which
    // answers 401 before the 404 handler is reached.
    const res = await request(app).get('/definitely-not-a-page');
    expect(res.status).toBe(404);
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('puts the id on the access log line', async () => {
    const logged: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      logged.push(String(line));
    });

    const res = await request(app).get('/health').set('X-Request-Id', 'log-me-42');
    expect(res.status).toBe(200);

    const line = logged.find((l) => l.includes('"msg":"request"'));
    expect(line).toBeTruthy();
    const parsed = JSON.parse(line!) as Record<string, unknown>;
    expect(parsed.request_id).toBe('log-me-42');
  });
});
