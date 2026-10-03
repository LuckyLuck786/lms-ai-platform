import { describe, expect, beforeEach, it } from 'vitest';
import type { AxiosRequestConfig } from 'axios';
import { demoAdapter, resetDemoState } from './server';

/**
 * The demo backend is a real implementation of the `/api/v1` contract, so it
 * gets the same treatment as the rest of the codebase: if its behaviour drifts
 * from the FastAPI routes, a deployed demo site would quietly lie about what
 * the product does.
 */

async function call<T = any>(
  method: string,
  url: string,
  data?: unknown,
): Promise<{ status: number; data: T }> {
  const config = {
    method,
    url,
    data: typeof data === 'string' || data === undefined ? data : JSON.stringify(data),
    headers: {},
  } as unknown as AxiosRequestConfig;

  const response = await demoAdapter(config as any);
  return { status: response.status, data: response.data as T };
}

async function expectError(fn: () => Promise<unknown>, status: number, code?: string) {
  await expect(fn()).rejects.toMatchObject({
    isAxiosError: true,
    response: { status, data: code ? { error: { code } } : expect.anything() },
  });
}

const login = (email: string) => call('POST', '/auth/login', { email, password: 'DemoPass123!' });

describe('demo backend', () => {
  beforeEach(() => {
    resetDemoState();
  });

  describe('auth', () => {
    it('rejects an unknown email and a wrong password with the standard envelope', async () => {
      await expectError(() => login('nobody@vertexon.demo'), 401, 'INVALID_CREDENTIALS');
      await expectError(
        () => call('POST', '/auth/login', { email: 'student@vertexon.demo', password: 'wrong' }),
        401,
        'INVALID_CREDENTIALS',
      );
    });

    it('rejects protected routes until signed in', async () => {
      await expectError(() => call('GET', '/enrollments/me'), 401, 'UNAUTHENTICATED');
    });

    it('issues a token and the public user shape on success', async () => {
      const { data } = await login('student@vertexon.demo');
      expect(data.access_token).toMatch(/^demo-access\./);
      expect(data.user.email).toBe('student@vertexon.demo');
      expect(data.user.roles).toEqual(['student']);
      expect(data.user).not.toHaveProperty('password');
    });
  });

  describe('catalog', () => {
    it('hides unapproved courses from anonymous visitors but keeps them for staff', async () => {
      const anonymous = await call('GET', '/courses');
      expect(anonymous.data.items.map((c: any) => c.id)).not.toContain('c-k8s');
      expect(anonymous.data.items[0]).not.toHaveProperty('modules');

      await login('instructor2@vertexon.demo'); // owns the pending course
      const asOwner = await call('GET', '/courses');
      expect(asOwner.data.items.map((c: any) => c.id)).toContain('c-k8s');

      const mine = await call('GET', '/courses?mine=1');
      expect(mine.data.items.map((c: any) => c.id).sort()).toEqual(['c-dl', 'c-k8s', 'c-pm', 'c-sql']);
    });

    it('filters by search term, category and difficulty', async () => {
      const { data } = await call('GET', '/courses?category=Mathematics');
      expect(data.items.map((c: any) => c.title)).toEqual(['Linear Algebra Essentials']);

      const search = await call('GET', '/courses?q=analytics');
      expect(search.data.total).toBe(1);

      const advanced = await call('GET', '/courses?difficulty=advanced');
      expect(advanced.data.items.every((c: any) => c.difficulty === 'advanced')).toBe(true);
    });
  });

  describe('quiz grading', () => {
    it('never leaks the answer key to the student payload', async () => {
      const { data } = await call('GET', '/quizzes/q-rag');
      for (const question of data.questions) {
        for (const option of question.options) {
          expect(option).not.toHaveProperty('is_correct');
        }
      }
    });

    it('scores a fully correct attempt at 100', async () => {
      await login('student@vertexon.demo');
      const { data: quiz } = await call('GET', '/quizzes/q-rag');
      const attempt = await call('POST', `/quizzes/${quiz.id}/attempt`, {});

      const { data: result } = await call('POST', `/attempts/${attempt.data.id}/submit`, {
        answers: [
          { question_id: 'q-rag-1', selected_option_ids: ['o-r2'] },
          { question_id: 'q-rag-2', selected_option_ids: ['o-r5', 'o-r6', 'o-r4'] },
          { question_id: 'q-rag-3', selected_option_ids: ['o-r8'] },
        ],
      });

      expect(result.score).toBe(100);
      expect(result.per_question.every((r: any) => r.is_correct === true)).toBe(true);
    });

    it('scores a fully wrong attempt at 0', async () => {
      await login('student@vertexon.demo');
      const attempt = await call('POST', '/quizzes/q-rag/attempt', {});
      const { data } = await call('POST', `/attempts/${attempt.data.id}/submit`, {
        answers: [
          { question_id: 'q-rag-1', selected_option_ids: ['o-r1'] },
          { question_id: 'q-rag-2', selected_option_ids: ['o-r4'] },
          { question_id: 'q-rag-3', selected_option_ids: ['o-r10'] },
        ],
      });
      expect(data.score).toBe(0);
    });

    it('treats a partial multi-select as wrong and a written answer as ungraded', async () => {
      await login('student@vertexon.demo');

      const partial = await call('POST', '/quizzes/q-rag/attempt', {});
      const graded = await call('POST', `/attempts/${partial.data.id}/submit`, {
        answers: [{ question_id: 'q-rag-2', selected_option_ids: ['o-r4', 'o-r5'] }],
      });
      expect(graded.data.score).toBe(0);

      // A written answer is excluded from the score entirely, so answering all
      // two auto-gradable questions correctly still scores 100.
      const written = await call('POST', '/quizzes/q-ml/attempt', {});
      const result = await call('POST', `/attempts/${written.data.id}/submit`, {
        answers: [
          { question_id: 'q-ml-3', text_answer: 'A better estimate of generalisation error.' },
          { question_id: 'q-ml-1', selected_option_ids: ['o-m1'] },
          { question_id: 'q-ml-2', selected_option_ids: ['o-m5', 'o-m6', 'o-m4'] },
        ],
      });
      expect(result.data.score).toBe(100);
      expect(result.data.per_question).toContainEqual({ question_id: 'q-ml-3', is_correct: null });
    });

    it("refuses to grade somebody else's attempt", async () => {
      await login('student@vertexon.demo');
      const attempt = await call('POST', '/quizzes/q-rag/attempt', {});
      await login('student2@vertexon.demo');
      await expectError(
        () => call('POST', `/attempts/${attempt.data.id}/submit`, { answers: [] }),
        403,
        'FORBIDDEN',
      );
    });
  });

  describe('course access', () => {
    it('limits the forum and announcements to enrolled learners and staff', async () => {
      await login('student@vertexon.demo'); // enrolled in c-rag
      expect((await call('GET', '/courses/c-rag/threads')).data.items.length).toBeGreaterThan(0);
      expect((await call('GET', '/courses/c-rag/announcements')).data.items.length).toBeGreaterThan(0);

      await expectError(() => call('GET', '/courses/c-dl/threads'), 403, 'FORBIDDEN');
      await expectError(() => call('GET', '/courses/c-dl/announcements'), 403, 'FORBIDDEN');
    });

    it('lets the instructor read their own course without an enrolment', async () => {
      await login('instructor2@vertexon.demo'); // owns c-dl, c-sql, c-pm, c-k8s
      expect((await call('GET', '/courses/c-dl/announcements')).status).toBe(200);
    });

    it('blocks a student from publishing an announcement', async () => {
      await login('student@vertexon.demo');
      await expectError(
        () => call('POST', '/courses/c-rag/announcements', { content: 'nope' }),
        403,
        'FORBIDDEN',
      );
    });
  });

  describe('instructor authoring', () => {
    it('creates a course in pending state and adds modules, lectures and quizzes', async () => {
      await login('instructor@vertexon.demo');

      const course: any = (await call('POST', '/courses', {
        title: 'Building AI Agents with Tool Use',
        description: 'Plan, call tools, verify results.',
        category: 'Computer Science',
        difficulty: 'advanced',
        price: 39,
      })).data;
      expect(course.status).toBe('pending');

      const mod: any = (await call('POST', `/courses/${course.id}/modules`, {
        title: 'Module 1: Tool calling',
      })).data;
      expect(mod.order_index).toBe(0);

      const lecture: any = (await call('POST', `/modules/${mod.id}/lectures`, {
        title: 'Schemas and validation',
        duration_seconds: 720,
        transcript: 'A tool schema declares the arguments. Validate before dispatch.',
      })).data;
      expect(lecture.module_id).toBe(mod.id);

      const quiz: any = (await call('POST', '/quizzes', {
        module_id: mod.id,
        title: 'Tool calling check',
        questions: [
          {
            question_text: 'Which field describes the arguments?',
            question_type: 'mcq',
            options: [
              { option_text: 'input_schema', is_correct: true },
              { option_text: 'handler', is_correct: false },
            ],
          },
        ],
      })).data;
      expect(quiz.question_count).toBe(1);

      // Admin approves it, then a student can enrol and take the new quiz.
      await login('admin@vertexon.demo');
      const approved: any = (await call('POST', `/courses/${course.id}/approve`, {
        decision: 'approved',
      })).data;
      expect(approved.status).toBe('approved');

      await login('student2@vertexon.demo');
      await call('POST', `/courses/${course.id}/enroll`, {});
      const taken: any = (await call('GET', `/quizzes/${quiz.id}`)).data;
      const correctId = taken.questions[0].options[0].id;
      const attempt: any = await call('POST', `/quizzes/${quiz.id}/attempt`, {});
      const graded: any = (await call('POST', `/attempts/${attempt.data.id}/submit`, {
        answers: [{ question_id: taken.questions[0].id, selected_option_ids: [correctId] }],
      })).data;
      expect(graded.score).toBe(100);
    });

    it('stops an instructor from editing somebody else’s course', async () => {
      await login('instructor@vertexon.demo');
      await expectError(() => call('POST', '/courses/c-dl/modules', { title: 'nope' }), 403);
    });

    it('fans an announcement out to every enrolled learner', async () => {
      await login('instructor@vertexon.demo');
      const posted: any = (await call('POST', '/courses/c-rag/announcements', {
        content: 'Office hours moved to Thursday.',
      })).data;
      expect(posted.notified).toBeGreaterThan(0);

      await login('student@vertexon.demo');
      const { data } = await call('GET', '/users/me/notifications');
      expect(data.items[0].title).toBe('Announcement: Full-Stack Web Development Bootcamp');
    });
  });

  describe('progress', () => {
    it('derives course progress from watched seconds and completions', async () => {
      await login('student@vertexon.demo');
      const before = await call('GET', '/enrollments/me');
      const cSql = before.data.items.find((e: any) => e.course_id === 'c-sql');
      expect(cSql.progress_percent).toBe('20');

      await call('POST', '/lectures/l-sql-2/progress', { watched_seconds: 810 });
      const after = await call('GET', '/enrollments/me');
      const updated = after.data.items.find((e: any) => e.course_id === 'c-sql');
      expect(Number(updated.progress_percent)).toBeGreaterThan(20);
    });

    it('completes a lecture once it has been watched to the end', async () => {
      await login('student@vertexon.demo');
      const { data } = await call('POST', '/lectures/l-ml-3/progress', { watched_seconds: 642 });
      expect(data.completed).toBe(true);
    });
  });

  describe('enrolment', () => {
    it('is idempotent and rejects enrolling twice', async () => {
      await login('student2@vertexon.demo');
      const { data } = await call('POST', '/courses/c-dl/enroll', {});
      expect(data.course_id).toBe('c-dl');
      await expectError(() => call('POST', '/courses/c-dl/enroll', {}), 409, 'ALREADY_ENROLLED');
    });

    it('refuses to enrol in a course still pending approval', async () => {
      await login('student2@vertexon.demo');
      await expectError(() => call('POST', '/courses/c-k8s/enroll', {}), 409, 'NOT_APPROVED');
    });
  });

  describe('AI endpoints', () => {
    it('answers the tutor with transcript citations', async () => {
      await login('student@vertexon.demo');
      const session = await call('POST', '/ai/chat/sessions', { course_id: 'c-rag' });
      const { data } = await call('POST', `/ai/chat/sessions/${session.data.id}/messages`, {
        message: 'what belongs in the error envelope?',
      });

      expect(data.mode).toBe('intermediate');
      expect(data.sources.length).toBeGreaterThan(0);
      expect(data.sources[0].lecture_id).toBeTruthy();
      expect(data.reply.toLowerCase()).toContain('envelope');
    });

    it('changes the explanation depth', async () => {
      await login('student@vertexon.demo');
      const { data } = await call('PUT', '/ai/chat/sessions/cs-1/mode', { mode: 'beginner' });
      expect(data.mode).toBe('beginner');
      await expectError(() => call('PUT', '/ai/chat/sessions/cs-1/mode', { mode: 'wizard' }), 422);
    });

    it('builds a study plan from the learner’s own enrolments', async () => {
      await login('student@vertexon.demo');
      const { data } = await call('POST', '/ai/study-plan', {});
      expect(data.plan.items.length).toBeGreaterThan(0);
      expect(data.plan.items.every((i: any) => typeof i.reason === 'string')).toBe(true);
    });
  });

  describe('admin', () => {
    it('is closed to non-admins', async () => {
      await login('instructor@vertexon.demo');
      await expectError(() => call('GET', '/admin/analytics/overview'), 403, 'FORBIDDEN');
    });

    it('reports metrics, pending approvals and flagged posts', async () => {
      await login('admin@vertexon.demo');
      const overview = await call('GET', '/admin/analytics/overview');
      expect(overview.data.pending_courses).toBeGreaterThan(0);
      expect(overview.data.flagged_posts).toBe(1);

      const pending = await call('GET', '/admin/courses/pending');
      expect(pending.data.items.map((c: any) => c.id)).toEqual(['c-k8s']);

      const flagged = await call('GET', '/admin/moderation/flagged-posts');
      expect(flagged.data.items[0].thread_title).toBeTruthy();

      const removed = await call('DELETE', `/admin/moderation/posts/${flagged.data.items[0].id}`);
      expect(removed.status).toBe(200);
    });

    it('refuses to let an admin suspend themselves', async () => {
      await login('admin@vertexon.demo');
      await expectError(() => call('PUT', '/admin/users/u-admin/suspend', { is_active: false }), 422);
    });
  });

  describe('certificate download', () => {
    it('returns a real PDF for the signed-in learner', async () => {
      await login('student@vertexon.demo');
      const config = { method: 'GET', url: '/certificates/cert-1/download', headers: {} } as any;
      const response = await demoAdapter(config);

      expect(response.headers['content-type']).toBe('application/pdf');
      const text = await (response.data as Blob).text();
      expect(text.startsWith('%PDF-1.4')).toBe(true);
      expect(text).toContain('/Type /Catalog');
      expect(text).toContain('Riya Sharma');
      expect(text).toContain('Linear Algebra Essentials');
      // The cross-reference table must point at the four bytes of "xref".
      expect(text).toContain(`startxref\n${text.indexOf('xref\n0 ')}\n%%EOF`);
    });

    it("refuses another learner's certificate", async () => {
      await login('student2@vertexon.demo');
      const config = { method: 'GET', url: '/certificates/cert-1/download', headers: {} } as any;
      await expect(demoAdapter(config)).rejects.toMatchObject({
        response: { status: 403, data: { error: { code: 'FORBIDDEN' } } },
      });
    });
  });

  describe('routing', () => {
    it('404s unknown paths and 405s unsupported methods', async () => {
      await login('student@vertexon.demo');
      await expectError(() => call('GET', '/nope'), 404, 'NOT_FOUND');
      await expectError(() => call('DELETE', '/courses/c-rag'), 405, 'METHOD_NOT_ALLOWED');
    });
  });
});