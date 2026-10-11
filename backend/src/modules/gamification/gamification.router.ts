import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/auth';
import { query, queryOne } from '../../db/pool';
import { notFound } from '../../utils/errors';
import { getUserBadges } from '../../utils/badges';
import { getStreak, touchStreak } from './gamification.service';
import { buildCertificatePdf, certificateSerial } from '../../utils/certificate';
import { env } from '../../config/env';
import { cacheGet, cacheSet } from '../../db/redis';

export const gamificationRouter = Router();

// PRD §9.4: leaderboard reads are cached for 60 seconds.
const LEADERBOARD_CACHE_TTL = 60;

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

// GET /users/me/streak — current + longest streak (FR-S9)
gamificationRouter.get(
  '/users/me/streak',
  authenticate,
  wrap(async (req, res) => {
    res.json(await getStreak(req.user!.id));
  }),
);

// POST /users/me/activity — record a learning activity day (called by the UI)
gamificationRouter.post(
  '/users/me/activity',
  authenticate,
  wrap(async (req, res) => {
    res.json(await touchStreak(req.user!.id));
  }),
);

// GET /users/me/badges — earned badges
gamificationRouter.get(
  '/users/me/badges',
  authenticate,
  wrap(async (req, res) => {
    res.json({ items: await getUserBadges(req.user!.id) });
  }),
);

// GET /users/me/certificates — my certificates (FR-S8)
gamificationRouter.get(
  '/users/me/certificates',
  authenticate,
  wrap(async (req, res) => {
    const rows = await query<{ id: string; issued_at: Date; certificate_url: string | null; course_title: string }>(
      `SELECT c.id, c.issued_at, c.certificate_url, co.title AS course_title
       FROM certificates c JOIN courses co ON co.id = c.course_id
       WHERE c.user_id = $1 ORDER BY c.issued_at DESC`,
      [req.user!.id],
    );
    const items = rows.map((r) => ({
      ...r,
      serial: certificateSerial(r.id, new Date(r.issued_at)),
    }));
    res.json({ items });
  }),
);

interface CertificateRow {
  id: string;
  user_id: string;
  issued_at: Date;
  student_name: string;
  course_title: string;
  instructor_name: string | null;
}

async function loadCertificate(id: string): Promise<CertificateRow | null> {
  return queryOne<CertificateRow>(
    `SELECT c.id, c.user_id, c.issued_at,
            u.full_name AS student_name,
            co.title AS course_title,
            i.full_name AS instructor_name
     FROM certificates c
     JOIN users u ON u.id = c.user_id
     JOIN courses co ON co.id = c.course_id
     LEFT JOIN users i ON i.id = co.instructor_id
     WHERE c.id = $1`,
    [id],
  );
}

// GET /certificates/verify/:id — PUBLIC authenticity check (no auth).
// Powers the QR code on the PDF and the /verify/:id page on the frontend.
gamificationRouter.get(
  '/certificates/verify/:id',
  wrap(async (req, res) => {
    const cert = await loadCertificate(req.params.id);
    if (!cert) {
      res.status(404).json({ valid: false, reason: 'NOT_FOUND' });
      return;
    }
    const issuedAt = new Date(cert.issued_at);
    res.json({
      valid: true,
      certificate_id: cert.id,
      serial: certificateSerial(cert.id, issuedAt),
      student_name: cert.student_name,
      course_title: cert.course_title,
      instructor_name: cert.instructor_name,
      issued_at: issuedAt.toISOString(),
    });
  }),
);

// GET /certificates/:id/download — PDF download (owner or admin).
// The PDF is rendered on demand from the database record so downloads work on
// any stateless Cloud Run instance (no reliance on container-local files).
gamificationRouter.get(
  '/certificates/:id/download',
  authenticate,
  wrap(async (req, res) => {
    const cert = await loadCertificate(req.params.id);
    if (!cert) throw notFound('Certificate not found');
    if (cert.user_id !== req.user!.id && !req.user!.roles.includes('admin')) {
      throw notFound('Certificate not found');
    }
    const bytes = await buildCertificatePdf({
      certificateId: cert.id,
      studentName: cert.student_name,
      courseTitle: cert.course_title,
      issuedAt: new Date(cert.issued_at),
      instructorName: cert.instructor_name ?? undefined,
      verifyBaseUrl: env.smtp.appUrl,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="certificate-${cert.id}.pdf"`);
    res.send(Buffer.from(bytes));
  }),
);

// GET /leaderboard/:courseId — engagement leaderboard (PRD §8.6)
gamificationRouter.get(
  '/leaderboard/:courseId',
  authenticate,
  wrap(async (req, res) => {
    const cacheKey = `leaderboard:${req.params.courseId}`;
    const cached = await cacheGet<{ items: unknown[] }>(cacheKey);
    if (cached) {
      res.json({ ...cached, cached: true });
      return;
    }

    const rows = await query(
      `SELECT u.id AS user_id, u.full_name,
              e.progress_percent,
              COALESCE(SUM(qa.score), 0)::float AS total_quiz_score,
              COALESCE(COUNT(qa.id), 0)::int AS quizzes_taken
       FROM enrollments e
       JOIN users u ON u.id = e.user_id
       LEFT JOIN quiz_attempts qa ON qa.user_id = u.id
         AND qa.quiz_id IN (
           SELECT q.id FROM quizzes q
           JOIN modules m ON m.id = q.module_id
           WHERE m.course_id = e.course_id
         )
       WHERE e.course_id = $1
       GROUP BY u.id, u.full_name, e.progress_percent
       ORDER BY e.progress_percent DESC, total_quiz_score DESC
       LIMIT 50`,
      [req.params.courseId],
    );
    const payload = { items: rows };
    await cacheSet(cacheKey, payload, LEADERBOARD_CACHE_TTL);
    res.json(payload);
  }),
);
