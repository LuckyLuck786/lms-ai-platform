import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import Razorpay from 'razorpay';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth';
import { query, queryOne } from '../../db/pool';
import { badRequest, notFound, conflict, forbidden, serviceUnavailable } from '../../utils/errors';
import { env } from '../../config/env';
import { queueEmail } from '../../jobs/queues';
import { logger } from '../../utils/logger';

/**
 * Payments / checkout (PRD §15 item 4).
 *
 * Mounted at /api/v1 by app.ts. Razorpay is the gateway, driven by two legs:
 *
 *   1. `POST /courses/:id/payment/order`  — the SPA asks for an order, gets
 *      back the order id + public key, and opens Razorpay Checkout.
 *   2. Confirmation, either
 *      `POST /courses/:id/payment/verify` — the browser reports the checkout
 *      result so enrolment is immediate, or
 *      `POST /courses/:id/payment/webhook` — Razorpay's server callback, which
 *      is authoritative and idempotent (and covers the case where the learner
 *      closed the tab before `verify` ran).
 *
 * Both legs funnel into `confirmPayment`, so there is exactly one code path
 * that flips a payment to `success` and creates the enrolment.
 */

const wrap =
  (fn: (req: Request, res: Response) => Promise<void | Response<unknown>>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

export const paymentsRouter = Router();

// --- Razorpay client (test mode unless live keys are configured) ---------

/** True when the gateway is usable in this environment. */
function paymentsConfigured(): boolean {
  return Boolean(env.razorpay.keyId && env.razorpay.keySecret);
}

function razorpayClient(): Razorpay {
  return new Razorpay({
    key_id: env.razorpay.keyId,
    key_secret: env.razorpay.keySecret,
    // Test mode when the key id carries the test prefix; the SDK honours the
    // key pair regardless, so live keys automatically switch to live mode.
  });
}

/**
 * Constant-time comparison of two hex digests. Guards every signature check
 * (checkout callback and webhook) so a timing side-channel cannot be used to
 * forge one byte at a time.
 */
function signaturesMatch(expected: string, actual: string | undefined): boolean {
  if (!actual) return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(actual, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Razorpay's checkout callback: HMAC_SHA256("<order_id>|<payment_id>"). */
function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean {
  const expected = crypto
    .createHmac('sha256', env.razorpay.keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  return signaturesMatch(expected, signature);
}

/** Razorpay's webhook: HMAC_SHA256 over the raw request body. */
function verifyWebhookSignature(rawBody: string, signature: string | undefined): boolean {
  if (!env.razorpay.webhookSecret) return false;
  const expected = crypto
    .createHmac('sha256', env.razorpay.webhookSecret)
    .update(rawBody)
    .digest('hex');
  return signaturesMatch(expected, signature);
}

// --- Shared confirmation path --------------------------------------------

interface CourseRow {
  id: string;
  price: string;
  status: string;
  title: string;
}

/**
 * Flip a payment to `success` and enrol the learner, exactly once.
 *
 * Idempotent by design: the UPDATE is a no-op if the row is already success,
 * the enrolment insert is guarded by an existence check, and the confirmation
 * email only fires on the transition. Safe to call from both the browser
 * callback and the webhook for the same payment.
 */
async function confirmPayment(params: {
  orderId: string;
  paymentId?: string;
  userId: string;
  course: CourseRow;
}): Promise<{ enrolled: boolean; alreadyEnrolled: boolean }> {
  const { orderId, paymentId, userId, course } = params;

  const payment = await queryOne<{ id: string; status: string | null; amount: string | null }>(
    'SELECT id, status, amount FROM payments WHERE razorpay_order_id = $1 AND user_id = $2 AND course_id = $3',
    [orderId, userId, course.id],
  );
  const firstConfirmation = !payment || payment.status === 'initiated' || payment.status === null;

  if (payment) {
    await query(
      `UPDATE payments
          SET status = 'success',
              razorpay_payment_id = COALESCE($2, razorpay_payment_id),
              updated_at = now()
        WHERE id = $1 AND (status IS NULL OR status <> 'success')`,
      [payment.id, paymentId ?? null],
    );
  }

  const existing = await queryOne('SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2', [
    userId,
    course.id,
  ]);
  if (!existing) {
    await query('INSERT INTO enrollments (user_id, course_id) VALUES ($1, $2)', [userId, course.id]);
  }

  // Notify only on the real transition, so a duplicated webhook cannot spam
  // the learner with the same receipt twice.
  if (firstConfirmation && !existing) {
    const buyer = await queryOne<{ email: string; full_name: string }>(
      'SELECT email, full_name FROM users WHERE id = $1',
      [userId],
    );
    if (buyer?.email) {
      await queueEmail({
        kind: 'generic',
        subject: `Payment confirmed for “${course.title}”`,
        body:
          `Hello ${buyer.full_name},\n\n` +
          `Your payment of ₹${Number(payment?.amount ?? course.price)} for “${course.title}” has been confirmed. ` +
          'You are now enrolled — head to your dashboard to start learning.',
        recipients: [buyer.email],
        cta: { label: 'Go to dashboard', path: '/dashboard' },
      });
    }
  }

  logger.info('payment_confirmed', { order_id: orderId, course_id: course.id, user_id: userId });
  return { enrolled: true, alreadyEnrolled: Boolean(existing) };
}

// --- POST /courses/:id/payment/order -------------------------------------

const orderSchema = z.object({
  currency: z.literal('INR').optional(),
});

paymentsRouter.post(
  '/courses/:id/payment/order',
  authenticate,
  requireRole('student'),
  wrap(async (req, res) => {
    if (!paymentsConfigured()) {
      throw serviceUnavailable(
        'Payments are not configured on this deployment (missing RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET)',
      );
    }

    const course = await queryOne<CourseRow>(
      'SELECT id, price, status, title FROM courses WHERE id = $1',
      [req.params.id],
    );
    if (!course) throw notFound('Course not found');
    if (course.status !== 'approved') throw forbidden('Course is not open for enrollment');

    orderSchema.parse(req.body ?? {});

    const price = Number(course.price);
    if (!Number.isFinite(price) || price <= 0) {
      // Free courses enrol directly — never route them through the gateway.
      throw badRequest('This course is free — enrol directly instead of paying', 'course');
    }

    const existing = await queryOne('SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2', [
      req.user!.id,
      course.id,
    ]);
    if (existing) throw conflict('You are already enrolled in this course');

    // Idempotency: a learner who already paid (webhook arrived, tab was closed
    // before verify) should be told so instead of being charged again.
    const prior = await queryOne<{ id: string }>(
      "SELECT id FROM payments WHERE user_id = $1 AND course_id = $2 AND status = 'success'",
      [req.user!.id, course.id],
    );
    if (prior) {
      // The learner paid but was never enrolled (webhook lost, tab closed).
      // Heal that here rather than charging them a second time.
      const enrolled = await queryOne(
        'SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2',
        [req.user!.id, course.id],
      );
      if (!enrolled) {
        await query('INSERT INTO enrollments (user_id, course_id) VALUES ($1, $2)', [
          req.user!.id,
          course.id,
        ]);
        logger.warn('payment_order_repaired', { user_id: req.user!.id, course_id: course.id });
      }
      return res.json({ course_id: course.id, already_paid: true, prior_payment_id: prior.id });
    }

    const amountPaise = Math.round(price * 100);
    const order = await razorpayClient().orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt: `lms-${course.id}-${req.user!.id}-${Date.now()}`,
      notes: { user_id: req.user!.id, course_id: course.id },
    });

    await query(
      `INSERT INTO payments (user_id, course_id, amount, currency, status, razorpay_order_id)
       VALUES ($1, $2, $3, 'INR', 'initiated', $4)`,
      [req.user!.id, course.id, price, order.id],
    );

    res.json({
      course_id: course.id,
      amount: price,
      currency: 'INR',
      order_id: order.id,
      key_id: env.razorpay.keyId,
      course_title: course.title,
    });
  }),
);

// --- POST /courses/:id/payment/verify ------------------------------------

const verifySchema = z.object({
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
});

paymentsRouter.post(
  '/courses/:id/payment/verify',
  authenticate,
  requireRole('student'),
  wrap(async (req, res) => {
    if (!paymentsConfigured()) {
      throw serviceUnavailable('Payments are not configured on this deployment');
    }

    const input = verifySchema.parse(req.body);
    if (!verifyCheckoutSignature(input.razorpay_order_id, input.razorpay_payment_id, input.razorpay_signature)) {
      logger.warn('payment_verify_bad_signature', { course_id: req.params.id, user_id: req.user!.id });
      throw badRequest('Payment signature verification failed');
    }

    const course = await queryOne<CourseRow>(
      'SELECT id, price, status, title FROM courses WHERE id = $1',
      [req.params.id],
    );
    if (!course) throw notFound('Course not found');

    // The order must belong to this learner for this course; otherwise a
    // signature from someone else's checkout could be replayed here.
    const owned = await queryOne(
      'SELECT id FROM payments WHERE razorpay_order_id = $1 AND user_id = $2 AND course_id = $3',
      [input.razorpay_order_id, req.user!.id, course.id],
    );
    if (!owned) throw notFound('No matching payment order for this course');

    const result = await confirmPayment({
      orderId: input.razorpay_order_id,
      paymentId: input.razorpay_payment_id,
      userId: req.user!.id,
      course,
    });

    res.json({
      course_id: course.id,
      paid: true,
      enrolled: result.enrolled,
      already_enrolled: result.alreadyEnrolled,
    });
  }),
);

// --- POST /courses/:id/payment/webhook -----------------------------------

const webhookBodySchema = z.object({
  entity: z.literal('payment'),
  payload: z.object({
    payment: z.object({
      entity: z.object({
        id: z.string(),
        order_id: z.string(),
        status: z.string(),
        amount: z.number(),
        notes: z.record(z.string()).optional(),
      }),
    }),
  }),
});

paymentsRouter.post(
  '/courses/:id/payment/webhook',
  wrap(async (req, res) => {
    // Signature is computed over the exact bytes Razorpay sent, captured by
    // the express.json `verify` hook in app.ts.
    const raw = (req as Request & { rawBody?: Buffer }).rawBody?.toString('utf8') ?? '';
    const signature = req.headers['x-razorpay-signature'] as string | undefined;

    if (!raw) {
      throw badRequest('Empty webhook body');
    }
    if (!verifyWebhookSignature(raw, signature)) {
      logger.warn('payment_webhook_bad_signature', { course_id: req.params.id });
      throw badRequest('Invalid webhook signature');
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      throw badRequest('Webhook body is not valid JSON');
    }

    const parsed = webhookBodySchema.safeParse(parsedJson);
    if (!parsed.success) {
      throw badRequest('Webhook payload did not match the expected Razorpay shape');
    }

    const payment = parsed.data.payload.payment.entity;
    if (payment.status !== 'captured' && payment.status !== 'authorized') {
      // Nothing to act on yet; acknowledge so Razorpay stops retrying.
      return res.json({ received: true, status: payment.status, acted: false });
    }

    const course = await queryOne<CourseRow>(
      'SELECT id, price, status, title FROM courses WHERE id = $1',
      [req.params.id],
    );
    if (!course) throw notFound('Course not found');

    // The buyer is taken from the order notes we set at creation time, never
    // from anything the webhook caller could choose.
    const userId = payment.notes?.user_id;
    if (!userId || payment.notes?.course_id !== course.id) {
      logger.warn('payment_webhook_unmatched', { order_id: payment.order_id, course_id: course.id });
      return res.json({ received: true, status: payment.status, acted: false });
    }

    const result = await confirmPayment({
      orderId: payment.order_id,
      paymentId: payment.id,
      userId,
      course,
    });

    res.json({ received: true, status: 'captured', ...result });
  }),
);

// --- GET /courses/:id/payment/status -------------------------------------

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
      'SELECT id, status, razorpay_order_id FROM payments WHERE user_id = $1 AND course_id = $2 ORDER BY created_at DESC LIMIT 1',
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
      payments_configured: paymentsConfigured(),
      enrolled: Boolean(enrolled),
      payment: payment
        ? { id: payment.id, status: payment.status, order_id: payment.razorpay_order_id }
        : null,
    });
  }),
);

