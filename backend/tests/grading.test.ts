import { describe, expect, it } from 'vitest';
import { gradeAttempt, QuestionForGrading } from '../src/utils/grading';

const mcq: QuestionForGrading = {
  id: 'q1',
  question_type: 'mcq',
  correct_option_ids: ['opt-b'],
};

const multi: QuestionForGrading = {
  id: 'q2',
  question_type: 'multi_select',
  correct_option_ids: ['opt-a', 'opt-c'],
};

const short: QuestionForGrading = {
  id: 'q3',
  question_type: 'short_answer',
  correct_option_ids: [],
};

describe('quiz auto-grading (FR-S7)', () => {
  it('scores MCQ correct/incorrect', () => {
    const ok = gradeAttempt([mcq], [{ question_id: 'q1', selected_option_ids: ['opt-b'] }]);
    expect(ok.score).toBe(100);

    const bad = gradeAttempt([mcq], [{ question_id: 'q1', selected_option_ids: ['opt-a'] }]);
    expect(bad.score).toBe(0);
  });

  it('requires an exact set match for multi_select', () => {
    const exact = gradeAttempt([multi], [{ question_id: 'q2', selected_option_ids: ['opt-c', 'opt-a'] }]);
    expect(exact.score).toBe(100);

    const partial = gradeAttempt([multi], [{ question_id: 'q2', selected_option_ids: ['opt-a'] }]);
    expect(partial.score).toBe(0);

    const extra = gradeAttempt([multi], [
      { question_id: 'q2', selected_option_ids: ['opt-a', 'opt-b', 'opt-c'] },
    ]);
    expect(extra.score).toBe(0);
  });

  it('leaves short_answer ungraded and excludes it from the score', () => {
    const result = gradeAttempt([mcq, short], [
      { question_id: 'q1', selected_option_ids: ['opt-b'] },
      { question_id: 'q3', text_answer: 'my essay' },
    ]);
    expect(result.score).toBe(100);
    const shortResult = result.perQuestion.find((p) => p.question_id === 'q3');
    expect(shortResult?.is_correct).toBeNull();
  });

  it('treats unanswered questions as incorrect', () => {
    expect(gradeAttempt([mcq], []).score).toBe(0);
  });

  it('returns null score when nothing is auto-gradable', () => {
    expect(gradeAttempt([short], [{ question_id: 'q3', text_answer: 'x' }])).toEqual({
      score: null,
      perQuestion: [{ question_id: 'q3', is_correct: null }],
    });
  });

  it('averages across multiple questions', () => {
    const result = gradeAttempt([mcq, multi], [
      { question_id: 'q1', selected_option_ids: ['opt-b'] }, // correct
      { question_id: 'q2', selected_option_ids: ['opt-a'] }, // incomplete
    ]);
    expect(result.score).toBe(50);
  });
});
