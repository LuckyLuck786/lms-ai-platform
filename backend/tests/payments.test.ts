import crypto from 'crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

/**
 * Razorpay Standard Checkout with keys configured: order creation, checkout
 * signature verification and webhooks in Razorpay's real event format.
 * The SDK is mocked; the HMACs are computed exactly as Razorpay computes them.
 */

const KEY_SECRET = 'test_secret_for_unit_tests';
const WEBHOOK_SECRET = 'test_webhook_secret';
process.env.RAZORPAY_KEY_ID = 'rzp_test_unitkey';
process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;

const { queryMock, queryOneMock, ordersCreate } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  queryOneMock: vi.fn(),
  ordersCreate: vi.fn(),
}));

vi.mock('razorpay', () => ({ default: class { orders = { create: ordersCreate }; } }));
vi.mock('../src/db/pool', () => ({
  query: (...a: unknown[]) => queryMock(...a),
  queryOne: (...a: unknown[]) => queryOneMock(...a),
  pool: {},
  withTransaction: async (fn: (c: unknown) => Promise<unknown>) => fn({ query: (...a: unknown[]) => queryMock(...a) }),
}));
vi.mock('../src/db/redis', () => ({
  redis: { call: vi.fn() },
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn(),
  cacheDel: vi.fn(),
}));
vi.mock('../src/jobs/queues', () => ({
  queueCertificate: vi.fn(),
  queueEmail: vi.fn(),
  queueMasteryRecompute: vi.fn(),
}));

const { createApp } = await import('../src/app');
const { signAccessToken } = await import('../src/utils/jwt');
const app = createApp();

const COURSE = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const student = signAccessToken({ sub: USER, email: 's@gmail.com', roles: ['student'] });

type Rule = { match: RegExp; result: unknown };
function stubSql(rules: Rule[]) {
  const answer = (sql: string) => rules.find((r) => r.match.test(sql))?.result ?? null;
  queryOneMock.mockImplementation((sql: string) => Promise.resolve(answer(sql)));
  queryMock.mockImplementation((sql: string) => Promise.resolve(answer(sql) ?? []));
}

const paidCourse = { id: COURSE, price: '499.00', status: 'approved', title: 'Paid course' };

beforeEach(() => {
  vi.clearAllMocks();
  queryOneMock.mockResolvedValue(null);
  queryMock.mockResolvedValue([]);
});

describe('POST /courses/:id/payment/order', () => {
  it('creates an INR order in paise with a receipt Razorpay accepts', async () => {
    stubSql([{ match: /FROM courses WHERE id/, result: paidCourse }]);
    ordersCreate.mockResolvedValue({ id: 'order_123' });

    const res = await request(app).post(`/api/v1/courses/${COURSE}/payment/order`).set('authorization', `Bearer ${student}`).send({});

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ order_id: 'order_123', amount: 499, currency: 'INR', key_id: 'rzp_test_unitkey' });
    const args = ordersCreate.mock.calls[0][0];
    expect(args).toMatchObject({ amount: 49900, currency: 'INR', notes: { user_id: USER, course_id: COURSE } });
    expect(args.receipt.length).toBeLessThanOrEqual(40); // Razorpay's limit
    expect(JSON.stringify(res.body)).not.toContain(KEY_SECRET); // secret never reaches the browser
  });

  it('rejects a price below 100 paise before calling Razorpay', async () => {
    stubSql([{ match: /FROM courses WHERE id/, result: { ...paidCourse, price: '0.50' } }]);
    const res = await request(app).post(`/api/v1/courses/${COURSE}/payment/order`).set('authorization', `Bearer ${student}`).send({});
    expect(res.status).toBe(400);
    expect(ordersCreate).not.toHaveBeenCalled();
  });

  it('reports bad gateway keys as 503, not as the learner being signed out', async () => {
    stubSql([{ match: /FROM courses WHERE id/, result: paidCourse }]);
    ordersCreate.mockRejectedValue({ statusCode: 401, error: { code: 'BAD_REQUEST_ERROR', description: 'Authentication failed' } });
    const res = await request(app).post(`/api/v1/courses/${COURSE}/payment/order`).set('authorization', `Bearer ${student}`).send({});
    expect(res.status).toBe(503);
  });

  it('reports other gateway failures as 502 with Razorpay’s reason', async () => {
    stubSql([{ match: /FROM courses WHERE id/, result: paidCourse }]);
    ordersCreate.mockRejectedValue({ statusCode: 400, error: { description: 'receipt: the length must be no more than 40.' } });
    const res = await request(app).post(`/api/v1/courses/${COURSE}/payment/order`).set('authorization', `Bearer ${student}`).send({});
    expect(res.status).toBe(502);
    expect(res.body.error.message).toMatch(/receipt/);
  });
});

