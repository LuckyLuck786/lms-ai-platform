import { query, queryOne } from '../../db/pool';
import { triggerIngestion } from '../ai/ai.router';
import { cacheDel, cacheGet, cacheSet } from '../../db/redis';
import { badRequest, conflict, forbidden, notFound } from '../../utils/errors';
import { AuthUser, hasRole } from '../../middleware/auth';
import { completionRate, decorateLectureStat, LectureStatRow } from './analytics';
import {
  ApproveCourseInput,
  CatalogQuery,
  CreateCourseInput,
  CreateLectureInput,
  CreateModuleInput,
} from './courses.schemas';

const CATALOG_CACHE_TTL = 300; // 5 minutes (PRD §9.4)
const catalogCacheKey = (q: CatalogQuery, role: string) =>
  `catalog:${role}:q=${q.q ?? ''}:cat=${q.category ?? ''}:diff=${q.difficulty ?? ''}:p=${q.page}:l=${q.limit}:mine=${q.mine ?? ''}`;

async function invalidateCatalogCache(): Promise<void> {
  await cacheDel('catalog:*');
}

export async function listCatalog(q: CatalogQuery, user?: AuthUser) {
  const visibility = hasRole(user, 'instructor', 'admin') ? '%' : 'approved';
  const cacheKey = catalogCacheKey(
    q,
    q.mine && user ? `mine:${user.id}` : visibility === '%' ? 'staff' : 'public',
  );

  const cached = await cacheGet<{ items: unknown[]; total: number; page: number; limit: number }>(
    cacheKey,
  );
  if (cached) return { ...cached, cached: true };

  const where: string[] = ['c.status LIKE $1'];
  const params: unknown[] = [visibility];
  if (q.mine && user) {
    params.push(user.id);
    where.push(`c.instructor_id = $${params.length}`);
  }
  if (q.q) {
    params.push(`%${q.q}%`);
    where.push(`(c.title ILIKE $${params.length} OR c.description ILIKE $${params.length})`);
  }
  if (q.category) {
    params.push(q.category);
    where.push(`c.category = $${params.length}`);
  }
  if (q.difficulty) {
    params.push(q.difficulty);
    where.push(`c.difficulty = $${params.length}`);
  }

  const offset = (q.page - 1) * q.limit;
  params.push(q.limit, offset);

  const items = await query(
    `SELECT c.id, c.title, c.description, c.category, c.difficulty, c.thumbnail_url,
            c.price, c.status, c.created_at,
            u.full_name AS instructor_name,
            COALESCE(e.enrollment_count, 0)::int AS enrollment_count,
            COALESCE(a.avg_rating, 0)::float AS avg_rating
     FROM courses c
     JOIN users u ON u.id = c.instructor_id
     LEFT JOIN LATERAL (
       SELECT count(*)::int AS enrollment_count FROM enrollments WHERE course_id = c.id
     ) e ON TRUE
     LEFT JOIN LATERAL (
       SELECT avg(score) AS avg_rating FROM quiz_attempts qa
       JOIN quizzes qz ON qz.id = qa.quiz_id
       JOIN modules m ON m.id = qz.module_id
       WHERE m.course_id = c.id AND qa.score IS NOT NULL
     ) a ON TRUE
     WHERE ${where.join(' AND ')}
     ORDER BY c.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  const countParams = params.slice(0, params.length - 2);
  const countRow = await queryOne<{ count: string }>(
    `SELECT count(*)::text AS count FROM courses c WHERE ${where.join(' AND ')}`,
    countParams,
  );
  const total = Number(countRow?.count ?? 0);

  const payload = { items, total, page: q.page, limit: q.limit };
  await cacheSet(cacheKey, payload, CATALOG_CACHE_TTL);
  return payload;
}

export async function getCourseDetail(id: string, user?: AuthUser) {
  const course = await queryOne(
    `SELECT c.*, u.full_name AS instructor_name, u.email AS instructor_email
     FROM courses c JOIN users u ON u.id = c.instructor_id WHERE c.id = $1`,
    [id],
  );
  if (!course) throw notFound('Course not found');

  const isOwner = user?.id === (course as { instructor_id: string }).instructor_id;
  const visible =
    (course as { status: string }).status === 'approved' || isOwner || hasRole(user, 'admin');
  if (!visible) throw notFound('Course not found');

  const modules = await query(
    `SELECT id, title, order_index FROM modules WHERE course_id = $1 ORDER BY order_index, title`,
    [id],
  );
  const moduleIds = modules.map((m) => (m as { id: string }).id);
  const lectures = moduleIds.length
    ? await query(
        `SELECT id, module_id, title, video_url, duration_seconds, order_index, resource_urls
         FROM lectures WHERE module_id = ANY($1) ORDER BY order_index, title`,
        [moduleIds],
      )
    : [];
  const quizzes = moduleIds.length
    ? await query(
        `SELECT id, module_id, title,
                (SELECT count(*)::int FROM quiz_questions WHERE quiz_id = quizzes.id) AS question_count
         FROM quizzes WHERE module_id = ANY($1) ORDER BY title`,
        [moduleIds],
      )
    : [];
  const assignments = await query(
    `SELECT id, title, instructions, due_date FROM assignments WHERE course_id = $1 ORDER BY due_date NULLS LAST`,
    [id],
  );

  return {
    ...course,
    assignments,
    modules: modules.map((m) => ({
      ...(m as object),
      lectures: lectures.filter((l) => (l as { module_id: string }).module_id === (m as { id: string }).id),
      quizzes: quizzes.filter((q) => (q as { module_id: string }).module_id === (m as { id: string }).id),
    })),
  };
}

async function getOwnedCourse(courseId: string, user: AuthUser, adminOverride = true) {
  const course = await queryOne<{ id: string; instructor_id: string; status: string }>(
    'SELECT id, instructor_id, status FROM courses WHERE id = $1',
    [courseId],
  );
  if (!course) throw notFound('Course not found');
  const allowed = course.instructor_id === user.id || (adminOverride && hasRole(user, 'admin'));
  if (!allowed) throw forbidden('You do not own this course');
  return course;
}

/**
 * GET /courses/:id/analytics — instructor analytics dashboard (FR-I5):
 * per-lecture drop-off, average quiz scores, and time-on-task, scoped to the
 * course owner (or an admin).
 */
export async function getCourseAnalytics(user: AuthUser, courseId: string) {
  await getOwnedCourse(courseId, user);

  const overview = await queryOne<{
    enrollments: number;
    active_learners: number;
    completed_learners: number;
    avg_progress_percent: number;
  }>(
    `SELECT COUNT(DISTINCT e.user_id)::int AS enrollments,
            COUNT(DISTINCT e.user_id) FILTER (WHERE e.progress_percent > 0)::int AS active_learners,
            COUNT(DISTINCT e.user_id) FILTER (WHERE e.progress_percent >= 100)::int AS completed_learners,
            COALESCE(ROUND(AVG(e.progress_percent)::numeric, 1), 0)::float AS avg_progress_percent
     FROM enrollments e WHERE e.course_id = $1`,
    [courseId],
  );

  const quizTotals = await queryOne<{ attempts: number; avg_quiz_score: number | null }>(
    `SELECT COUNT(qa.id)::int AS attempts,
            AVG(qa.score)::float AS avg_quiz_score
     FROM quiz_attempts qa
     JOIN quizzes q ON q.id = qa.quiz_id
     JOIN modules m ON m.id = q.module_id
     WHERE m.course_id = $1 AND qa.submitted_at IS NOT NULL AND qa.score IS NOT NULL`,
    [courseId],
  );

  const timeOnTask = await queryOne<{ watch_seconds: number }>(
    `SELECT COALESCE(SUM(lp.watched_seconds), 0)::int AS watch_seconds
     FROM lecture_progress lp
     JOIN enrollments e ON e.id = lp.enrollment_id
     WHERE e.course_id = $1`,
    [courseId],
  );

  const lectureRows = await query<LectureStatRow>(
    `SELECT l.id, l.title, m.title AS module_title, l.duration_seconds,
            COUNT(lp.id)::int AS learners,
            COUNT(lp.id) FILTER (WHERE lp.completed)::int AS completions,
            COALESCE(AVG(lp.watched_seconds), 0)::float AS avg_watched_seconds
     FROM lectures l
     JOIN modules m ON m.id = l.module_id
     LEFT JOIN lecture_progress lp ON lp.lecture_id = l.id
     WHERE m.course_id = $1
     GROUP BY l.id, l.title, m.title, l.duration_seconds, m.order_index, l.order_index
     ORDER BY m.order_index, l.order_index`,
    [courseId],
  );

  const quizRows = await query<{
    id: string;
    title: string;
    module_title: string;
    attempts: number;
    learners: number;
    avg_score: number | null;
  }>(
    `SELECT q.id, q.title, m.title AS module_title,
            COUNT(qa.id)::int AS attempts,
            COUNT(DISTINCT qa.user_id)::int AS learners,
            AVG(qa.score)::float AS avg_score
     FROM quizzes q
     JOIN modules m ON m.id = q.module_id
     LEFT JOIN quiz_attempts qa ON qa.quiz_id = q.id AND qa.submitted_at IS NOT NULL
     WHERE m.course_id = $1
     GROUP BY q.id, q.title, m.title, m.order_index
     ORDER BY m.order_index, q.title`,
    [courseId],
  );

  const enrollments = overview?.enrollments ?? 0;
  const watchSeconds = timeOnTask?.watch_seconds ?? 0;

  return {
    course_id: courseId,
    overview: {
      enrollments,
      active_learners: overview?.active_learners ?? 0,
      completion_rate: completionRate(overview?.completed_learners ?? 0, enrollments),
      avg_progress_percent: Number(overview?.avg_progress_percent ?? 0),
      avg_quiz_score: Math.round(Number(quizTotals?.avg_quiz_score ?? 0) * 100) / 100,
      attempts: quizTotals?.attempts ?? 0,
      watch_hours: Math.round((watchSeconds / 3600) * 100) / 100,
    },
    lectures: lectureRows.map(decorateLectureStat),
    quizzes: quizRows.map((q) => ({ ...q, avg_score: Math.round(Number(q.avg_score ?? 0) * 100) / 100 })),
  };
}

export async function createCourse(user: AuthUser, input: CreateCourseInput) {
  const course = await queryOne(
    `INSERT INTO courses (instructor_id, title, description, category, difficulty, thumbnail_url, price, status)
     VALUES ($1, $2, $3, $4, $5, NULLIF($6, ''), $7, 'pending')
     RETURNING *`,
    [
      user.id,
      input.title,
      input.description ?? null,
      input.category ?? null,
      input.difficulty ?? null,
      input.thumbnail_url ?? '',
      input.price ?? 0,
    ],
  );
  await invalidateCatalogCache();
  return course;
}

export async function updateCourse(user: AuthUser, courseId: string, input: Partial<CreateCourseInput>) {
  await getOwnedCourse(courseId, user);
  const updated = await queryOne(
    `UPDATE courses SET
       title = COALESCE($2, title),
       description = COALESCE($3, description),
       category = COALESCE($4, category),
       difficulty = COALESCE($5, difficulty),
       thumbnail_url = COALESCE(NULLIF($6, ''), thumbnail_url),
       price = COALESCE($7, price)
     WHERE id = $1 RETURNING *`,
    [
      courseId,
      input.title ?? null,
      input.description ?? null,
      input.category ?? null,
      input.difficulty ?? null,
      input.thumbnail_url ?? null,
      input.price ?? null,
    ],
  );
  await invalidateCatalogCache();
  return updated;
}

export async function addModule(user: AuthUser, courseId: string, input: CreateModuleInput) {
  await getOwnedCourse(courseId, user);
  const next = await queryOne<{ next: number }>(
    'SELECT COALESCE(MAX(order_index), -1) + 1 AS next FROM modules WHERE course_id = $1',
    [courseId],
  );
  const module = await queryOne(
    'INSERT INTO modules (course_id, title, order_index) VALUES ($1, $2, $3) RETURNING *',
    [courseId, input.title, input.order_index ?? next?.next ?? 0],
  );
  await invalidateCatalogCache();
  return module;
}

export async function addLecture(user: AuthUser, moduleId: string, input: CreateLectureSchemaInput) {
  const mod = await queryOne<{ course_id: string }>('SELECT course_id FROM modules WHERE id = $1', [
    moduleId,
  ]);
  if (!mod) throw notFound('Module not found');
  await getOwnedCourse(mod.course_id, user);

  const next = await queryOne<{ next: number }>(
    'SELECT COALESCE(MAX(order_index), -1) + 1 AS next FROM lectures WHERE module_id = $1',
    [moduleId],
  );
  const lecture = await queryOne(
    `INSERT INTO lectures (module_id, title, video_url, transcript, duration_seconds, order_index, resource_urls)
     VALUES ($1, $2, NULLIF($3, ''), $4, $5, $6, $7) RETURNING *`,
    [
      moduleId,
      input.title,
      input.video_url ?? '',
      input.transcript ?? null,
      input.duration_seconds ?? null,
      input.order_index ?? next?.next ?? 0,
      input.resource_urls ?? [],
    ],
  );
  await invalidateCatalogCache();

  // Background ingestion: chunk + embed the transcript into pgvector (Phase 3).
  if (lecture && input.transcript) {
    void triggerIngestion((lecture as { id: string }).id);
  }
  return lecture;
}

export async function approveCourse(admin: AuthUser, courseId: string, input: ApproveCourseInput) {
  const course = await queryOne<{ id: string; status: string }>(
    'SELECT id, status FROM courses WHERE id = $1',
    [courseId],
  );
  if (!course) throw notFound('Course not found');
  if (!['approved', 'rejected'].includes(input.decision)) {
    throw badRequest('decision must be approved or rejected', 'decision');
  }

  const updated = await queryOne(
    'UPDATE courses SET status = $2 WHERE id = $1 RETURNING *',
    [courseId, input.decision],
  );
  await query(
    `INSERT INTO course_approvals (course_id, reviewed_by, decision, comment)
     VALUES ($1, $2, $3, $4)`,
    [courseId, admin.id, input.decision, input.comment ?? null],
  );
  await invalidateCatalogCache();
  return updated;
}

export async function listPendingCourses() {
  return query(
    `SELECT c.*, u.full_name AS instructor_name,
            (SELECT count(*)::int FROM modules WHERE course_id = c.id) AS module_count
     FROM courses c JOIN users u ON u.id = c.instructor_id
     WHERE c.status = 'pending'
     ORDER BY c.created_at ASC`,
  );
}

type CreateLectureSchemaInput = CreateLectureInput;
