import http from 'http';
import { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool, query, queryOne } from '../../src/db/pool';
import { redis } from '../../src/db/redis';
import { closeQueues } from '../../src/jobs/queues';
import { env } from '../../src/config/env';
import { setGoogleVerifierForTests } from '../../src/modules/auth/google.service';
import { makeHelpers } from './helpers';

/**
 * The nine learner/instructor features against a real Postgres + Redis:
 * forgot password, Google sign-in, profile photo, data export and deletion,
 * "explain my mistake", spaced-repetition flashcards, Socratic chat (style
 * column), at-risk alerts and live classes.
 */

const { app, api, login, PASSWORD, latestVerificationToken } = makeHelpers();
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

let courseId = '';
let moduleId = '';
let fakeAi: http.Server;
let aiCalls = 0;

beforeAll(async () => {
  const c = await queryOne<{ id: string }>(
    "SELECT id FROM courses WHERE title = 'Full-Stack Web Development Bootcamp'",
  );
  courseId = c!.id;
  moduleId = (await queryOne<{ id: string }>('SELECT id FROM modules WHERE course_id = $1 ORDER BY order_index LIMIT 1', [courseId]))!.id;

  // Stand-in AI service: answers the explain call and counts hits.
  fakeAi = http.createServer((req, res) => {
    aiCalls++;
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const sent = JSON.parse(body || '{}');
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          explanation: `You chose ${sent.options?.filter((o: { chosen: boolean }) => o.chosen).map((o: { text: string }) => o.text).join(', ')}; the right answer is ${sent.options?.filter((o: { is_correct: boolean }) => o.is_correct).map((o: { text: string }) => o.text).join(', ')}.`,
          sources: [],
        }),
      );
    });
  });
  await new Promise<void>((r) => fakeAi.listen(0, '127.0.0.1', r));
  (env as { aiServiceUrl: string }).aiServiceUrl = `http://127.0.0.1:${(fakeAi.address() as AddressInfo).port}`;
});

afterAll(async () => {
  fakeAi?.close();
  await closeQueues().catch(() => undefined);
  await redis.quit().catch(() => undefined);
  await pool.end().catch(() => undefined);
});

async function register(prefix: string) {
  const email = `${prefix}-${Date.now()}-${Math.round(Math.random() * 1e6)}@gmail.com`;
  const res = await api().post('/api/v1/auth/register').send({ full_name: 'Feature Tester', email, password: PASSWORD });
  expect(res.status).toBe(201);
  return { email, token: res.body.access_token as string, id: res.body.user.id as string };
}

describe('forgot password', () => {
  it('emails a one-time link that sets a new password and ends old sessions', async () => {
    const u = await register('reset');
    expect((await api().post('/api/v1/auth/forgot-password').send({ email: u.email })).status).toBe(200);
    const token = await latestVerificationToken(u.email, '/reset-password');

    const ok = await api().post('/api/v1/auth/reset-password').send({ token, new_password: 'FreshPass789!' });
    expect(ok.status).toBe(200);
    expect((await api().post('/api/v1/auth/login').send({ email: u.email, password: 'FreshPass789!' })).status).toBe(200);
    expect((await api().post('/api/v1/auth/login').send({ email: u.email, password: PASSWORD })).status).toBe(401);
    // Single use.
    expect((await api().post('/api/v1/auth/reset-password').send({ token, new_password: 'Another789!x' })).status).toBe(400);
    // A reset link cannot be spent on the verify-email endpoint.
    await api().post('/api/v1/auth/forgot-password').send({ email: u.email });
    const t2 = await latestVerificationToken(u.email, '/reset-password');
    expect((await api().post('/api/v1/auth/verify-email').send({ token: t2 })).status).toBe(400);
  });

  it('answers the same for unknown emails, so accounts cannot be discovered', async () => {
    const res = await api().post('/api/v1/auth/forgot-password').send({ email: 'nobody-here@gmail.com' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sent: true });
  });
});

