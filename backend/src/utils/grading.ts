/**
 * Pure auto-grading logic for quiz attempts (FR-S7).
 * - mcq: correct iff the single selected option is the correct one
 * - multi_select: correct iff the selected set exactly equals the correct set
 * - short_answer: never auto-graded (graded manually later), excluded from score
 *
 * Score is the percentage of auto-gradable questions answered correctly.
 */

export type QuestionType = 'mcq' | 'multi_select' | 'short_answer';

export interface QuestionForGrading {
  id: string;
  question_type: QuestionType;
  correct_option_ids: string[];
}

export interface AnswerForGrading {
  question_id: string;
  selected_option_ids?: string[] | null;
  text_answer?: string | null;
}

export interface GradeResult {
  /** Percentage 0-100 over auto-gradable questions; null if none are gradable. */
  score: number | null;
  perQuestion: { question_id: string; is_correct: boolean | null }[];
}

const sameSet = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((x) => setB.has(x));
};

export function gradeAttempt(questions: QuestionForGrading[], answers: AnswerForGrading[]): GradeResult {
  const answerByQuestion = new Map(answers.map((a) => [a.question_id, a]));
  const perQuestion: GradeResult['perQuestion'] = [];
  let gradable = 0;
  let correct = 0;

  for (const q of questions) {
    const answer = answerByQuestion.get(q.id);

    if (q.question_type === 'short_answer') {
      perQuestion.push({ question_id: q.id, is_correct: null }); // manual grading
      continue;
    }

    gradable += 1;
    const selected = (answer?.selected_option_ids ?? []).slice().sort();

    if (q.question_type === 'mcq') {
      const ok = selected.length === 1 && q.correct_option_ids[0] === selected[0];
      perQuestion.push({ question_id: q.id, is_correct: ok });
      if (ok) correct += 1;
    } else {
      // multi_select: exact set match, at least one option required
      const ok = selected.length > 0 && sameSet(selected, [...q.correct_option_ids].sort());
      perQuestion.push({ question_id: q.id, is_correct: ok });
      if (ok) correct += 1;
    }
  }

  return {
    score: gradable > 0 ? Math.round((correct / gradable) * 10000) / 100 : null,
    perQuestion,
  };
}
