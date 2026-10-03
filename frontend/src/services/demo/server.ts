import type { AxiosAdapter, AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import {
  Assignment,
  AuthResponse,
  Course,
  CourseDetail,
  DiscussionThread,
  Lecture,
  Quiz,
  Role,
  User,
} from '../../utils/types';
import {
  AssignmentRecord,
  createDemoState,
  DemoAccount,
  DemoState,
  DiscussionPostRecord,
  nextId,
} from './seed';
import { generateQuizDraft, lectureSummary, moduleFlashcards, studyPlan, tutorReply } from './ai';
import { buildCertificatePdf } from './pdf';

/**
 * A miniature in-browser implementation of the `/api/v1` surface.
 *
 * When no backend is configured — static hosting such as Vercel, or a laptop
 * without Docker running — this adapter answers every request from local
 * state so the UI stays fully explorable. Response shapes are copied from the
 * FastAPI routes, so switching between demo and real mode is invisible to
 * every component.
 *
 * Mutations are ephemeral: they live for the page session only.
 */

interface Ctx {
  state: DemoState;
  method: string;
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  body: Record<string, unknown>;
}

type Handler = (ctx: Ctx) => unknown;

const state = createDemoState();

/** Remembered across reloads so a hard refresh does not silently sign you out. */
const SESSION_KEY = 'lms.demo.user';

function restoreSession(): void {
  try {
    const id = window.localStorage.getItem(SESSION_KEY);
    if (id && state.accounts.some((a) => a.id === id)) state.currentUserId = id;
  } catch {
    /* storage unavailable (private mode) — stay signed out */
  }
}

function persistSession(userId: string | null): void {
  try {
    if (userId) window.localStorage.setItem(SESSION_KEY, userId);
    else window.localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

if (typeof window !== 'undefined') restoreSession();

export const resetDemoState = (): void => {
  Object.assign(state, createDemoState(), { currentUserId: null });
  persistSession(null);
};

// ---------------------------------------------------------------------------
// errors + helpers
// ---------------------------------------------------------------------------

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

const currentUser = (s: DemoState): DemoAccount | undefined =>
  s.accounts.find((a) => a.id === s.currentUserId);

function requireUser(s: DemoState): DemoAccount {
  const user = currentUser(s);
  if (!user) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to continue');
  return user;
}

function requireRole(s: DemoState, ...roles: Role[]): DemoAccount {
  const user = requireUser(s);
  if (!user.roles.some((r) => roles.includes(r))) {
    throw new HttpError(403, 'FORBIDDEN', `Requires one of: ${roles.join(', ')}`);
  }
  return user;
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

const publicUser = ({ password: _pw, is_active: _a, created_at: _c, ...u }: DemoAccount): User => u;

const authResponse = (s: DemoState, account: DemoAccount): AuthResponse => {
  s.currentUserId = account.id;
  persistSession(account.id);
  return {
    access_token: `demo-access.${account.id}`,
    refresh_token: `demo-refresh.${account.id}`,
    user: publicUser(account),
  };
};

function findCourse(s: DemoState, id: string): CourseDetail {
  const course = s.courses.find((c) => c.id === id);
  if (!course) throw new HttpError(404, 'NOT_FOUND', `Course ${id} not found`);
  return course;
}

const allLectures = (course: CourseDetail): Lecture[] => course.modules.flatMap((m) => m.lectures);

function findLecture(s: DemoState, id: string): { course: CourseDetail; lecture: Lecture } {
  for (const course of s.courses) {
    const lecture = allLectures(course).find((l) => l.id === id);
    if (lecture) return { course, lecture };
  }
  throw new HttpError(404, 'NOT_FOUND', `Lecture ${id} not found`);
}

function requireCourseOwner(s: DemoState, user: DemoAccount, courseId: string): CourseDetail {
  const course = findCourse(s, courseId);
  if (course.instructor_id !== user.id && !user.roles.includes('admin')) {
    throw new HttpError(403, 'FORBIDDEN', 'You do not own this course');
  }
  return course;
}

/**
 * Mirrors `requireCourseAccess` in the discussions/announcements routers:
 * the course owner, a platform admin, or any enrolled learner.
 */
function requireCourseAccess(s: DemoState, user: DemoAccount, courseId: string): CourseDetail {
  const course = findCourse(s, courseId);
  if (course.instructor_id === user.id || user.roles.includes('admin')) return course;
  const enrolled = s.enrollments.some((e) => e.user_id === user.id && e.course_id === courseId);
  if (!enrolled) throw new HttpError(403, 'FORBIDDEN', 'You are not enrolled in this course');
  return course;
}

function requireThreadAccess(s: DemoState, user: DemoAccount, threadId: string): DiscussionThread {
  const thread = s.threads.find((t) => t.id === threadId);
  if (!thread) throw new HttpError(404, 'NOT_FOUND', 'Thread not found');
  requireCourseAccess(s, user, thread.course_id);
  return thread;
}

const enrolmentCount = (s: DemoState, courseId: string): number =>
  s.enrollments.filter((e) => e.course_id === courseId).length;

/** Strip the nested collections the list endpoint never returns. */
function courseListItem(s: DemoState, c: CourseDetail): Course {
  const { modules: _m, assignments: _a, instructor_id: _i, ...rest } = c;
  return { ...rest, enrollment_count: c.enrollment_count ?? enrolmentCount(s, c.id) };
}

/** Strip `is_correct` from option rows, exactly like the real quiz endpoint. */
const studentQuizView = (q: Quiz): Quiz => ({
  ...q,
  questions: q.questions.map((question) => ({
    ...question,
    options: question.options.map(({ id, option_text }) => ({ id, option_text })),
  })),
});

function decorateAssignments(
  s: DemoState,
  courseId: string,
  viewer: DemoAccount | null,
): Assignment[] {
  return s.assignments
    .filter((a) => a.course_id === courseId)
    .map(({ course_id: _c, ...a }: AssignmentRecord) => {
      const mine = viewer
        ? s.submissions.find((sub) => sub.assignment_id === a.id && sub.user_id === viewer.id)
        : undefined;
      return {
        ...a,
        my_submission_id: mine?.id ?? null,
        my_submitted_at: mine?.submitted_at ?? null,
        my_grade: mine?.grade ?? null,
        my_feedback: mine?.feedback ?? null,
        submission_count: s.submissions.filter((sub) => sub.assignment_id === a.id).length,
      };
    });
}

function notify(s: DemoState, userId: string, title: string, body: string): void {
  s.notifications.push({
    id: nextId('nt'),
    user_id: userId,
    title,
    body,
    is_read: false,
    created_at: new Date().toISOString(),
  });
}

/**
 * Derive a learner's course progress from lecture-level watch time: finished
 * lectures count in full, in-progress ones contribute their watched fraction.
 */
function recomputeProgress(s: DemoState, userId: string, courseId: string): void {
  const enrollment = s.enrollments.find((e) => e.user_id === userId && e.course_id === courseId);
  const course = s.courses.find((c) => c.id === courseId);
  if (!enrollment || !course) return;

  const lectures = allLectures(course);
  if (!lectures.length) return;

  const completed = lectures.filter((l) => s.progress[`${userId}:${l.id}`]?.completed).length;
  const totalSeconds = lectures.reduce((sum, l) => sum + (l.duration_seconds ?? 0), 0);
  const watched = lectures.reduce((sum, l) => {
    const duration = l.duration_seconds ?? 0;
    return sum + Math.min(s.progress[`${userId}:${l.id}`]?.watched_seconds ?? 0, duration);
  }, 0);
  const partial = totalSeconds ? watched / totalSeconds : 0;

  const fraction = (completed + partial * (lectures.length - completed)) / lectures.length;
  enrollment.progress_percent = String(Math.min(100, Math.round(fraction * 100)));
}

// ---------------------------------------------------------------------------
// auto-grading — mirrors backend/src/utils/grading.ts
// ---------------------------------------------------------------------------

function gradeAttempt(
  s: DemoState,
  quiz: Quiz,
  answers: { question_id: string; selected_option_ids?: string[]; text_answer?: string }[],
) {
  const byQuestion = new Map(answers.map((a) => [a.question_id, a]));
  const per_question: { question_id: string; is_correct: boolean | null }[] = [];
  let gradable = 0;
  let correct = 0;

  for (const q of quiz.questions) {
    const answer = byQuestion.get(q.id);
    if (q.question_type === 'short_answer') {
      per_question.push({ question_id: q.id, is_correct: null }); // graded manually later
      continue;
    }

    gradable += 1;
    const selected = [...(answer?.selected_option_ids ?? [])].sort();
    const key = [...(s.answerKey[q.id] ?? [])].sort();
    const ok =
      q.question_type === 'mcq'
        ? selected.length === 1 && key[0] === selected[0]
        : selected.length > 0 &&
          selected.length === key.length &&
          selected.every((value, i) => value === key[i]);

    per_question.push({ question_id: q.id, is_correct: ok });
    if (ok) correct += 1;
  }

  return {
    score: gradable > 0 ? Math.round((correct / gradable) * 10000) / 100 : null,
    per_question,
  };
}

// ---------------------------------------------------------------------------
// route table
// ---------------------------------------------------------------------------

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

const routes: Route[] = [];

const route = (method: string, path: string, handler: Handler): void => {
  const keys: string[] = [];
  const source = path
    .split('/')
    .map((segment) => {
      if (!segment.startsWith(':')) return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      keys.push(segment.slice(1));
      return '([^/]+)';
    })
    .join('/');
  routes.push({ method, pattern: new RegExp(`^${source}$`), keys, handler });
};

// --- auth ------------------------------------------------------------------

route('POST', '/auth/login', ({ state: s, body }) => {
  const email = str(body.email).trim().toLowerCase();
  const account = s.accounts.find((a) => a.email.toLowerCase() === email);
  if (!account) throw new HttpError(401, 'INVALID_CREDENTIALS', 'No account with that email');
  if (!account.is_active) {
    throw new HttpError(403, 'ACCOUNT_SUSPENDED', 'This account has been suspended');
  }
  if (account.password !== str(body.password)) {
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Incorrect password');
  }
  return authResponse(s, account);
});

route('POST', '/auth/refresh', ({ state: s }) => authResponse(s, requireUser(s)));

route('POST', '/auth/register', ({ state: s, body }) => {
  const email = str(body.email).trim().toLowerCase();
  const fullName = str(body.full_name).trim();
  const password = str(body.password);

  if (!email.includes('@')) throw new HttpError(422, 'VALIDATION', 'Enter a valid email address');
  if (fullName.length < 2) throw new HttpError(422, 'VALIDATION', 'Enter your full name');
  if (password.length < 8) {
    throw new HttpError(422, 'VALIDATION', 'Password must be at least 8 characters');
  }
  if (s.accounts.some((a) => a.email.toLowerCase() === email)) {
    throw new HttpError(409, 'CONFLICT', 'An account with that email already exists');
  }

  const account: DemoAccount = {
    id: nextId('u'),
    full_name: fullName,
    email,
    avatar_url: null,
    role: 'student',
    roles: ['student'],
    password,
    is_active: true,
    created_at: new Date().toISOString(),
  };
  s.accounts.push(account);
  s.streaks[account.id] = { current_streak: 0, longest_streak: 0, last_active_date: null };
  notify(s, account.id, 'Welcome to Vertexon LMS-AI', 'Your account is ready. Enrol in a course to get started.');
  return authResponse(s, account);
});

// --- courses ---------------------------------------------------------------

route('GET', '/courses', ({ state: s, query }) => {
  const me = currentUser(s);
  const q = str(query.q).trim().toLowerCase();
  const page = Math.max(1, Number(query.page ?? 1) || 1);
  const limit = Math.max(1, Number(query.limit ?? 12) || 12);

  let items = s.courses.slice();
  if (query.mine === '1') {
    items = items.filter((c) => c.instructor_id === me?.id);
  } else {
    items = items.filter((c) => c.status === 'approved' || c.instructor_id === me?.id);
  }
  if (q) items = items.filter((c) => `${c.title} ${c.description ?? ''}`.toLowerCase().includes(q));
  if (query.category) items = items.filter((c) => c.category === query.category);
  if (query.difficulty) items = items.filter((c) => c.difficulty === query.difficulty);

  const start = (page - 1) * limit;
  return {
    items: items.slice(start, start + limit).map((c) => courseListItem(s, c)),
    total: items.length,
    page,
    limit,
  };
});

route('POST', '/courses', ({ state: s, body }) => {
  const instructor = requireRole(s, 'instructor', 'admin');
  const title = str(body.title).trim();
  if (title.length < 3) throw new HttpError(422, 'VALIDATION', 'Title must be at least 3 characters');

  const course: CourseDetail = {
    id: nextId('c'),
    instructor_id: instructor.id,
    title,
    description: str(body.description).trim() || null,
    category: str(body.category).trim() || null,
    difficulty: str(body.difficulty) || null,
    thumbnail_url: null,
    price: num(body.price).toFixed(2),
    status: instructor.roles.includes('admin') ? 'approved' : 'pending',
    created_at: new Date().toISOString(),
    instructor_name: instructor.full_name,
    enrollment_count: 0,
    modules: [],
    assignments: [],
  };
  s.courses.unshift(course);
  notify(s, instructor.id, 'Course submitted', `"${title}" is now in the approval queue.`);
  return course;
});

route('GET', '/courses/:id', ({ state: s, params }) => findCourse(s, params.id));

route('POST', '/courses/:id/enroll', ({ state: s, params }) => {
  const user = requireUser(s);
  const course = findCourse(s, params.id);
  if (course.status !== 'approved') {
    throw new HttpError(409, 'NOT_APPROVED', 'This course is not open for enrolment yet');
  }
  if (s.enrollments.some((e) => e.user_id === user.id && e.course_id === course.id)) {
    throw new HttpError(409, 'ALREADY_ENROLLED', 'You are already enrolled in this course');
  }

  s.enrollments.push({
    id: nextId('e'),
    user_id: user.id,
    course_id: course.id,
    enrolled_at: new Date().toISOString(),
    progress_percent: '0',
    title: course.title,
    category: course.category,
    difficulty: course.difficulty,
    thumbnail_url: course.thumbnail_url,
    status: course.status,
    instructor_name: course.instructor_name ?? '',
  });
  course.enrollment_count = enrolmentCount(s, course.id);
  notify(s, user.id, 'Enrolled', `You are now enrolled in ${course.title}.`);
  return { id: nextId('e'), course_id: course.id };
});

route('POST', '/courses/:id/approve', ({ state: s, params, body }) => {
  requireRole(s, 'admin');
  const course = findCourse(s, params.id);
  const decision = str(body.decision);
  if (decision !== 'approved' && decision !== 'rejected') {
    throw new HttpError(422, 'VALIDATION', 'decision must be "approved" or "rejected"');
  }
  course.status = decision;
  const comment = str(body.comment).trim();
  notify(
    s,
    course.instructor_id,
    `Course ${decision}`,
    `"${course.title}" was ${decision}${comment ? ` — ${comment}` : ''}.`,
  );
  return { id: course.id, status: course.status };
});

route('POST', '/courses/:id/modules', ({ state: s, params, body }) => {
  const user = requireRole(s, 'instructor', 'admin');
  const course = requireCourseOwner(s, user, params.id);
  const title = str(body.title).trim();
  if (!title) throw new HttpError(422, 'VALIDATION', 'Module title is required');

  const mod = {
    id: nextId('m'),
    course_id: course.id,
    title,
    order_index: course.modules.length,
    lectures: [] as Lecture[],
    quizzes: [] as { id: string; module_id: string; title: string; question_count: number }[],
  };
  course.modules.push(mod);
  return mod;
});

route('GET', '/courses/:id/assignments', ({ state: s, params }) => {
  const me = requireUser(s);
  requireCourseAccess(s, me, params.id);
  return { items: decorateAssignments(s, params.id, me) };
});

route('POST', '/modules/:moduleId/lectures', ({ state: s, params, body }) => {
  const user = requireRole(s, 'instructor', 'admin');

  let owner: CourseDetail | undefined;
  for (const c of s.courses) if (c.modules.some((m) => m.id === params.moduleId)) owner = c;
  if (!owner) throw new HttpError(404, 'NOT_FOUND', `Module ${params.moduleId} not found`);
  requireCourseOwner(s, user, owner.id);

  const title = str(body.title).trim();
  if (!title) throw new HttpError(422, 'VALIDATION', 'Lecture title is required');

  const mod = owner.modules.find((m) => m.id === params.moduleId)!;
  const lecture: Lecture = {
    id: nextId('l'),
    module_id: mod.id,
    title,
    video_url: str(body.video_url) || null,
    transcript: str(body.transcript).trim() || null,
    duration_seconds: num(body.duration_seconds) || null,
    order_index: mod.lectures.length,
    resource_urls: null,
  };
  mod.lectures.push(lecture);
  return lecture;
});

route('GET', '/courses/:id/announcements', ({ state: s, params }) => {
  const user = requireUser(s);
  requireCourseAccess(s, user, params.id);
  return { items: s.announcements.filter((a) => a.course_id === params.id) };
});

route('POST', '/courses/:id/announcements', ({ state: s, params, body }) => {
  const user = requireRole(s, 'instructor', 'admin');
  const course = requireCourseOwner(s, user, params.id);
  const content = str(body.content).trim();
  if (!content) throw new HttpError(422, 'VALIDATION', 'Announcement text is required');

  s.announcements.unshift({
    id: nextId('an'),
    course_id: course.id,
    content,
    created_at: new Date().toISOString(),
    posted_by_name: user.full_name,
  });

  const enrolled = s.enrollments.filter((e) => e.course_id === course.id);
  for (const e of enrolled) notify(s, e.user_id, `Announcement: ${course.title}`, content);
  return { notified: enrolled.length };
});

// --- enrollments, progress, notes, bookmarks -------------------------------

route('GET', '/enrollments/me', ({ state: s }) => {
  const user = requireUser(s);
  return { items: s.enrollments.filter((e) => e.user_id === user.id) };
});

route('GET', '/lectures/:id/progress', ({ state: s, params }) => {
  const user = requireUser(s);
  return (
    s.progress[`${user.id}:${params.id}`] ?? {
      watched_seconds: 0,
      completed: false,
      last_watched_at: null,
    }
  );
});

route('POST', '/lectures/:id/progress', ({ state: s, params, body }) => {
  const user = requireUser(s);
  const { course, lecture } = findLecture(s, params.id);
  const key = `${user.id}:${params.id}`;
  const previous = s.progress[key] ?? {
    watched_seconds: 0,
    completed: false,
    last_watched_at: null,
  };

  const watched = num(body.watched_seconds, previous.watched_seconds);
  const duration = lecture.duration_seconds ?? 0;
  const completed =
    typeof body.completed === 'boolean'
      ? body.completed
      : previous.completed || (duration > 0 && watched >= duration - 5);

  s.progress[key] = {
    watched_seconds: watched,
    completed,
    last_watched_at: new Date().toISOString(),
  };
  recomputeProgress(s, user.id, course.id);

  if (completed && !previous.completed) {
    const already = s.badges.some((b) => b.name === 'first_steps');
    if (!already) {
      s.badges.push({
        id: s.badges.length + 1,
        name: 'first_steps',
        description: 'Completed your first lecture',
        earned_at: new Date().toISOString(),
      });
      notify(s, user.id, 'Badge earned: first_steps', 'You completed a lecture. Nice work!');
    }
  }

  return s.progress[key];
});

route('GET', '/lectures/:id/notes', ({ state: s, params }) => {
  requireUser(s);
  return { items: s.notes.filter((n) => n.lecture_id === params.id) };
});

route('POST', '/lectures/:id/notes', ({ state: s, params, body }) => {
  requireUser(s);
  const content = str(body.content).trim();
  if (!content) throw new HttpError(422, 'VALIDATION', 'Note cannot be empty');

  const note = {
    id: nextId('n'),
    lecture_id: params.id,
    timestamp_seconds: num(body.timestamp_seconds),
    content,
    created_at: new Date().toISOString(),
  };
  s.notes.push(note);
  return note;
});

route('DELETE', '/notes/:id', ({ state: s, params }) => {
  requireUser(s);
  const before = s.notes.length;
  s.notes = s.notes.filter((n) => n.id !== params.id);
  if (s.notes.length === before) throw new HttpError(404, 'NOT_FOUND', 'Note not found');
  return { deleted: true };
});

route('GET', '/lectures/:id/bookmarks', ({ state: s, params }) => {
  requireUser(s);
  return {
    items: s.bookmarks
      .filter((b) => b.lecture_id === params.id)
      .map(({ id, timestamp_seconds, created_at }) => ({ id, timestamp_seconds, created_at })),
  };
});

route('POST', '/lectures/:id/bookmarks', ({ state: s, params, body }) => {
  requireUser(s);
  const bookmark = {
    id: nextId('b'),
    lecture_id: params.id,
    timestamp_seconds: num(body.timestamp_seconds),
    created_at: new Date().toISOString(),
  };
  s.bookmarks.push(bookmark);
  return {
    id: bookmark.id,
    timestamp_seconds: bookmark.timestamp_seconds,
    created_at: bookmark.created_at,
  };
});

route('DELETE', '/bookmarks/:id', ({ state: s, params }) => {
  requireUser(s);
  const before = s.bookmarks.length;
  s.bookmarks = s.bookmarks.filter((b) => b.id !== params.id);
  if (s.bookmarks.length === before) throw new HttpError(404, 'NOT_FOUND', 'Bookmark not found');
  return { deleted: true };
});

// --- quizzes ---------------------------------------------------------------

route('GET', '/quizzes/:id', ({ state: s, params }) => {
  const quiz = s.quizzes.find((q) => q.id === params.id);
  if (!quiz) throw new HttpError(404, 'NOT_FOUND', `Quiz ${params.id} not found`);
  return studentQuizView(quiz);
});

route('POST', '/quizzes', ({ state: s, body }) => {
  const user = requireRole(s, 'instructor', 'admin');
  const moduleId = str(body.module_id);
  const title = str(body.title).trim();
  if (!moduleId) throw new HttpError(422, 'VALIDATION', 'module_id is required');
  if (!title) throw new HttpError(422, 'VALIDATION', 'Quiz title is required');

  let owner: CourseDetail | undefined;
  for (const c of s.courses) if (c.modules.some((m) => m.id === moduleId)) owner = c;
  if (!owner) throw new HttpError(404, 'NOT_FOUND', `Module ${moduleId} not found`);
  requireCourseOwner(s, user, owner.id);

  const drafts = Array.isArray(body.questions)
    ? (body.questions as Record<string, unknown>[])
    : [];
  if (!drafts.length) throw new HttpError(422, 'VALIDATION', 'Add at least one question');

  const questions: Quiz['questions'] = drafts.map((draft, i) => {
    const questionId = nextId('qq');
    const rawOptions = Array.isArray(draft.options) ? (draft.options as Record<string, unknown>[]) : [];
    const options = rawOptions.map((o) => ({ id: nextId('qo'), option_text: str(o.option_text) }));
    s.answerKey[questionId] = options
      .filter((_, j) => rawOptions[j]?.is_correct === true)
      .map((o) => o.id);

    return {
      id: questionId,
      question_text: str(draft.question_text).trim(),
      question_type: str(draft.question_type, 'mcq') as Quiz['questions'][number]['question_type'],
      order_index: i,
      options,
    };
  });

  const quiz: Quiz = { id: nextId('q'), module_id: moduleId, title, show_answers: true, questions };
  s.quizzes.push(quiz);
  owner.modules.find((m) => m.id === moduleId)!.quizzes.push({
    id: quiz.id,
    module_id: moduleId,
    title,
    question_count: questions.length,
  });

  return { id: quiz.id, title, question_count: questions.length };
});

route('POST', '/quizzes/:id/attempt', ({ state: s, params }) => {
  const user = requireUser(s);
  const quiz = s.quizzes.find((q) => q.id === params.id);
  if (!quiz) throw new HttpError(404, 'NOT_FOUND', `Quiz ${params.id} not found`);

  const attempt = {
    id: nextId('at'),
    quiz_id: quiz.id,
    user_id: user.id,
    score: null,
    created_at: new Date().toISOString(),
  };
  s.attempts.push(attempt);
  return { id: attempt.id };
});

route('POST', '/attempts/:id/submit', ({ state: s, params, body }) => {
  const user = requireUser(s);
  const attempt = s.attempts.find((a) => a.id === params.id);
  if (!attempt) throw new HttpError(404, 'NOT_FOUND', 'Attempt not found');
  if (attempt.user_id !== user.id) throw new HttpError(403, 'FORBIDDEN', 'Not your attempt');

  const quiz = s.quizzes.find((q) => q.id === attempt.quiz_id);
  if (!quiz) throw new HttpError(404, 'NOT_FOUND', 'Quiz no longer exists');

  const answers = Array.isArray(body.answers)
    ? (body.answers as {
        question_id: string;
        selected_option_ids?: string[];
        text_answer?: string;
      }[])
    : [];

  const result = gradeAttempt(s, quiz, answers);
  attempt.score = result.score;

  const owner = s.courses.find((c) => c.modules.some((m) => m.id === quiz.module_id));
  if (owner) {
    recomputeProgress(s, user.id, owner.id);
    if (result.score === 100 && !s.badges.some((b) => b.name === 'quiz_ace')) {
      s.badges.push({
        id: s.badges.length + 1,
        name: 'quiz_ace',
        description: 'Scored 100% on a quiz',
        earned_at: new Date().toISOString(),
      });
      notify(s, user.id, 'Badge earned: quiz_ace', 'You scored 100% on a quiz.');
    }
  }

  return { attempt_id: attempt.id, ...result };
});

// --- assignments -----------------------------------------------------------

route('POST', '/assignments', ({ state: s, body }) => {
  const user = requireRole(s, 'instructor', 'admin');
  const course = requireCourseOwner(s, user, str(body.course_id));
  const title = str(body.title).trim();
  if (!title) throw new HttpError(422, 'VALIDATION', 'Assignment title is required');

  const assignment: AssignmentRecord = {
    id: nextId('a'),
    course_id: course.id,
    title,
    instructions: str(body.instructions).trim() || null,
    rubric: null,
    due_date: str(body.due_date) || null,
  };
  s.assignments.push(assignment);
  course.assignments = [...course.assignments, assignment];
  return assignment;
});

route('POST', '/assignments/:id/submit', ({ state: s, params, body }) => {
  const user = requireRole(s, 'student');
  const assignment = s.assignments.find((a) => a.id === params.id);
  if (!assignment) throw new HttpError(404, 'NOT_FOUND', 'Assignment not found');

  const enrolled = s.enrollments.some(
    (e) => e.user_id === user.id && e.course_id === assignment.course_id,
  );
  if (!enrolled) throw new HttpError(403, 'FORBIDDEN', 'You are not enrolled in this course');
  if (assignment.due_date && new Date(assignment.due_date) < new Date()) {
    throw new HttpError(403, 'FORBIDDEN', 'The deadline for this assignment has passed');
  }
  if (s.submissions.some((x) => x.assignment_id === assignment.id && x.user_id === user.id)) {
    throw new HttpError(409, 'CONFLICT', 'You have already submitted this assignment');
  }

  const file = body.file as File | undefined;
  const submission = {
    id: nextId('s'),
    assignment_id: assignment.id,
    user_id: user.id,
    submitted_at: new Date().toISOString(),
    grade: null,
    feedback: null,
    file_name: file?.name ?? 'submission.txt',
  };
  s.submissions.push(submission);
  notify(s, user.id, 'Assignment submitted', `${assignment.title} was submitted for grading.`);
  return submission;
});

// --- user ------------------------------------------------------------------

route('GET', '/users/me/streak', ({ state: s }) => {
  const user = requireUser(s);
  return s.streaks[user.id] ?? { current_streak: 0, longest_streak: 0, last_active_date: null };
});

route('GET', '/users/me/badges', ({ state: s }) => {
  requireUser(s);
  return { items: s.badges };
});

route('GET', '/users/me/certificates', ({ state: s }) => {
  const user = requireUser(s);
  return { items: s.certificates.filter((c) => c.user_id === user.id) };
});

route('GET', '/users/me/notifications', ({ state: s }) => {
  const user = requireUser(s);
  const items = s.notifications
    .filter((n) => n.user_id === user.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 50);
  return {
    items: items.map(({ user_id: _u, ...rest }) => rest),
    unread: items.filter((n) => !n.is_read).length,
  };
});

route('POST', '/users/me/notifications/read-all', ({ state: s }) => {
  const user = requireUser(s);
  for (const n of s.notifications) if (n.user_id === user.id) n.is_read = true;
  return { updated: true };
});

route('PUT', '/notifications/:id/read', ({ state: s, params }) => {
  const user = requireUser(s);
  const notification = s.notifications.find((n) => n.id === params.id);
  if (!notification || notification.user_id !== user.id) {
    throw new HttpError(404, 'NOT_FOUND', 'Notification not found');
  }
  notification.is_read = true;
  const { user_id: _u, ...rest } = notification;
  return rest;
});

// --- discussions -----------------------------------------------------------

const threadView = (t: DiscussionThread, s: DemoState) => ({
  ...t,
  post_count: s.posts.filter((p) => p.thread_id === t.id).length,
});

route('GET', '/courses/:id/threads', ({ state: s, params }) => {
  const user = requireUser(s);
  requireCourseAccess(s, user, params.id);
  return { items: s.threads.filter((t) => t.course_id === params.id).map((t) => threadView(t, s)) };
});

route('POST', '/courses/:id/threads', ({ state: s, params, body }) => {
  const user = requireUser(s);
  requireCourseAccess(s, user, params.id);
  const title = str(body.title).trim();
  if (!title) throw new HttpError(422, 'VALIDATION', 'Thread title is required');

  const now = new Date().toISOString();
  const thread: DiscussionThread = {
    id: nextId('th'),
    course_id: params.id,
    title,
    created_at: now,
    created_by_name: user.full_name,
    post_count: 0,
    last_activity_at: now,
  };
  s.threads.push(thread);

  const post: DiscussionPostRecord = {
    id: nextId('po'),
    thread_id: thread.id,
    course_id: params.id,
    user_id: user.id,
    content: 'Started this discussion.',
    is_flagged: false,
    created_at: now,
    author_name: user.full_name,
    author_id: user.id,
  };
  s.posts.push(post);
  return threadView(thread, s);
});

route('GET', '/threads/:id/posts', ({ state: s, params }) => {
  const user = requireUser(s);
  requireThreadAccess(s, user, params.id);
  return { items: s.posts.filter((p) => p.thread_id === params.id) };
});

route('POST', '/threads/:id/posts', ({ state: s, params, body }) => {
  const user = requireUser(s);
  const content = str(body.content).trim();
  if (!content) throw new HttpError(422, 'VALIDATION', 'Reply cannot be empty');

  const parent = requireThreadAccess(s, user, params.id);

  const post: DiscussionPostRecord = {
    id: nextId('po'),
    thread_id: parent.id,
    course_id: parent.course_id,
    user_id: user.id,
    content,
    is_flagged: false,
    created_at: new Date().toISOString(),
    author_name: user.full_name,
    author_id: user.id,
  };
  s.posts.push(post);
  parent.last_activity_at = post.created_at;
  return post;
});

route('POST', '/posts/:id/flag', ({ state: s, params }) => {
  const user = requireUser(s);
  const post = s.posts.find((p) => p.id === params.id);
  if (!post) throw new HttpError(404, 'NOT_FOUND', 'Post not found');
  requireThreadAccess(s, user, post.thread_id);
  post.is_flagged = true;

  for (const admin of s.accounts.filter((a) => a.roles.includes('admin'))) {
    notify(s, admin.id, 'Post flagged for review', post.content.slice(0, 120));
  }
  return { ok: true, is_flagged: true };
});

route('DELETE', '/posts/:id', ({ state: s, params }) => {
  const user = requireRole(s, 'admin', 'instructor');
  const post = s.posts.find((p) => p.id === params.id);
  if (!post) throw new HttpError(404, 'NOT_FOUND', 'Post not found');

  const thread = s.threads.find((t) => t.id === post.thread_id);
  const course = thread && s.courses.find((c) => c.id === thread.course_id);
  if (!course || (course.instructor_id !== user.id && !user.roles.includes('admin'))) {
    throw new HttpError(403, 'FORBIDDEN', 'You can only moderate your own course');
  }

  s.posts = s.posts.filter((p) => p.id !== params.id);
  return { ok: true };
});

// --- AI --------------------------------------------------------------------

route('GET', '/ai/recommendations', ({ state: s }) => {
  const user = requireUser(s);
  const enrolled = new Set(s.enrollments.filter((e) => e.user_id === user.id).map((e) => e.course_id));
  const interests = s.enrollments
    .filter((e) => e.user_id === user.id)
    .map((e) => `${e.category ?? ''} ${e.title}`)
    .join(' ')
    .toLowerCase();

  const items = s.courses
    .filter((c) => c.status === 'approved' && !enrolled.has(c.id))
    .map((c) => {
      const tokens = (c.category ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      const related = tokens.some((t) => interests.includes(t));
      return {
        course_id: c.id,
        title: c.title,
        difficulty: c.difficulty,
        instructor_name: c.instructor_name,
        score: related ? 88 : 64,
        reason: related
          ? `You are already working through ${c.category} material.`
          : 'Popular with learners on a similar path.',
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  return { items };
});

route('GET', '/ai/chat/sessions', ({ state: s, query }) => {
  const user = requireUser(s);
  const courseId = str(query.course_id);
  return {
    items: s.sessions
      .filter((x) => x.user_id === user.id && (!courseId || x.course_id === courseId))
      .map((x) => ({ id: x.id, mode: x.mode, course_id: x.course_id, created_at: x.created_at })),
  };
});

route('POST', '/ai/chat/sessions', ({ state: s, body }) => {
  const user = requireUser(s);
  const course = findCourse(s, str(body.course_id));
  const session = {
    id: nextId('cs'),
    course_id: course.id,
    user_id: user.id,
    mode: 'intermediate',
    created_at: new Date().toISOString(),
  };
  s.sessions.push(session);
  return { id: session.id, mode: session.mode };
});

route('GET', '/ai/chat/sessions/:id/messages', ({ state: s, params }) => {
  const user = requireUser(s);
  const session = s.sessions.find((x) => x.id === params.id);
  if (!session || session.user_id !== user.id) {
    throw new HttpError(404, 'NOT_FOUND', 'Chat session not found');
  }
  return { items: s.messages.filter((m) => m.session_id === session.id), mode: session.mode };
});

route('POST', '/ai/chat/sessions/:id/messages', ({ state: s, params, body }) => {
  const user = requireUser(s);
  const session = s.sessions.find((x) => x.id === params.id);
  if (!session || session.user_id !== user.id) {
    throw new HttpError(404, 'NOT_FOUND', 'Chat session not found');
  }
  const message = str(body.message).trim();
  if (!message) throw new HttpError(422, 'VALIDATION', 'Message cannot be empty');

  s.messages.push({
    id: nextId('cm'),
    session_id: session.id,
    sender: 'user',
    content: message,
    sources: null,
    created_at: new Date().toISOString(),
  });

  const course = findCourse(s, session.course_id);
  const { reply, sources, mode } = tutorReply(course, message, session.mode);
  s.messages.push({
    id: nextId('cm'),
    session_id: session.id,
    sender: 'ai',
    content: reply,
    sources,
    created_at: new Date().toISOString(),
  });

  return { reply, sources, mode };
});

route('PUT', '/ai/chat/sessions/:id/mode', ({ state: s, params, body }) => {
  const user = requireUser(s);
  const session = s.sessions.find((x) => x.id === params.id);
  if (!session || session.user_id !== user.id) {
    throw new HttpError(404, 'NOT_FOUND', 'Chat session not found');
  }
  const mode = str(body.mode);
  if (!['beginner', 'intermediate', 'advanced'].includes(mode)) {
    throw new HttpError(422, 'VALIDATION', 'mode must be beginner, intermediate or advanced');
  }
  session.mode = mode;
  return { id: session.id, mode };
});

route('POST', '/ai/lectures/:id/summarize', ({ state: s, params }) => {
  requireUser(s);
  const { lecture } = findLecture(s, params.id);
  return lectureSummary(lecture);
});

route('POST', '/ai/lectures/:id/generate-quiz', ({ state: s, params }) => {
  requireUser(s);
  const { course, lecture } = findLecture(s, params.id);
  return generateQuizDraft(s, course, lecture);
});

route('POST', '/ai/modules/:id/flashcards', ({ state: s, params }) => {
  requireUser(s);
  for (const course of s.courses) {
    if (course.modules.some((m) => m.id === params.id)) return moduleFlashcards(course, params.id);
  }
  throw new HttpError(404, 'NOT_FOUND', `Module ${params.id} not found`);
});

route('POST', '/ai/study-plan', ({ state: s }) => {
  const user = requireUser(s);
  return studyPlan(s, user.id);
});

// --- admin -----------------------------------------------------------------

route('GET', '/admin/analytics/overview', ({ state: s }) => {
  requireRole(s, 'admin');
  const approved = s.courses.filter((c) => c.status === 'approved');
  const revenue = s.enrollments.reduce((sum, e) => {
    const price = s.courses.find((c) => c.id === e.course_id)?.price ?? '0';
    return sum + Number(price);
  }, 0);
  const completed = s.enrollments.filter((e) => Number(e.progress_percent) >= 100).length;

  return {
    total_users: s.accounts.length,
    active_users: s.accounts.filter((a) => a.is_active).length,
    dau: 37,
    total_courses: s.courses.length,
    approved_courses: approved.length,
    pending_courses: s.courses.filter((c) => c.status === 'pending').length,
    total_enrollments: s.enrollments.length,
    completion_rate: s.enrollments.length
      ? Math.round((completed / s.enrollments.length) * 100)
      : 0,
    revenue,
    flagged_posts: s.posts.filter((p) => p.is_flagged).length,
  };
});

route('GET', '/admin/users', ({ state: s, query }) => {
  requireRole(s, 'admin');
  const q = str(query.q).trim().toLowerCase();
  return {
    items: s.accounts
      .filter((a) => !q || `${a.full_name} ${a.email}`.toLowerCase().includes(q))
      .map((a) => ({
        id: a.id,
        full_name: a.full_name,
        email: a.email,
        is_active: a.is_active,
        created_at: a.created_at,
        roles: a.roles,
        enrollment_count: s.enrollments.filter((e) => e.user_id === a.id).length,
      })),
  };
});

route('PUT', '/admin/users/:id/role', ({ state: s, params, body }) => {
  requireRole(s, 'admin');
  const account = s.accounts.find((a) => a.id === params.id);
  if (!account) throw new HttpError(404, 'NOT_FOUND', 'User not found');

  const role = str(body.role) as Role;
  if (!['student', 'instructor', 'admin'].includes(role)) {
    throw new HttpError(422, 'VALIDATION', 'Unknown role');
  }
  account.roles = [role];
  account.role = role;
  return { id: account.id, roles: account.roles };
});

route('PUT', '/admin/users/:id/suspend', ({ state: s, params, body }) => {
  const actor = requireRole(s, 'admin');
  const account = s.accounts.find((a) => a.id === params.id);
  if (!account) throw new HttpError(404, 'NOT_FOUND', 'User not found');
  if (account.id === actor.id) {
    throw new HttpError(422, 'SELF_SUSPEND', 'You cannot suspend your own account');
  }

  account.is_active = Boolean(body.is_active);
  return { id: account.id, is_active: account.is_active };
});

route('GET', '/admin/courses/pending', ({ state: s }) => {
  requireRole(s, 'admin');
  return {
    items: s.courses
      .filter((c) => c.status === 'pending')
      .map((c) => ({ ...courseListItem(s, c), module_count: c.modules.length })),
  };
});

route('GET', '/admin/moderation/flagged-posts', ({ state: s }) => {
  requireRole(s, 'admin');
  return {
    items: s.posts
      .filter((p) => p.is_flagged)
      .map((p) => {
        const thread = s.threads.find((t) => t.id === p.thread_id);
        const course = s.courses.find((c) => c.id === p.course_id);
        return {
          id: p.id,
          content: p.content,
          created_at: p.created_at,
          author_name: p.author_name,
          thread_title: thread?.title ?? 'thread',
          course_title: course?.title ?? 'course',
        };
      }),
  };
});

route('DELETE', '/admin/moderation/posts/:id', ({ state: s, params }) => {
  requireRole(s, 'admin');
  const before = s.posts.length;
  s.posts = s.posts.filter((p) => p.id !== params.id);
  if (s.posts.length === before) throw new HttpError(404, 'NOT_FOUND', 'Post not found');
  return { deleted: true };
});

// ---------------------------------------------------------------------------
// adapter
// ---------------------------------------------------------------------------

function match(
  method: string,
  path: string,
): { handler: Handler; params: Record<string, string> } | null {
  let pathMatched = false;

  for (const r of routes) {
    const m = r.pattern.exec(path);
    if (!m) continue;
    pathMatched = true;
    if (r.method !== method) continue;

    const params: Record<string, string> = {};
    r.keys.forEach((key, i) => {
      params[key] = decodeURIComponent(m[i + 1]);
    });
    return { handler: r.handler, params };
  }

  if (pathMatched) throw new HttpError(405, 'METHOD_NOT_ALLOWED', `${method} is not allowed here`);
  return null;
}

function certificatePdf(certId: string): Blob {
  const user = currentUser(state);
  if (!user) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to continue');

  const cert = state.certificates.find((c) => c.id === certId);
  if (!cert) throw new HttpError(404, 'NOT_FOUND', 'Certificate not found');
  if (cert.user_id !== user.id) {
    throw new HttpError(403, 'FORBIDDEN', 'That certificate belongs to another learner');
  }

  const bytes = buildCertificatePdf({
    name: user.full_name,
    course: cert.course_title,
    issuedAt: cert.issued_at,
    certificateId: cert.id,
  });
  // `bytes.buffer` is ArrayBufferLike; the demo writer only ever allocates a
  // plain ArrayBuffer, so the narrowing is safe.
  return new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
}

const jsonHeaders = (config: InternalAxiosRequestConfig): Record<string, string> => ({
  'content-type': 'application/json',
  ...(config.headers ? { authorization: String(config.headers.Authorization ?? '') } : {}),
});

export const demoAdapter: AxiosAdapter = async (
  config: InternalAxiosRequestConfig,
): Promise<AxiosResponse> => {
  const method = (config.method ?? 'get').toUpperCase();
  const [rawPath = '/', rawQuery = ''] = String(config.url ?? '/').split('?');

  // The axios instance already carries the base URL; strip the prefix so the
  // route table sees the same `/api/v1/...` path the real server would.
  const path = rawPath.replace(/^.*\/api\/v1/, '') || '/';

  const envelope = {
    config,
    headers: config.headers,
    params: config.params,
    url: String(config.url ?? '/'),
  };

  try {
    // A short delay keeps loading states visible, as with a real network.
    await new Promise((resolve) => setTimeout(resolve, 120 + Math.random() * 200));

    const certificateMatch = /^\/certificates\/([^/]+)\/download$/.exec(path);
    if (method === 'GET' && certificateMatch) {
      return {
        ...envelope,
        data: certificatePdf(certificateMatch[1]),
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/pdf' },
      } as AxiosResponse;
    }

    const matched = match(method, path);
    if (!matched) throw new HttpError(404, 'NOT_FOUND', `No demo route for ${method} ${path}`);

    const query: Record<string, string> = {};
    for (const [key, value] of new URLSearchParams(rawQuery)) query[key] = value;
    if (config.params && typeof config.params === 'object') {
      for (const [key, value] of Object.entries(config.params)) {
        if (value !== undefined && value !== null) query[key] = String(value);
      }
    }

    let body: Record<string, unknown> = {};
    if (typeof config.data === 'string') {
      try {
        body = JSON.parse(config.data) as Record<string, unknown>;
      } catch {
        body = {};
      }
    } else if (config.data && typeof config.data === 'object') {
      const payload = config.data as FormData;
      body =
        typeof FormData !== 'undefined' && payload instanceof FormData
          ? { file: payload.get('file') ?? undefined }
          : (config.data as Record<string, unknown>);
    }

    const data = matched.handler({ state, method, path, params: matched.params, query, body });

    return {
      ...envelope,
      data,
      status: 200,
      statusText: 'OK',
      headers: jsonHeaders(config),
    } as AxiosResponse;
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const code = err instanceof HttpError ? err.code : 'INTERNAL_ERROR';
    const message = err instanceof Error ? err.message : 'Demo backend failure';

    const error = Object.assign(new Error(message), {
      isAxiosError: true,
      config,
      response: {
        ...envelope,
        data: { error: { code, message } },
        status,
        statusText: message,
        headers: { 'content-type': 'application/json' },
      },
      toJSON: () => ({ code, message }),
    }) as unknown as AxiosError;

    return Promise.reject(error);
  }
};