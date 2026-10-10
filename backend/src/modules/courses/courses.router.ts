import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, optionalAuthenticate, requireRole } from '../../middleware/auth';
import { approveCourseSchema, catalogQuerySchema, createCourseSchema, createLectureSchema, createModuleSchema, updateCourseSchema } from './courses.schemas';
import * as coursesService from './courses.service';

export const coursesRouter = Router();

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

// ---- Public catalog (no auth required) ----------------------------------
coursesRouter.get(
  '/',
  optionalAuthenticate,
  wrap(async (req, res) => {
    const q = catalogQuerySchema.parse(req.query);
    res.json(await coursesService.listCatalog(q, req.user));
  }),
);

coursesRouter.get(
  '/:id',
  optionalAuthenticate,
  wrap(async (req, res) => {
    res.json(await coursesService.getCourseDetail(req.params.id, req.user));
  }),
);

// ---- Instructor authoring -----------------------------------------------
coursesRouter.post(
  '/',
  authenticate,
  requireRole('instructor', 'admin'),
  wrap(async (req, res) => {
    const input = createCourseSchema.parse(req.body);
    res.status(201).json(await coursesService.createCourse(req.user!, input));
  }),
);

coursesRouter.put(
  '/:id',
  authenticate,
  requireRole('instructor', 'admin'),
  wrap(async (req, res) => {
    const input = updateCourseSchema.parse(req.body);
    res.json(await coursesService.updateCourse(req.user!, req.params.id, input));
  }),
);

// ---- Instructor analytics (FR-I5: drop-off, quiz scores, time-on-task) ----
coursesRouter.get(
  '/:id/analytics',
  authenticate,
  requireRole('instructor', 'admin'),
  wrap(async (req, res) => {
    res.json(await coursesService.getCourseAnalytics(req.user!, req.params.id));
  }),
);

coursesRouter.post(
  '/:id/modules',
  authenticate,
  requireRole('instructor', 'admin'),
  wrap(async (req, res) => {
    const input = createModuleSchema.parse(req.body);
    res.status(201).json(await coursesService.addModule(req.user!, req.params.id, input));
  }),
);

// ---- Admin approval workflow (FR-AD1) -----------------------------------
coursesRouter.post(
  '/:id/approve',
  authenticate,
  requireRole('admin'),
  wrap(async (req, res) => {
    const input = approveCourseSchema.parse(req.body);
    res.json(await coursesService.approveCourse(req.user!, req.params.id, input));
  }),
);
