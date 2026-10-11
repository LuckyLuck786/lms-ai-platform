import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import Razorpay from 'razorpay';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth';
import { query, queryOne } from '../../db/pool';
import { badRequest, notFound, conflict, forbidden } from '../../utils/errors';
import { env } from '../../config/env';
import { queueEmail } from '../../jobs/queues';
import { logger } from '../../utils/logger';

const wrap =
  (fn: (req: Request, res: Response) => Promise<void | Response<any>>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

export const paymentsRouter = Router();

// --- Razorpay client (test mode unless prod keys are configured) ---------

function razorpayClient() {
  if (!env.razorpay.keyId) {
    throw new Error('RAZORPAY_KEY_ID is not configured');
  }
  return new Razorpay({
    key_id: env.razorpay.keyId,
    key_secret: env.razorpay.keySecret,
    // Test mode when the key id carries the test prefix; the SDK honours the
    // key pair regardless, so prod keys automatically switch to live mode.
  });
}

function verifyWebhookSignature(payload: string, secret: string, signature: string) {
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return expected === signature;
}

// --- POST /courses/:id/payment/order -------------------------------------

const orderSchema = z.object({
  currency: z.literal('INR').optional(),
  amount: z.number().min(1).optional(),
});

paymentsRouter.post(
  '/courses/:id/payment/order',
  authenticate,
  requireRole('student'),
  wrap(async (req, res) => {
    const course = await queryOne<{ id: string; price: string; status: string }>(
      'SELECT id, price, status FROM courses WHERE id = $1',
      [req.params.id],
    );
    if (!course) throw notFound('Course not found');
    if (course.status !== 'approved') throw forbidden('Course is not open for enrollment');

    const amount = orderSchema.parse(req.body ?? {}).amount ?? Number(course.price) * 100;
    if (Number(course.price) <= 0) {
      // Free courses enrol directly — no payment order needed.
      throw badRequest('This course is free — enrol directly instead of paying', 'course');
    }

    const existing = await queryOne(
      'SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2',
      [req.user!.id, course.id],
    );
    if (existing) throw conflict('You are already enrolled in this course');

    // Idempotency: if there is already a successful payment for this user+course,
    // return the existing order id so the client can resume the checkout flow.
    const prior = await queryOne<{ id: string }>(
      "SELECT id FROM payments WHERE user_id = $1 AND course_id = $2 AND status = 'success'",
      [req.user!.id, course.id],
    );
    if (prior) {
      return res.json({ course_id: course.id, already_paid: true, prior_payment_id: prior.id });
    }

    const rzp = razorpayClient();
    const order = await rzp.orders.create({
      amount,
      currency: 'INR',
      receipt: `lms-${course.id}-${req.user!.id}-${Date.now()}`,
      notes: {
        user_id: req.user!.id,
        course_id: course.id,
      },
    });

    await query(
      `INSERT INTO payments (user_id, course_id, amount, status, razorpay_order_id)
       VALUES ($1, $2, $3, 'initiated', $4)
       ON CONFLICT DO NOTHING`,
      [req.user!.id, course.id, amount / 100, order.id],
    );

    res.json({
      course_id: course.id,
      amount: amount / 100,
      currency: 'INR',
      order_id: order.id,
      key_id: env.razorpay.keyId,
    });
  }),
);

// --- POST /courses/:id/payment/webhook -----------------------------------

const webhookBodySchema = z.object({
  entity: z.literal('payment'),
  payload: z.object({
    payment: z.object({
      entity_id: z.string(),
      order_id: z.string(),
      status: z.string(),
      amount: z.number(),
      currency: z.string(),
      receipt: z.string(),
      notes: z.record(z.string()).optional(),
    }),
  }),
});

paymentsRouter.post(
  '/courses/:id/payment/webhook',
  wrap(async (req, res) => {
    const raw = await new Promise<string>((resolve, reject) => {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', () => resolve(body));
      req.on('error', reject);
    });
    const signature = req.headers['x-razorpay-signature'] as string | undefined;

    if (!signature) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Missing X-Razorpay-Signature' } });
    }

    if (!verifyWebhookSignature(raw, env.razorpay.webhookSecret, signature)) {
      logger.warn('payment_webhook_bad_signature', { course_id: req.params.id });
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid signature' } });
    }

    const parsed = webhookBodySchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Payload did not match schema' } });
    }

    const payment = parsed.data.payload.payment;
    if (payment.status !== 'captured') {
      return res.json({ received: true, status: payment.status });
    }

    const course = await queryOne<{ id: string; price: string; status: string; title: string; instructor_id: string }>(
      'SELECT id, price, status, title, instructor_id FROM courses WHERE id = $1',
      [req.params.id],
    );
    if (!course) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Course not found' } });

    await query(
      `UPDATE payments SET status = 'success'
       WHERE razorpay_order_id = $1 AND (status IS NULL OR status = 'initiated')`,
      [payment.order_id],
    );

    // Enroll the buyer if not already enrolled (idempotent).
    const buyerId = payment.notes?.user_id ?? (req as any).user?.id;
    if (buyerId) {
      const enrolledCheck = await queryOne(
        'SELECT 1 AS ok FROM enrollments WHERE user_id = $1 AND course_id = $2',
        [buyerId, course.id],
      );
      if (!enrolledCheck) {
        await query(
          'INSERT INTO enrollments (user_id, course_id) VALUES ($1, $2) RETURNING id',
          [buyerId, course.id],
        );
      }
    }

    // Notify the learner.
    await queueEmail({
      kind: 'generic',
      subject: `Payment confirmed for “${course.title}”`,
      body:
        `Your payment of ₹${payment.amount / 100} for “${course.title}” has been confirmed.\\n\\n` +
        'You are now enrolled — head to your dashboard to start learning.',
      recipients: buyerId ? [(await queryOne<{ email: string }>('SELECT email FROM users WHERE id = $1', [buyerId]))?.email ?? []].flat() : [],
      cta: { label: 'Go to dashboard', path: '/dashboard' },
    });

    logger.info('payment_webhook_success', {
      order_id: payment.order_id,
      course_id: course.id,
      user_id: buyerId,
    });

    res.json({ received: true, status: 'captured' });
  }),
);

