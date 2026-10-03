import { query, queryOne, pool } from '../pool';
import { hashPassword } from '../../utils/password';

/**
 * Demo data seeder (`npm run seed`). Idempotent: re-running upserts by
 * natural key instead of duplicating rows.
 *
 * Creates: admin + instructor + 2 students, an approved course with 2
 * modules / 4 lectures (with transcripts for the AI tutor), a quiz,
 * enrollments with progress, a thread + posts, an announcement, streaks
 * and sample notifications.
 */

async function upsertUser(fullName: string, email: string, role: string): Promise<string> {
  const password_hash = await hashPassword('DemoPass123!');
  const existing = await queryOne<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]);
  let userId: string;
  if (existing) {
    userId = existing.id;
  } else {
    const row = await queryOne<{ id: string }>(
      'INSERT INTO users (full_name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
      [fullName, email, password_hash],
    );
    userId = row!.id;
  }
  // Ensure exactly this role
  await query(
    `INSERT INTO user_roles (user_id, role_id)
     SELECT $1, id FROM roles WHERE name = $2
     ON CONFLICT (user_id, role_id) DO NOTHING`,
    [userId, role],
  );
  return userId;
}

async function upsertCourse(
  instructorId: string,
  title: string,
  description: string,
  category: string,
  difficulty: string,
): Promise<string> {
  const existing = await queryOne<{ id: string }>('SELECT id FROM courses WHERE title = $1 AND instructor_id = $2', [
    title,
    instructorId,
  ]);
  if (existing) return existing.id;
  const row = await queryOne<{ id: string }>(
    `INSERT INTO courses (instructor_id, title, description, category, difficulty, price, status)
     VALUES ($1, $2, $3, $4, $5, 0, 'approved') RETURNING id`,
    [instructorId, title, description, category, difficulty],
  );
  return row!.id;
}

async function upsertModule(courseId: string, title: string, orderIndex: number): Promise<string> {
  const existing = await queryOne<{ id: string }>('SELECT id FROM modules WHERE course_id = $1 AND title = $2', [
    courseId,
    title,
  ]);
  if (existing) return existing.id;
  const row = await queryOne<{ id: string }>(
    'INSERT INTO modules (course_id, title, order_index) VALUES ($1, $2, $3) RETURNING id',
    [courseId, title, orderIndex],
  );
  return row!.id;
}