describe('sign in with Google', () => {
  beforeAll(() => {
    (env.google as { clientId: string }).clientId = 'test-client.apps.googleusercontent.com';
  });

  it('advertises the provider only when configured', async () => {
    const res = await api().get('/api/v1/auth/providers');
    expect(res.body.google_client_id).toBe('test-client.apps.googleusercontent.com');
  });

  it('creates a verified student on first sign-in and reuses it after', async () => {
    const email = `g-${Date.now()}@gmail.com`;
    setGoogleVerifierForTests(async () => ({ sub: `sub-${email}`, email, emailVerified: true, name: 'Google Learner' }));
    const first = await api().post('/api/v1/auth/google').send({ credential: 'x'.repeat(40) });
    expect(first.status).toBe(200);
    expect(first.body.user).toMatchObject({ email, role: 'student', email_verified: true, full_name: 'Google Learner' });
    const again = await api().post('/api/v1/auth/google').send({ credential: 'x'.repeat(40) });
    expect(again.body.user.id).toBe(first.body.user.id);
  });

  it('links to an existing password account with the same verified email', async () => {
    const u = await register('link');
    setGoogleVerifierForTests(async () => ({ sub: `sub-link-${u.id}`, email: u.email, emailVerified: true }));
    const res = await api().post('/api/v1/auth/google').send({ credential: 'x'.repeat(40) });
    expect(res.body.user.id).toBe(u.id);
    // The password still works too.
    expect((await api().post('/api/v1/auth/login').send({ email: u.email, password: PASSWORD })).status).toBe(200);
  });

  it('refuses a Google account whose email Google has not verified', async () => {
    setGoogleVerifierForTests(async () => ({ sub: 'unverified', email: 'u@gmail.com', emailVerified: false }));
    expect((await api().post('/api/v1/auth/google').send({ credential: 'x'.repeat(40) })).status).toBe(400);
  });
});

describe('profile photo', () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );

  it('uploads an image, serves it, and can remove it', async () => {
    const u = await register('photo');
    const up = await api().post('/api/v1/users/me/avatar').set(auth(u.token)).attach('avatar', png, { filename: 'me.png', contentType: 'image/png' });
    expect(up.status).toBe(200);
    expect(up.body.avatar_url).toMatch(/^\/uploads\/avatars\/.+\.png$/);
    expect((await api().get(up.body.avatar_url)).status).toBe(200);
    const del = await api().delete('/api/v1/users/me/avatar').set(auth(u.token));
    expect(del.body.avatar_url).toBeNull();
  });

  it('rejects files that are not images', async () => {
    const u = await register('photo-bad');
    const res = await api().post('/api/v1/users/me/avatar').set(auth(u.token)).attach('avatar', Buffer.from('MZ'), { filename: 'x.exe', contentType: 'application/x-msdownload' });
    expect(res.status).toBe(400);
  });
});

describe('download my data / delete my account', () => {
  it('exports the learner’s own records with decrypted profile', async () => {
    const token = await login('student@vertexon.demo');
    const res = await api().get('/api/v1/users/me/export').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    expect(res.body.profile.email).toBe('student@vertexon.demo');
    expect(Array.isArray(res.body.enrollments)).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/password_hash/);
  });

  it('requires DELETE + password, then anonymises the account and frees the email', async () => {
    const u = await register('bye');
    expect((await api().delete('/api/v1/users/me').set(auth(u.token)).send({ confirm: 'yes', password: PASSWORD })).status).toBe(400);
    expect((await api().delete('/api/v1/users/me').set(auth(u.token)).send({ confirm: 'DELETE', password: 'wrong' })).status).toBe(401);
    expect((await api().delete('/api/v1/users/me').set(auth(u.token)).send({ confirm: 'DELETE', password: PASSWORD })).status).toBe(200);

    expect((await api().post('/api/v1/auth/login').send({ email: u.email, password: PASSWORD })).status).toBe(401);
    const row = await queryOne<{ full_name: string; deleted_at: Date | null }>('SELECT full_name, deleted_at FROM users WHERE id = $1', [u.id]);
    expect(row).toMatchObject({ full_name: 'Deleted user' });
    expect(row!.deleted_at).not.toBeNull();
    // The address can be used again for a fresh account.
    expect((await api().post('/api/v1/auth/register').send({ full_name: 'Back again', email: u.email, password: PASSWORD })).status).toBe(201);
  });

  it('will not delete the only admin', async () => {
    const token = await login('admin@vertexon.demo');
    const res = await api().delete('/api/v1/users/me').set(auth(token)).send({ confirm: 'DELETE', password: PASSWORD });
    expect(res.status).toBe(409);
  });
});

