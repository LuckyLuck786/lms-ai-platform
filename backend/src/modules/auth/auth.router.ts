import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/auth';
import { authRateLimiter } from '../../middleware/rateLimit';
import { loginSchema, logoutSchema, refreshSchema, registerSchema } from './auth.schemas';
import * as authService from './auth.service';

export const authRouter = Router();

// 10 requests/minute/IP on every /auth/* endpoint (PRD §8.9)
authRouter.use(authRateLimiter);

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

authRouter.post(
  '/register',
  wrap(async (req, res) => {
    const input = registerSchema.parse(req.body);
    res.status(201).json(await authService.register(input));
  }),
);

authRouter.post(
  '/login',
  wrap(async (req, res) => {
    const input = loginSchema.parse(req.body);
    res.status(200).json(await authService.login(input));
  }),
);

authRouter.post(
  '/refresh',
  wrap(async (req, res) => {
    const input = refreshSchema.parse(req.body);
    res.status(200).json(await authService.refresh(input.refresh_token));
  }),
);

authRouter.post(
  '/logout',
  wrap(async (req, res) => {
    const input = logoutSchema.parse(req.body);
    res.status(200).json(await authService.logout(input.refresh_token));
  }),
);

authRouter.get(
  '/me',
  authenticate,
  wrap(async (req, res) => {
    res.status(200).json(await authService.getMe(req.user!.id));
  }),
);
