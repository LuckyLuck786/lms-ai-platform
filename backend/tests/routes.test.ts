import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

/**
 * Route-level integration tests (PRD §14.2).
 *
 * These exercise the real Express app — middleware order, route mounting,
 * auth guards, validation and the error envelope — with persistence stubbed
 * out. That combination catches the failures unit tests structurally cannot:
 * a router that exists but is never mounted (which is exactly how the payments
 * module shipped unreachable), a guard mounted before the route it protects,
 * or an error that escapes the standard envelope.
 *
 * Each stubbed SQL statement is answered by matching on a substring, so a test
 * reads as "when the course is paid and no payment exists, this happens".
 */

// `vi.hoisted` keeps these defined before the mocked modules are imported —
// a plain `const` would still be in its temporal dead zone when the app loads.
const { queryMock, queryOneMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  queryOneMock: vi.fn(),
}));

vi.mock('../src/db/pool', () => ({
  query: (...args: unknown[]) => queryMock(...args),
  queryOne: (...args: unknown[]) => queryOneMock(...args),
  pool: {},
  withTransaction: async (fn: (c: unknown) => Promise<unknown>) =>
    fn({ query: (...args: unknown[]) => queryMock(...args) }),
}));

vi.mock('../src/db/redis', () => ({
  redis: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    keys: vi.fn().mockResolvedValue([]),
  },
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn().mockResolvedValue(undefined),
  cacheDel: vi.fn().mockResolvedValue(undefined),
}));

// Queue producers would otherwise open real Redis connections.
vi.mock('../src/jobs/queues', () => ({
  queueCertificate: vi.fn().mockResolvedValue(undefined),
  queueEmail: vi.fn().mockResolvedValue(undefined),
  queueMasteryRecompute: vi.fn().mockResolvedValue(undefined),
}));

import { createApp } from '../src/app';
import { signAccessToken } from '../src/utils/jwt';

const app = createApp();

const COURSE_ID = '11111111-1111-4111-8111-111111111111';

const tokenFor = (roles: ('student' | 'instructor' | 'admin')[]) =>
  signAccessToken({ sub: 'u-1', email: 'u1@example.com', roles });

const student = tokenFor(['student']);
const instructor = tokenFor(['instructor']);

interface SqlRule {
  match: RegExp;
  result: unknown;
  /** How many times this rule may answer; omitted means unlimited. */
  times?: number;
}

/** Answer each stubbed statement by matching the SQL it contains. */
function stubSql(rules: SqlRule[]): void {
  const used = new Map<SqlRule, number>();
  const answer = (sql: string): unknown => {
    for (const rule of rules) {
      if (!rule.match.test(sql)) continue;
      const seen = used.get(rule) ?? 0;
      if (rule.times !== undefined && seen >= rule.times) continue;
      used.set(rule, seen + 1);
      return rule.result;
    }
    return null;
  };
  queryOneMock.mockImplementation((sql: string) => Promise.resolve(answer(sql)));
  queryMock.mockImplementation((sql: string) => Promise.resolve(answer(sql) ?? []));
}

beforeEach(() => {
  vi.clearAllMocks();
  queryOneMock.mockResolvedValue(null);
  queryMock.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------

describe('app shell', () => {
  it('answers the health probe', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', service: 'backend' });
  });

  it('gives the root URL a landing response instead of a 404', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ service: 'lms-ai-backend', api: '/api/v1' });
  });

  it('wraps unknown routes in the standard error envelope', async () => {
    const res = await request(app)
      .get('/api/v1/there-is-no-such-route')
      .set('authorization', `Bearer ${student}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects a protected route with no token', async () => {
    const res = await request(app).get('/api/v1/enrollments/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});

// ---------------------------------------------------------------------------

describe('payments routes are mounted', () => {
  // Regression guard for the shipped-but-unmounted router: before this fix the
  // order route 404'd (unreachable), which is precisely what a mounted-router
  // test must fail on.
  it('reaches the order route rather than 404ing', async () => {
    const res = await request(app)
      .post(`/api/v1/courses/${COURSE_ID}/payment/order`)
      .set('authorization', `Bearer ${student}`)
      .send({});
    expect(res.status).not.toBe(404);
  });

  it('demands authentication for checkout', async () => {
    const res = await request(app).post(`/api/v1/courses/${COURSE_ID}/payment/order`).send({});
    expect(res.status).toBe(401);
  });

  it('refuses checkout to a non-student role', async () => {
    const res = await request(app)
      .post(`/api/v1/courses/${COURSE_ID}/payment/order`)
      .set('authorization', `Bearer ${instructor}`)
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('reports 503 rather than crashing when no gateway keys are configured', async () => {
    // The test environment has no RAZORPAY_* settings, so the guard is exactly
    // the one production hits on a deployment without payments enabled.
    stubSql([{ match: /FROM courses WHERE id/, result: { id: COURSE_ID, price: '49.00', status: 'approved' } }]);
    const res = await request(app)
      .post(`/api/v1/courses/${COURSE_ID}/payment/order`)
      .set('authorization', `Bearer ${student}`)
      .send({});
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('verifies the webhook signature before trusting the payload', async () => {
    const res = await request(app)
      .post(`/api/v1/courses/${COURSE_ID}/payment/webhook`)
      .set('content-type', 'application/json')
      .send(JSON.stringify({ entity: 'payment', payload: { payment: { entity: {} } } }));
    expect(res.status).toBe(400);
  });

  it('exposes the payment status route to a learner', async () => {
    stubSql([
      { match: /SELECT id, price FROM courses WHERE id/, result: { id: COURSE_ID, price: '49.00' } },
      { match: /FROM payments WHERE user_id/, result: null },
    ]);
    const res = await request(app)
      .get(`/api/v1/courses/${COURSE_ID}/payment/status`)
      .set('authorization', `Bearer ${student}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ course_id: COURSE_ID, free: false, enrolled: false });
  });
});

