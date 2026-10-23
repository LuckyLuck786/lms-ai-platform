import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth';
import { authRateLimiter } from '../../middleware/rateLimit';
import multer from 'multer';
import * as account from './account.service';
import * as data from './data.service';
import { googleEnabled, signInWithGoogle } from '../auth/google.service';
import { env } from '../../config/env';
import { ensureDir, UPLOAD_TMP } from '../../utils/storage';
import { badRequest } from '../../utils/errors';

/**
 * Self-service account routes. Mounted at /api/v1.
 *
 *   PATCH /users/me                  name, phone, avatar
 *   PUT   /users/me/password         change password (signs out other sessions)
 *   POST  /users/me/email            start an email change (link to the new address)
 *   POST  /auth/verify-email         consume a verification link (public)
 *   POST  /auth/resend-verification  send a fresh link
 *   POST  /auth/forgot-password      email a one-hour reset link (no account enumeration)
 *   POST  /auth/reset-password       set a new password from that link
 *   GET   /auth/providers            which sign-in providers are enabled
 *   POST  /auth/google               sign in / sign up with a Google ID token
 *   POST  /users/me/avatar           upload a profile photo (JPEG/PNG/WebP, 2 MB)
 *   DELETE /users/me/avatar          remove it
 *   GET   /users/me/export           download everything we hold about you (JSON)
 *   DELETE /users/me                 delete your account (pseudonymised)
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

// --- Forgot password ---------------------------------------------------------

const forgotSchema = z.object({ email: z.string().trim().email('email must be a valid email address').max(180) });

accountRouter.post(
  '/auth/forgot-password',
  authRateLimiter,
  wrap(async (req, res) => {
    const input = forgotSchema.parse(req.body);
    res.json(await account.requestPasswordReset(input.email));
  }),
);

const resetSchema = z.object({ token: z.string().min(20).max(200), new_password: password });

accountRouter.post(
  '/auth/reset-password',
  authRateLimiter,
  wrap(async (req, res) => {
    const input = resetSchema.parse(req.body);
    res.json(await account.resetPassword(input.token, input.new_password));
  }),
);

// --- Sign in with Google -----------------------------------------------------

accountRouter.get(
  '/auth/providers',
  wrap(async (_req, res) => {
    res.json({ google_client_id: googleEnabled() ? env.google.clientId : null });
  }),
);

const googleSchema = z.object({ credential: z.string().min(20).max(5000) });

accountRouter.post(
  '/auth/google',
  authRateLimiter,
  wrap(async (req, res) => {
    const input = googleSchema.parse(req.body);
    res.json(await signInWithGoogle(input.credential));
  }),
);

// --- Profile photo -------------------------------------------------------------

const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      ensureDir(UPLOAD_TMP);
      cb(null, UPLOAD_TMP);
    },
  }),
  limits: { fileSize: data.AVATAR_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (data.AVATAR_TYPES.has(file.mimetype)) cb(null, true);
    else cb(badRequest('Profile photos must be JPEG, PNG or WebP', 'avatar'));
  },
});

accountRouter.post(
  '/users/me/avatar',
  authenticate,
  (req, res, next) =>
    avatarUpload.single('avatar')(req, res, (err: unknown) => {
      if ((err as { code?: string })?.code === 'LIMIT_FILE_SIZE') {
        return next(badRequest('Profile photos must be 2 MB or smaller', 'avatar'));
      }
      next(err);
    }),
  wrap(async (req, res) => {
    if (!req.file) throw badRequest('Attach an image in the avatar field', 'avatar');
    res.json(await data.setAvatar(req.user!.id, req.file));
  }),
);

accountRouter.delete(
  '/users/me/avatar',
  authenticate,
  wrap(async (req, res) => {
    res.json(await data.removeAvatar(req.user!.id));
  }),
);

// --- Data rights ------------------------------------------------------------

accountRouter.get(
  '/users/me/export',
  authenticate,
  wrap(async (req, res) => {
    const payload = await data.exportMyData(req.user!.id);
    res.setHeader('Content-Disposition', 'attachment; filename="vertexon-my-data.json"');
    res.json(payload);
  }),
);

const deleteSchema = z.object({ confirm: z.string(), password: z.string().max(128).optional() });

accountRouter.delete(
  '/users/me',
  authRateLimiter,
  authenticate,
  wrap(async (req, res) => {
    const input = deleteSchema.parse(req.body ?? {});
    res.json(await data.deleteMyAccount(req.user!.id, input));
  }),
);