describe('spaced-repetition flashcards', () => {
  let cardIds: string[] = [];

  beforeAll(async () => {
    cardIds = (
      await query<{ id: string }>(
        `INSERT INTO flashcards (module_id, question, answer) VALUES
           ($1, 'What does REST stand for?', 'Representational State Transfer'),
           ($1, 'Idempotent HTTP verbs?', 'GET, PUT, DELETE')
         RETURNING id`,
        [moduleId],
      )
    ).map((r) => r.id);
  });

  it('shows new cards as due, then schedules a "good" card for tomorrow', async () => {
    const token = await login('student2@vertexon.demo');
    const summary = await api().get('/api/v1/users/me/flashcards').set(auth(token));
    expect(summary.body.new).toBeGreaterThanOrEqual(2);

    const due = await api().get(`/api/v1/users/me/flashcards/due?course_id=${courseId}`).set(auth(token));
    expect(due.body.items.map((c: { id: string }) => c.id)).toEqual(expect.arrayContaining(cardIds));

    const r = await api().post(`/api/v1/flashcards/${cardIds[0]}/review`).set(auth(token)).send({ rating: 'good' });
    expect(r.status).toBe(200);
    expect(r.body.interval_days).toBe(1);
    const after = await api().get(`/api/v1/users/me/flashcards/due?course_id=${courseId}`).set(auth(token));
    expect(after.body.items.map((c: { id: string }) => c.id)).not.toContain(cardIds[0]);
  });

  it('keeps a missed card in today’s queue (due in 10 minutes)', async () => {
    const token = await login('student2@vertexon.demo');
    const r = await api().post(`/api/v1/flashcards/${cardIds[1]}/review`).set(auth(token)).send({ rating: 'again' });
    const mins = (new Date(r.body.due_at).getTime() - Date.now()) / 60_000;
    expect(mins).toBeGreaterThan(8);
    expect(mins).toBeLessThan(11);
  });

  it('refuses reviews from learners not enrolled in the course', async () => {
    const u = await register('fc-outsider');
    expect((await api().post(`/api/v1/flashcards/${cardIds[0]}/review`).set(auth(u.token)).send({ rating: 'good' })).status).toBe(403);
  });
});

describe('explain my mistake', () => {
  let attemptId = '';
  let wrongQ = '';
  let rightQ = '';

  beforeAll(async () => {
    const token = await login('student2@vertexon.demo');
    const quiz = await queryOne<{ id: string }>('SELECT id FROM quizzes WHERE module_id IN (SELECT id FROM modules WHERE course_id = $1) LIMIT 1', [courseId]);
    const detail = (await api().get(`/api/v1/quizzes/${quiz!.id}`).set(auth(token))).body;
    const correct = await query<{ question_id: string; id: string }>(
      'SELECT question_id, id FROM quiz_options WHERE is_correct AND question_id = ANY($1)',
      [detail.questions.map((q: { id: string }) => q.id)],
    );
    const attempt = (await api().post(`/api/v1/quizzes/${quiz!.id}/attempt`).set(auth(token)).send({})).body;
    attemptId = attempt.id;
    const answers = detail.questions.map((q: { id: string; options: { id: string }[] }, i: number) => {
      const right = correct.find((c) => c.question_id === q.id)!.id;
      const wrong = q.options.find((o) => o.id !== right)!.id;
      return { question_id: q.id, selected_option_ids: [i === 0 ? wrong : right] };
    });
    wrongQ = answers[0].question_id;
    expect((await api().post(`/api/v1/attempts/${attemptId}/submit`).set(auth(token)).send({ answers })).status).toBe(200);
    // Use whichever answer the grader actually marked correct (a single option
    // is not a full answer to a multi-select question).
    rightQ = (await queryOne<{ question_id: string }>('SELECT question_id FROM quiz_answers WHERE attempt_id = $1 AND is_correct', [attemptId]))?.question_id ?? '';
  });

  it('explains a wrong answer with what was chosen and what is right, then serves it from cache', async () => {
    const token = await login('student2@vertexon.demo');
    const before = aiCalls;
    const res = await api().post(`/api/v1/ai/attempts/${attemptId}/questions/${wrongQ}/explain`).set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.explanation).toMatch(/You chose .+; the right answer is .+/);
    const again = await api().post(`/api/v1/ai/attempts/${attemptId}/questions/${wrongQ}/explain`).set(auth(token));
    expect(again.body.cached).toBe(true);
    expect(aiCalls - before).toBe(1);
  });

  it('declines correct answers and other learners’ attempts', async () => {
    const token = await login('student2@vertexon.demo');
    if (rightQ) {
      expect((await api().post(`/api/v1/ai/attempts/${attemptId}/questions/${rightQ}/explain`).set(auth(token))).status).toBe(400);
    }
    const other = await login('student@vertexon.demo');
    expect((await api().post(`/api/v1/ai/attempts/${attemptId}/questions/${wrongQ}/explain`).set(auth(other))).status).toBe(404);
  });
});

