import { api, apiErrorMessage, DEMO_MODE } from './api';

/**
 * Razorpay Checkout driver (PRD §15 item 4).
 *
 * Two-step flow, matching the backend:
 *   1. `POST /courses/:id/payment/order` creates an order server-side and
 *      returns the public key id the browser needs.
 *   2. Razorpay Checkout collects the card. On success we post the signed
 *      result to `/payment/verify`, which is what actually enrols the learner.
 *      The gateway's webhook repeats that confirmation for anyone who closes
 *      the tab first, so both paths agree.
 *
 * In demo mode there is no gateway to talk to, so the order response is tagged
 * `simulated` and we skip straight to verify — the in-browser backend accepts
 * it and enrols, so the purchase journey stays explorable on a static site.
 */

interface RazorpayCheckoutOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description?: string;
  order_id: string;
  handler: (response: {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  }) => void;
  modal?: { ondismiss?: () => void };
  theme?: { color?: string };
}

interface RazorpayInstance {
  open: () => void;
  on: (event: string, handler: (payload: unknown) => void) => void;
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => RazorpayInstance;
  }
}

const CHECKOUT_SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js';

/** Load the Razorpay modal script once, and never twice. */
let scriptPromise: Promise<void> | null = null;

function loadCheckoutScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const el = document.createElement('script');
    el.src = CHECKOUT_SCRIPT;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () =>
      reject(new Error('Could not load the payment gateway — check your connection and try again.'));
    document.head.appendChild(el);
  }).catch((err) => {
    // Allow a later attempt to retry the load instead of caching the failure.
    scriptPromise = null;
    throw err;
  });
  return scriptPromise;
}

export interface CheckoutOrder {
  course_id: string;
  amount: number;
  currency: string;
  order_id: string;
  key_id: string;
  course_title?: string;
  simulated?: boolean;
  already_paid?: boolean;
}

export class CheckoutCancelled extends Error {
  constructor() {
    super('Checkout was cancelled');
    this.name = 'CheckoutCancelled';
  }
}

/**
 * Run the full purchase flow for one course.
 *
 * Resolves once the learner is enrolled. Rejects with `CheckoutCancelled` when
 * they dismiss the gateway (a normal outcome, not an error to shout about) and
 * with a plain `Error` carrying a friendly message otherwise.
 */
export async function purchaseCourse(courseId: string): Promise<void> {
  let order: CheckoutOrder;
  try {
    order = (await api.post<CheckoutOrder>(`/courses/${courseId}/payment/order`, {})).data;
  } catch (err) {
    throw new Error(apiErrorMessage(err));
  }

  // Already paid on a previous visit — the backend heals the enrolment, so
  // there is nothing left to charge for.
  if (order.already_paid) return;

  if (DEMO_MODE || order.simulated) {
    await confirmOrder(courseId, {
      razorpay_order_id: order.order_id,
      razorpay_payment_id: `pay_demo_${Date.now()}`,
      razorpay_signature: 'demo',
    });
    return;
  }

  await loadCheckoutScript();
  const Razorpay = window.Razorpay;
  if (!Razorpay) {
    throw new Error('Could not load the payment gateway — check your connection and try again.');
  }

  const result = await new Promise<{
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  }>((resolve, reject) => {
    const checkout = new Razorpay({
      key: order.key_id,
      amount: Math.round(order.amount * 100),
      currency: order.currency,
      name: 'Vertexon LMS-AI',
      description: order.course_title,
      order_id: order.order_id,
      handler: resolve,
      modal: { ondismiss: () => reject(new CheckoutCancelled()) },
      theme: { color: '#1e3a5f' },
    });
    checkout.on('payment.failed', () => reject(new Error('The payment was declined.')));
    checkout.open();
  });

  await confirmOrder(courseId, result);
}

/** Server-side signature check; this is what creates the enrolment. */
async function confirmOrder(
  courseId: string,
  payload: {
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
  },
): Promise<void> {
  try {
    await api.post(`/courses/${courseId}/payment/verify`, payload);
  } catch (err) {
    // The payment may still settle via the webhook even if this call failed,
    // so the message points at the dashboard rather than declaring failure.
    throw new Error(
      `${apiErrorMessage(err)} — if you were charged, your enrolment will appear on your dashboard shortly.`,
    );
  }
}