// --- GET /courses/:id/payment/status --------------------------------------

paymentsRouter.get(
  '/courses/:id/payment/status',
  authenticate,
  requireRole('student'),
  wrap(async (req, res) => {
    const course = await queryOne<{ id: string; price: string }>(
      'SELECT id, price FROM courses WHERE id = $1',
      [req.params.id],
    );
    if (!course) throw notFound('Course not found');

    const payment = await queryOne<{ id: string; status: string; razorpay_order_id: string | null }>(
      "SELECT id, status, razorpay_order_id FROM payments WHERE user_id = $1 AND course_id = $2 ORDER BY created_at DESC LIMIT 1",
      [req.user!.id, course.id],
    );

    const enrolled = await queryOne('SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2', [
      req.user!.id,
      course.id,
    ]);

    res.json({
      course_id: course.id,
      price: Number(course.price),
      free: Number(course.price) <= 0,
      enrolled: !!enrolled,
      payment: payment
        ? { id: payment.id, status: payment.status, order_id: payment.razorpay_order_id }
        : null,
    });
  }),
);

// --- Admin: retry a failed payment email ----------------------------------

const retryEmailSchema = z.object({
  payment_id: z.string().uuid(),
});

paymentsRouter.post(
  '/admin/payments/:payment_id/resend-notice',
  authenticate,
  requireRole('admin'),
  wrap(async (req, res) => {
    const payment = await queryOne<{ user_id: string; course_id: string; amount: string | null }>(
      'SELECT user_id, course_id, amount FROM payments WHERE id = $1',
      [req.params.payment_id],
    );
    if (!payment) throw notFound('Payment not found');

    const user = await queryOne<{ email: string; full_name: string }>(
      'SELECT email, full_name FROM users WHERE id = $1',
      [payment.user_id],
    );
    const course = await queryOne<{ title: string }>(
      'SELECT title FROM courses WHERE id = $1',
      [payment.course_id],
    );
    if (!user || !course) throw notFound('Related record not found');

    const amount = Number(payment.amount ?? 0);
    await queueEmail({
      kind: 'generic',
      subject: `Payment receipt for “${course.title}”`,
      body:
        `Hello ${user.full_name},\\n\\n` +
        `A payment of ₹${amount} was recorded for “${course.title}” on ${new Date().toLocaleDateString()}.\\n\\n` +
        'If you have not enrolled yet, contact support — your enrolment may still be pending.',
      recipients: [user.email],
      cta: { label: 'View course', path: '/catalog' },
    });

    res.json({ payment_id: req.params.payment_id, notice_queued: true });
  }),
);