// ---------------------------------------------------------------------------

// The admin guard was narrowed from a router-level blanket to the /admin/*
// sub-path so it stops swallowing unrelated /api/v1 requests. These tests
// prove the narrow form still protects the whole admin surface.
describe('admin routes stay protected', () => {
  const admin = tokenFor(['admin']);

  it('rejects an anonymous caller', async () => {
    const res = await request(app).get('/api/v1/admin/analytics/overview');
    expect(res.status).toBe(401);
  });

  it('rejects a student on the analytics route', async () => {
    const res = await request(app)
      .get('/api/v1/admin/analytics/overview')
      .set('authorization', `Bearer ${student}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects a student on the moderation route too', async () => {
    // A second, differently-shaped admin route, so the guard is proven to
    // cover the subtree rather than one registered path.
    const res = await request(app)
      .get('/api/v1/admin/moderation/flagged-posts')
      .set('authorization', `Bearer ${student}`);
    expect(res.status).toBe(403);
  });

  it('admits an admin to the analytics route', async () => {
    const res = await request(app)
      .get('/api/v1/admin/analytics/overview')
      .set('authorization', `Bearer ${admin}`);
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------

describe('enrolment is gated on payment', () => {
  const enroll = () =>
    request(app)
      .post(`/api/v1/courses/${COURSE_ID}/enroll`)
      .set('authorization', `Bearer ${student}`)
      .send({});

  it('enrols directly in a free course', async () => {
    stubSql([
      { match: /SELECT id, status, price FROM courses/, result: { id: COURSE_ID, status: 'approved', price: '0.00' } },
      { match: /SELECT id FROM enrollments/, result: null, times: 1 },
      { match: /INSERT INTO enrollments/, result: { id: 'e-1', course_id: COURSE_ID } },
    ]);
    const res = await enroll();
    expect(res.status).toBe(201);
  });

  it('refuses a paid course with no successful payment', async () => {
    stubSql([
      { match: /SELECT id, status, price FROM courses/, result: { id: COURSE_ID, status: 'approved', price: '49.00' } },
      { match: /SELECT id FROM enrollments/, result: null, times: 1 },
      { match: /FROM payments WHERE user_id/, result: null },
    ]);
    const res = await enroll();
    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('PAYMENT_REQUIRED');
  });

  it('enrols in a paid course once the payment succeeded', async () => {
    stubSql([
      { match: /SELECT id, status, price FROM courses/, result: { id: COURSE_ID, status: 'approved', price: '49.00' } },
      { match: /SELECT id FROM enrollments/, result: null, times: 1 },
      { match: /FROM payments WHERE user_id/, result: { id: 'pay-1' } },
      { match: /INSERT INTO enrollments/, result: { id: 'e-2', course_id: COURSE_ID } },
    ]);
    const res = await enroll();
    expect(res.status).toBe(201);
  });

  it('still refuses a course that is not approved', async () => {
    stubSql([
      { match: /SELECT id, status, price FROM courses/, result: { id: COURSE_ID, status: 'pending', price: '0.00' } },
    ]);
    const res = await enroll();
    expect(res.status).toBe(403);
  });

  it('rejects enrolling twice', async () => {
    stubSql([
      { match: /SELECT id, status, price FROM courses/, result: { id: COURSE_ID, status: 'approved', price: '0.00' } },
      { match: /SELECT id FROM enrollments/, result: { id: 'e-1' } },
    ]);
    const res = await enroll();
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });
});
