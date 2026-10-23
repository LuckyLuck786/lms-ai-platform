import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth';
import { authRateLimiter } from '../../middleware/rateLimit';
import * as account from './account.service';

/**
 * Self-service account routes. Mounted at /api/v1.
 *
 *   PATCH /users/me                  name, phone, avatar
 *   PUT   /users/me/password         change password (signs out other sessions)
 *   POST  /users/me/email            start an email change (link to the new address)
 *   POST  /auth/verify-email         consume a verification link (public)
 *   POST  /auth/resend-verification  send a fresh link
 *
 * Every route that sends email or checks a password sits behind the
 * 10/min/IP auth limiter.
 */
export const accountRouter = Router();

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

const password = z.string().min(8, 'password must be at least 8 characters').max(128);

const profileSchema = z
  .object({
    full_name: z.string().trim().min(2, 'full_name must be at least 2 characters').max(150).optional(),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9 ()-]{7,20}$/, 'phone must be a valid phone number')
      .nullable()
      .optional()
      .or(z.literal('').transform(() => null)),
    avatar_url: z.string().url('avatar_url must be a URL').max(2000).nullable().optional().or(z.literal('')),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing to update' });

accountRouter.patch(
  '/users/me',
  authenticate,
  wrap(async (req, res) => {
    const input = profileSchema.parse(req.body);
    res.json(await account.updateProfile(req.user!.id, input));
  }),
);

const passwordSchema = z.object({ current_password: z.string().min(1), new_password: password });

accountRouter.put(
  '/users/me/password',
  authRateLimiter,
  authenticate,
  wrap(async (req, res) => {
    const input = passwordSchema.parse(req.body);
    res.json(await account.changePassword(req.user!.id, input.current_password, input.new_password));
  }),
);

const emailChangeSchema = z.object({
  new_email: z.string().trim().email('new_email must be a valid email address').max(180),
  password: z.string().min(1),
});

accountRouter.post(
  '/users/me/email',
  authRateLimiter,
  authenticate,
  wrap(async (req, res) => {
    const input = emailChangeSchema.parse(req.body);
    res.json(await account.requestEmailChange(req.user!.id, input.new_email, input.password));
  }),
);

const verifySchema = z.object({ token: z.string().min(20).max(200) });

accountRouter.post(
  '/auth/verify-email',
  authRateLimiter,
  wrap(async (req, res) => {
    const input = verifySchema.parse(req.body);
    res.json(await account.verifyEmail(input.token));
  }),
);

accountRouter.post(
  '/auth/resend-verification',
  authRateLimiter,
  authenticate,
  wrap(async (req, res) => {
    res.json(await account.resendVerification(req.user!.id));
  }),
);
