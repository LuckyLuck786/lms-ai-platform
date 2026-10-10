import { query, queryOne, withTransaction } from '../../db/pool';
import { forbidden, notFound, conflict, badRequest } from '../../utils/errors';
import { AuthUser } from '../../middleware/auth';
import { gradeAttempt, QuestionForGrading } from '../../utils/grading';
import { touchStreak } from '../gamification/gamification.service';
import { awardBadge } from '../../utils/badges';
import { queueMasteryRecompute } from '../../jobs/queues';
import { cacheDel } from '../../db/redis';
import { CreateQuizInput, SubmitAttemptInput } from './quizzes.schemas';

async function requireOwnedCourseOfModule(user: AuthUser, moduleId: string) {
  const mod = await queryOne<{ course_id: string }>('SELECT course_id FROM modules WHERE id = $1', [
    moduleId,
  ]);
  if (!mod) throw notFound('Module not found');
  const course = await queryOne<{ instructor_id: string }>('SELECT instructor_id FROM courses WHERE id = $1', [
    mod.course_id,
  ]);
  if (!course) throw notFound('Course not found');
  const isOwner = course.instructor_id === user.id;
  const isAdmin = user.roles.includes('admin');
  if (!isOwner && !isAdmin) throw forbidden('You do not own this course');
  return mod;
}

export async function createQuiz(user: AuthUser, input: CreateQuizInput) {
  await requireOwnedCourseOfModule(user, input.module_id);

  const quiz = await withTransaction(async (client) => {
    const quizRow = await client.query(
      `INSERT INTO quizzes (module_id, title, is_ai_generated, generated_from_lecture_id)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [input.module_id, input.title, input.is_ai_generated ?? false, input.generated_from_lecture_id ?? null],
    );
    const quizId = quizRow.rows[0].id as string;

    for (const [idx, q] of input.questions.entries()) {
      const qRow = await client.query(
        `INSERT INTO quiz_questions (quiz_id, question_text, question_type, order_index)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [quizId, q.question_text, q.question_type, idx],
      );
      const questionId = qRow.rows[0].id as string;
      for (const opt of q.options) {
        await client.query(
          'INSERT INTO quiz_options (question_id, option_text, is_correct) VALUES ($1, $2, $3)',
          [questionId, opt.option_text, q.question_type === 'short_answer' ? false : opt.is_correct],
        );
      }
    }
    return quizRow.rows[0];
  });

  await cacheDel('quizzes:*');
  return quiz;
}

/** Full quiz including correctness — instructors/admins only. */
async function getQuizWithAnswers(quizId: string) {
  const quiz = await queryOne('SELECT * FROM quizzes WHERE id = $1', [quizId]);
  if (!quiz) throw notFound('Quiz not found');
  const questions = await query(
    'SELECT id, question_text, question_type, order_index FROM quiz_questions WHERE quiz_id = $1 ORDER BY order_index',
    [quizId],
  );
  const questionIds = questions.map((q) => (q as { id: string }).id);
  const options = questionIds.length
    ? await query(
        'SELECT id, question_id, option_text, is_correct FROM quiz_options WHERE question_id = ANY($1) ORDER BY id',
        [questionIds],
      )
    : [];
  return {
    quiz,
    questions: questions.map((q) => ({
      ...(q as object),
      options: options.filter((o) => (o as { question_id: string }).question_id === (q as { id: string }).id),
    })),
  };
}

/**
 * GET /quizzes/:id — students get a safe payload (no `is_correct`),
 * instructors/admins get the full version for review.
 */
export async function getQuiz(quizId: string, user: AuthUser) {
  const { quiz, questions } = await getQuizWithAnswers(quizId);
  const staff = user.roles.includes('instructor') || user.roles.includes('admin');
  const safe = questions.map((q) => ({
    ...(q as object),
    options: ((q as { options: { id: string; question_id: string; option_text: string; is_correct: boolean }[] })
      .options ?? []).map((o) => ({
      id: o.id,
      option_text: o.option_text,
      ...(staff ? { is_correct: o.is_correct } : {}),
    })),
  }));
  return { ...quiz, questions: safe, show_answers: staff };
}

export async function listQuizzesForModule(moduleId: string) {
  return query(
    `SELECT q.id, q.title, q.module_id, q.is_ai_generated,
            (SELECT count(*)::int FROM quiz_questions WHERE quiz_id = q.id) AS question_count
     FROM quizzes q WHERE q.module_id = $1 ORDER BY q.title`,
    [moduleId],
  );
}

