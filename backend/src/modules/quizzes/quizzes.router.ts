import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, requireRole } from '../../middleware/auth';
import { createQuizSchema, startAttemptSchema, submitAttemptSchema } from './quizzes.schemas';
import * as quizzesService from './quizzes.service';

export const quizzesRouter = Router();

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

// ---- Instructor: manual quiz builder (FR-S7) ------------------------------
quizzesRouter.post(
  '/',
  authenticate,
  requireRole('instructor', 'admin'),
  wrap(async (req, res) => {
    const input = createQuizSchema.parse(req.body);
    res.status(201).json(await quizzesService.createQuiz(req.user!, input));
  }),
);

// ---- Shared ---------------------------------------------------------------
quizzesRouter.get(
  '/:id',
  authenticate,
  wrap(async (req, res) => {
    res.json(await quizzesService.getQuiz(req.params.id, req.user!));
  }),
);

// ---- Student attempt flow -------------------------------------------------
quizzesRouter.post(
  '/:id/attempt',
  authenticate,
  requireRole('student'),
  wrap(async (req, res) => {
    startAttemptSchema.parse(req.body ?? {});
    res.status(201).json(await quizzesService.startAttempt(req.user!, req.params.id));
  }),
);

// Mounted at /attempts/:id/submit via the root router (see app.ts).
export const attemptsRouter = Router();

attemptsRouter.post(
  '/attempts/:id/submit',
  authenticate,
  requireRole('student'),
  wrap(async (req, res) => {
    const input = submitAttemptSchema.parse(req.body);
    res.json(await quizzesService.submitAttempt(req.user!, req.params.id, input));
  }),
);

attemptsRouter.get(
  '/attempts/:id',
  authenticate,
  wrap(async (req, res) => {
    res.json(await quizzesService.getAttempt(req.user!, req.params.id));
  }),
);