describe('POST /courses/:id/payment/verify', () => {
  const sign = (order: string, payment: string) =>
    crypto.createHmac('sha256', KEY_SECRET).update(`${order}|${payment}`).digest('hex');

  it('enrols only when HMAC-SHA256(order_id|payment_id) matches', async () => {
    stubSql([
      { match: /FROM courses WHERE id/, result: paidCourse },
      { match: /FROM payments WHERE razorpay_order_id = \$1 AND user_id/, result: { id: 'p1' } },
      { match: /SELECT id, status, amount FROM payments/, result: { id: 'p1', status: 'initiated', amount: '499.00' } },
    ]);
    const res = await request(app)
      .post(`/api/v1/courses/${COURSE}/payment/verify`)
      .set('authorization', `Bearer ${student}`)
      .send({ razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_1', razorpay_signature: sign('order_1', 'pay_1') });
    expect(res.status).toBe(200);
    expect(res.body.paid).toBe(true);
    expect(queryMock.mock.calls.some(([sql]) => /INSERT INTO enrollments/.test(String(sql)))).toBe(true);
  });

  it('returns 400 and does not mark paid on a forged signature', async () => {
    const res = await request(app)
      .post(`/api/v1/courses/${COURSE}/payment/verify`)
      .set('authorization', `Bearer ${student}`)
      .send({ razorpay_order_id: 'order_1', razorpay_payment_id: 'pay_1', razorpay_signature: sign('order_1', 'pay_OTHER') });
    expect(res.status).toBe(400);
    expect(queryMock.mock.calls.some(([sql]) => /status = 'success'/.test(String(sql)))).toBe(false);
  });

  it('returns 400 when a field is missing', async () => {
    const res = await request(app)
      .post(`/api/v1/courses/${COURSE}/payment/verify`)
      .set('authorization', `Bearer ${student}`)
      .send({ razorpay_order_id: 'order_1' });
    expect(res.status).toBe(400);
  });
});

describe('POST /payments/webhook (Razorpay event format)', () => {
  const event = (name: string, notes: unknown = { user_id: USER, course_id: COURSE }) =>
    JSON.stringify({
      entity: 'event',
      account_id: 'acc_test',
      event: name,
      contains: ['payment'],
      payload: { payment: { entity: { id: 'pay_9', order_id: 'order_9', status: 'captured', amount: 49900, notes } } },
      created_at: 1792700000,
    });
  const post = (body: string, secret = WEBHOOK_SECRET) =>
    request(app)
      .post('/api/v1/payments/webhook')
      .set('content-type', 'application/json')
      .set('x-razorpay-signature', crypto.createHmac('sha256', secret).update(body).digest('hex'))
      .send(body);

  it('enrols on payment.captured for an order we created', async () => {
    stubSql([
      { match: /FROM courses WHERE id/, result: paidCourse },
      { match: /FROM payments WHERE razorpay_order_id = \$1 AND user_id/, result: { id: 'p9' } },
      { match: /SELECT id, status, amount FROM payments/, result: { id: 'p9', status: 'initiated', amount: '499.00' } },
    ]);
    const res = await post(event('payment.captured'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ received: true, acted: true });
  });

  it('rejects a body signed with the wrong secret', async () => {
    expect((await post(event('payment.captured'), 'not-the-secret')).status).toBe(400);
  });

  it('acknowledges events it does not act on', async () => {
    const res = await post(event('payment.failed'));
    expect(res.body).toMatchObject({ received: true, acted: false });
  });

  it('ignores an order this platform never created', async () => {
    stubSql([{ match: /FROM courses WHERE id/, result: paidCourse }]);
    const res = await post(event('order.paid'));
    expect(res.body).toMatchObject({ received: true, acted: false });
  });

  it('copes with Razorpay sending empty notes as []', async () => {
    const res = await post(event('payment.captured', []));
    expect(res.status).toBe(200);
    expect(res.body.acted).toBe(false);
  });
});