/** Students may only attempt quizzes in courses they're enrolled in. */
async function requireEnrolledForQuiz(userId: string, quizId: string) {
  const row = await queryOne<{ course_id: string }>(
    `SELECT c.id AS course_id
     FROM quizzes q
     JOIN modules m ON m.id = q.module_id
     JOIN courses c ON c.id = m.course_id
     JOIN enrollments e ON e.course_id = c.id AND e.user_id = $1
     WHERE q.id = $2`,
    [userId, quizId],
  );
  if (!row) throw forbidden('You are not enrolled in this course');
  return row.course_id;
}

export async function startAttempt(user: AuthUser, quizId: string) {
  await requireEnrolledForQuiz(user.id, quizId);

  const open = await queryOne(
    'SELECT id, started_at FROM quiz_attempts WHERE quiz_id = $1 AND user_id = $2 AND submitted_at IS NULL',
    [quizId, user.id],
  );
  if (open) return open; // resume existing attempt

  const attempt = await queryOne(
    'INSERT INTO quiz_attempts (quiz_id, user_id) VALUES ($1, $2) RETURNING *',
    [quizId, user.id],
  );
  return attempt;
}

/**
 * POST /attempts/:id/submit — auto-grade objective questions, persist
 * answers, store score. One-shot: re-submission returns 409.
 */
export async function submitAttempt(user: AuthUser, attemptId: string, input: SubmitAttemptInput) {
  const attempt = await queryOne<{
    id: string;
    quiz_id: string;
    user_id: string;
    submitted_at: Date | null;
  }>('SELECT id, quiz_id, user_id, submitted_at FROM quiz_attempts WHERE id = $1', [attemptId]);
  if (!attempt) throw notFound('Attempt not found');
  if (attempt.user_id !== user.id) throw forbidden('This attempt belongs to another user');
  if (attempt.submitted_at) throw conflict('Attempt already submitted');

  const course = await requireEnrolledForQuiz(user.id, attempt.quiz_id);

  const questions = await query<{ id: string; question_type: 'mcq' | 'multi_select' | 'short_answer' }>(
    'SELECT id, question_type FROM quiz_questions WHERE quiz_id = $1',
    [attempt.quiz_id],
  );
  const questionIds = questions.map((q) => q.id);
  const correctOptions = questionIds.length
    ? await query<{ id: string; question_id: string }>(
        'SELECT id, question_id FROM quiz_options WHERE question_id = ANY($1) AND is_correct = TRUE',
        [questionIds],
      )
    : [];

  const unknown = input.answers.filter((a) => !questionIds.includes(a.question_id));
  if (unknown.length) throw badRequest('Unknown question_id in answers', 'answers');

  const forGrading: QuestionForGrading[] = questions.map((q) => ({
    id: q.id,
    question_type: q.question_type,
    correct_option_ids: correctOptions
      .filter((o) => o.question_id === q.id)
      .map((o) => o.id),
  }));

  // Unanswered questions grade as incorrect (gradeAttempt treats missing
  // answers as an empty selection).
  const { score, perQuestion } = gradeAttempt(forGrading, input.answers);

  await withTransaction(async (client) => {
    for (const answer of input.answers) {
      await client.query(
        `INSERT INTO quiz_answers (attempt_id, question_id, selected_option_ids, text_answer, is_correct)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          attemptId,
          answer.question_id,
          answer.selected_option_ids ?? null,
          answer.text_answer ?? null,
          perQuestion.find((p) => p.question_id === answer.question_id)?.is_correct ?? null,
        ],
      );
    }
    await client.query('UPDATE quiz_attempts SET score = $2, submitted_at = now() WHERE id = $1', [
      attemptId,
      score,
    ]);
  });

  await touchStreak(user.id);
  if (score !== null && score >= 100) {
    await awardBadge(user.id, 'quiz_perfect_score');
  }
  // FR-A8: quiz scores feed topic mastery — recompute in the background.
  await queueMasteryRecompute({ userId: user.id, courseId: course });

  return {
    attempt_id: attemptId,
    score,
    per_question: perQuestion,
    course_id: course,
  };
}

export async function getAttempt(user: AuthUser, attemptId: string) {
  const attempt = await queryOne('SELECT * FROM quiz_attempts WHERE id = $1 AND user_id = $2', [
    attemptId,
    user.id,
  ]);
  if (!attempt) throw notFound('Attempt not found');
  const answers = await query(
    'SELECT question_id, selected_option_ids, text_answer, is_correct FROM quiz_answers WHERE attempt_id = $1',
    [attemptId],
  );
  return { ...attempt, answers };
}