async function upsertLecture(
  moduleId: string,
  title: string,
  duration: number,
  orderIndex: number,
  transcript?: string,
): Promise<string> {
  const existing = await queryOne<{ id: string }>('SELECT id FROM lectures WHERE module_id = $1 AND title = $2', [
    moduleId,
    title,
  ]);
  if (existing) return existing.id;
  const row = await queryOne<{ id: string }>(
    `INSERT INTO lectures (module_id, title, duration_seconds, order_index, transcript)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [moduleId, title, duration, orderIndex, transcript ?? null],
  );
  return row!.id;
}

async function upsertEnrollment(userId: string, courseId: string, percent: number): Promise<string> {
  const existing = await queryOne<{ id: string }>(
    'SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2',
    [userId, courseId],
  );
  if (existing) {
    await query('UPDATE enrollments SET progress_percent = $2 WHERE id = $1', [existing.id, percent]);
    return existing.id;
  }
  const row = await queryOne<{ id: string }>(
    'INSERT INTO enrollments (user_id, course_id, progress_percent) VALUES ($1, $2, $3) RETURNING id',
    [userId, courseId, percent],
  );
  return row!.id;
}

async function main(): Promise<void> {
  console.log('Seeding demo data…');

  const admin = await upsertUser('Meera Admin', 'admin@vertexon.demo', 'admin');
  const instructor = await upsertUser('Rohit Instructor', 'instructor@vertexon.demo', 'instructor');
  const ananya = await upsertUser('Ananya Student', 'student@vertexon.demo', 'student');
  const vikram = await upsertUser('Vikram Student', 'student2@vertexon.demo', 'student');

  const courseId = await upsertCourse(
    instructor,
    'Full-Stack Web Development Bootcamp',
    'Build and deploy modern web applications: React frontends, REST APIs, PostgreSQL, auth, testing and CI.',
    'Computer Science',
    'intermediate',
  );

  const m1 = await upsertModule(courseId, 'Module 1: Frontend Foundations', 0);
  const m2 = await upsertModule(courseId, 'Module 2: APIs & Data', 1);

  await upsertLecture(
    m1,
    'React Components & Props',
    720,
    0,
    'React components are reusable functions that return JSX. Props are read-only inputs passed from parent to child components. Composition beats inheritance: build small components and nest them. State lives in the parent when siblings must share data. Controlled inputs tie form fields to state so the UI always reflects the data model.',
  );
  await upsertLecture(
    m1,
    'State Management with Redux Toolkit',
    900,
    1,
    'Redux Toolkit standardizes a single store with slices. Create a slice with createSlice, define reducers as immutable updates, and dispatch actions from components. RTK Query caches server data and invalidates entries by tag. Prefer local state or context until you truly need global state.',
  );
  await upsertLecture(
    m2,
    'Designing REST APIs with Express',
    840,
    0,
    'A REST API maps HTTP verbs to resource operations: GET reads, POST creates, PUT replaces, DELETE removes. Keep routes under /api/v1, validate every input, and return a consistent error envelope with code, message and field. Stateless JWT middleware enforces authentication on every protected route.',
  );
  await upsertLecture(
    m2,
    'PostgreSQL Indexing & Query Plans',
    780,
    1,
    'B-tree indexes speed equality and range predicates; GIN indexes serve JSONB and full-text search; pgvector indexes enable ANN similarity search. Use EXPLAIN ANALYZE to confirm an index is used and to spot sequential scans on large tables. Index foreign keys and filter columns used in WHERE and JOIN.',
  );

  // Quiz on module 2
  const existingQuiz = await queryOne<{ id: string }>(
    "SELECT id FROM quizzes WHERE module_id = $1 AND title = 'REST API Fundamentals'",
    [m2],
  );
  let quizId = existingQuiz?.id;
  if (!quizId) {
    const q = await queryOne<{ id: string }>(
      `INSERT INTO quizzes (module_id, title) VALUES ($1, 'REST API Fundamentals') RETURNING id`,
      [m2],
    );
    quizId = q!.id;
    const questions: [string, 'mcq' | 'multi_select', [string, boolean][]][] = [
      ['Which verb creates a resource?', 'mcq', [['GET', false], ['POST', true], ['DELETE', false]]],
      [
        'Which of these belong in the error envelope?',
        'multi_select',
        [['code', true], ['message', true], ['password', false]],
      ],
      ['What does JWT stand for?', 'mcq', [['JSON Web Token', true], ['Joint Wired Transfer', false], ['JSON Web Transfer', false]]],
    ];
    for (const [idx, [text, type, options]] of questions.entries()) {
      const qr = await queryOne<{ id: string }>(
        'INSERT INTO quiz_questions (quiz_id, question_text, question_type, order_index) VALUES ($1, $2, $3, $4) RETURNING id',
        [quizId, text, type, idx],
      );
      for (const [optText, correct] of options) {
        await query('INSERT INTO quiz_options (question_id, option_text, is_correct) VALUES ($1, $2, $3)', [
          qr!.id,
          optText,
          correct,
        ]);
      }
    }
  }

  // Enrollments + progress
  const e1 = await upsertEnrollment(ananya, courseId, 100);
  await upsertEnrollment(vikram, courseId, 45);

  const lectures = await query<{ id: string }>(
    'SELECT l.id FROM lectures l JOIN modules m ON m.id = l.module_id WHERE m.course_id = $1 ORDER BY m.order_index, l.order_index',
    [courseId],
  );
  for (const lec of lectures) {
    await query(
      `INSERT INTO lecture_progress (enrollment_id, lecture_id, watched_seconds, completed, last_watched_at)
       SELECT $1, $2, 900, TRUE, now()
       WHERE NOT EXISTS (
         SELECT 1 FROM lecture_progress WHERE enrollment_id = $1 AND lecture_id = $2
       )`,
      [e1, lec.id],
    );
  }

  // Streaks
  await query(
    `INSERT INTO streaks (user_id, current_streak, longest_streak, last_active_date)
     VALUES ($1, 7, 12, CURRENT_DATE)
     ON CONFLICT (user_id) DO UPDATE SET last_active_date = CURRENT_DATE`,
    [ananya],
  );

  // Discussion thread + posts
  const existingThread = await queryOne<{ id: string }>(
    'SELECT id FROM discussion_threads WHERE course_id = $1 AND title = $2',
    [courseId, 'How do I decide between context and Redux?'],
  );
  let threadId = existingThread?.id;
  if (!threadId) {
    const t = await queryOne<{ id: string }>(
      `INSERT INTO discussion_threads (course_id, created_by, title)
       VALUES ($1, $2, 'How do I decide between context and Redux?') RETURNING id`,
      [courseId, ananya],
    );
    threadId = t!.id;
    await query('INSERT INTO discussion_posts (thread_id, user_id, content) VALUES ($1, $2, $3)', [
      threadId,
      ananya,
      'I keep reaching for Redux for component-local state. When is context enough?',
    ]);
    await query('INSERT INTO discussion_posts (thread_id, user_id, content) VALUES ($1, $2, $3)', [
      threadId,
      instructor,
      'Rule of thumb: context for low-frequency updates (theme, current user), Redux for frequently changing shared state like server cache and form wizards.',
    ]);
  }

  // Announcement + fan-out notification
  const existingAnn = await queryOne<{ id: string }>(
    'SELECT id FROM announcements WHERE course_id = $1 AND content LIKE $2',
    [courseId, 'Live Q&A session%'],
  );
  if (!existingAnn) {
    await query('INSERT INTO announcements (course_id, posted_by, content) VALUES ($1, $2, $3)', [
      courseId,
      instructor,
      'Live Q&A session this Friday 7 PM — bring your API design questions!',
    ]);
    await query(
      `INSERT INTO notifications (user_id, title, body)
       SELECT user_id, 'Announcement: Full-Stack Web Development Bootcamp',
              'Live Q&A session this Friday 7 PM — bring your API design questions!'
       FROM enrollments WHERE course_id = $1`,
      [courseId],
    );
  }

  console.log(`
Demo data ready. Sign-in accounts (password: DemoPass123!):
  admin@vertexon.demo      → admin
  instructor@vertexon.demo → instructor
  student@vertexon.demo    → student (100% progress)
  student2@vertexon.demo   → student (45% progress)

Course: "Full-Stack Web Development Bootcamp" (approved, 2 modules, 4 lectures
with transcripts for the AI tutor, 1 quiz, 1 discussion thread).
`);
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