// --- Admin: resend a payment receipt ------------------------------------

const retryEmailSchema = z.object({
  payment_id: z.string().uuid(),
});

paymentsRouter.post(
  '/admin/payments/:payment_id/resend-notice',
  authenticate,
  requireRole('admin'),
  wrap(async (req, res) => {
    retryEmailSchema.parse({ payment_id: req.params.payment_id });

    const payment = await queryOne<{ user_id: string; course_id: string; amount: string | null }>(
      'SELECT user_id, course_id, amount FROM payments WHERE id = $1',
      [req.params.payment_id],
    );
    if (!payment) throw notFound('Payment not found');

    const user = await queryOne<{ email: string; full_name: string }>(
      'SELECT email, full_name FROM users WHERE id = $1',
      [payment.user_id],
    );
    const course = await queryOne<{ title: string }>('SELECT title FROM courses WHERE id = $1', [
      payment.course_id,
    ]);
    if (!user || !course) throw notFound('Related record not found');

    await queueEmail({
      kind: 'generic',
      subject: `Payment receipt for “${course.title}”`,
      body:
        `Hello ${user.full_name},\n\n` +
        `A payment of ₹${Number(payment.amount ?? 0)} was recorded for “${course.title}” on ` +
        `${new Date().toLocaleDateString()}.\n\n` +
        'If you have not enrolled yet, contact support — your enrolment may still be pending.',
      recipients: [user.email],
      cta: { label: 'View course', path: '/catalog' },
    });

    res.json({ payment_id: req.params.payment_id, notice_queued: true });
  }),
);