describe('at-risk learners', () => {
  it('flags an inactive, stalled learner with reasons and lets the instructor nudge once a day', async () => {
    const student2 = await queryOne<{ id: string }>("SELECT id FROM users WHERE full_name = 'Vikram Student'");
    await query(
      "UPDATE enrollments SET enrolled_at = now() - interval '30 days', progress_percent = 10 WHERE user_id = $1 AND course_id = $2",
      [student2!.id, courseId],
    );
    await query(
      `UPDATE lecture_progress SET last_watched_at = now() - interval '20 days'
       WHERE enrollment_id = (SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2)`,
      [student2!.id, courseId],
    );
    await query(
      `UPDATE quiz_attempts SET submitted_at = now() - interval '20 days' WHERE user_id = $1`,
      [student2!.id],
    );
    const token = await login('instructor@vertexon.demo');
    const res = await api().get(`/api/v1/courses/${courseId}/at-risk`).set(auth(token));
    expect(res.status).toBe(200);
    const vikram = res.body.items.find((i: { user_id: string }) => i.user_id === student2!.id);
    expect(vikram.reasons).toEqual(expect.arrayContaining(['inactive', 'stalled']));

    const nudge = () =>
      api().post(`/api/v1/courses/${courseId}/learners/${student2!.id}/nudge`).set(auth(token)).send({ message: 'We miss you — the next module is a short one!' });
    expect((await nudge()).status).toBe(201);
    expect((await nudge()).status).toBe(409);
    const note = await queryOne("SELECT 1 FROM notifications WHERE user_id = $1 AND title LIKE 'A note from your instructor%'", [student2!.id]);
    expect(note).not.toBeNull();
  });

  it('is only visible to the course owner', async () => {
    const token = await login('student@vertexon.demo');
    expect((await api().get(`/api/v1/courses/${courseId}/at-risk`).set(auth(token))).status).toBe(403);
  });
});

describe('live classes', () => {
  it('lets enrolled learners join in the window, records attendance, and hides the link otherwise', async () => {
    const instructor = await login('instructor@vertexon.demo');
    const soon = new Date(Date.now() + 5 * 60_000).toISOString();
    const created = await api()
      .post(`/api/v1/courses/${courseId}/live-sessions`)
      .set(auth(instructor))
      .send({ title: 'Office hours', starts_at: soon, duration_minutes: 45, join_url: 'https://meet.google.com/abc-defg-hij' });
    expect(created.status).toBe(201);

    const student = await login('student@vertexon.demo');
    const list = await api().get(`/api/v1/courses/${courseId}/live-sessions`).set(auth(student));
    const item = list.body.items.find((s: { id: string }) => s.id === created.body.id);
    expect(item.window).toBe('open');
    expect(item.join_url).toBeUndefined(); // only via /join

    const join = await api().post(`/api/v1/live-sessions/${created.body.id}/join`).set(auth(student));
    expect(join.body).toEqual({ join_url: 'https://meet.google.com/abc-defg-hij', attendance_recorded: true });

    const att = await api().get(`/api/v1/live-sessions/${created.body.id}/attendance`).set(auth(instructor));
    expect(att.body.items.map((a: { full_name: string }) => a.full_name)).toContain('Ananya Student');

    const outsider = await register('live-outsider');
    expect((await api().post(`/api/v1/live-sessions/${created.body.id}/join`).set(auth(outsider.token))).status).toBe(403);
  });

  it('keeps the link closed until 15 minutes before the start', async () => {
    const instructor = await login('instructor@vertexon.demo');
    const later = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const created = await api()
      .post(`/api/v1/courses/${courseId}/live-sessions`)
      .set(auth(instructor))
      .send({ title: 'Next week', starts_at: later, duration_minutes: 60, join_url: 'https://zoom.us/j/123' });
    const student = await login('student@vertexon.demo');
    expect((await api().post(`/api/v1/live-sessions/${created.body.id}/join`).set(auth(student))).status).toBe(400);
    expect((await api().delete(`/api/v1/live-sessions/${created.body.id}`).set(auth(instructor))).status).toBe(200);
  });

  it('rejects non-https meeting links', async () => {
    const instructor = await login('instructor@vertexon.demo');
    const res = await api()
      .post(`/api/v1/courses/${courseId}/live-sessions`)
      .set(auth(instructor))
      .send({ title: 'Bad link', starts_at: new Date(Date.now() + 3600_000).toISOString(), duration_minutes: 30, join_url: 'http://example.org/x' });
    expect(res.status).toBe(400);
  });
});

describe('Socratic chat style', () => {
  it('stores the style on chat sessions, defaulting to direct', async () => {
    const col = await queryOne<{ column_default: string }>(
      "SELECT column_default FROM information_schema.columns WHERE table_name = 'ai_chat_sessions' AND column_name = 'style'",
    );
    expect(col!.column_default).toMatch(/direct/);
  });
});

void app;
