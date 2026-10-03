import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import { authenticate, requireRole } from '../../middleware/auth';
import { queryOne } from '../../db/pool';
import { forbidden, notFound } from '../../utils/errors';
import { createAssignmentSchema, gradeSubmissionSchema } from './assignments.schemas';
import * as assignmentsService from './assignments.service';

export const assignmentsRouter = Router();

const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'submissions');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).slice(0, 12);
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

// ---- Listing (enrolled students + owner) ---------------------------------
assignmentsRouter.get(
  '/courses/:id/assignments',
  authenticate,
  wrap(async (req, res) => {
    const course = await queryOne('SELECT id, instructor_id, status FROM courses WHERE id = $1', [
      req.params.id,
    ]);
    if (!course) throw notFound('Course not found');
    const isOwner =
      (course as { instructor_id: string }).instructor_id === req.user!.id ||
      req.user!.roles.includes('admin');
    const enrolled = await queryOne(
      'SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2',
      [req.user!.id, req.params.id],
    );
    if (!isOwner && !enrolled) throw forbidden('You are not enrolled in this course');
    res.json({ items: await assignmentsService.listAssignments(req.params.id, req.user!) });
  }),
);

// ---- Instructor -----------------------------------------------------------
assignmentsRouter.post(
  '/assignments',
  authenticate,
  requireRole('instructor', 'admin'),
  wrap(async (req, res) => {
    const input = createAssignmentSchema.parse(req.body);
    res.status(201).json(await assignmentsService.createAssignment(req.user!, input));
  }),
);

assignmentsRouter.get(
  '/assignments/:id/submissions',
  authenticate,
  requireRole('instructor', 'admin'),
  wrap(async (req, res) => {
    res.json({ items: await assignmentsService.listSubmissions(req.user!, req.params.id) });
  }),
);

assignmentsRouter.put(
  '/submissions/:id/grade',
  authenticate,
  requireRole('instructor', 'admin'),
  wrap(async (req, res) => {
    const input = gradeSubmissionSchema.parse(req.body);
    res.json(
      await assignmentsService.gradeSubmission(req.user!, req.params.id, input.grade, input.feedback),
    );
  }),
);

// ---- Student --------------------------------------------------------------
assignmentsRouter.post(
  '/assignments/:id/submit',
  authenticate,
  requireRole('student'),
  upload.single('file'),
  wrap(async (req, res) => {
    assignmentsService.assertValidFile(req.file);
    res
      .status(201)
      .json(await assignmentsService.submitAssignment(req.user!, req.params.id, req.file!));
  }),
);
