import { z } from 'zod';

const questionType = z.enum(['mcq', 'multi_select', 'short_answer']);

const optionSchema = z.object({
  option_text: z.string().trim().min(1).max(1000),
  is_correct: z.boolean().default(false),
});

const questionSchema = z.object({
  question_text: z.string().trim().min(1).max(4000),
  question_type: questionType,
  options: z.array(optionSchema).min(2, 'each question needs at least 2 options').max(10),
});

export const createQuizSchema = z
  .object({
    module_id: z.string().uuid(),
    title: z.string().trim().min(2).max(200),
    is_ai_generated: z.boolean().optional(),
    generated_from_lecture_id: z.string().uuid().optional(),
    questions: z.array(questionSchema).min(1, 'a quiz needs at least one question').max(50),
  })
  .superRefine((quiz, ctx) => {
    quiz.questions.forEach((q, i) => {
      if (q.question_type === 'short_answer') return;
      const correct = q.options.filter((o) => o.is_correct);
      if (q.question_type === 'mcq' && correct.length !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['questions', i, 'options'],
          message: 'MCQ questions must have exactly one correct option',
        });
      }
      if (q.question_type === 'multi_select' && correct.length < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['questions', i, 'options'],
          message: 'multi_select questions need at least one correct option',
        });
      }
    });
  });

export const startAttemptSchema = z.object({});

export const submitAttemptSchema = z.object({
  answers: z
    .array(
      z.object({
        question_id: z.string().uuid(),
        selected_option_ids: z.array(z.string().uuid()).optional(),
        text_answer: z.string().max(4000).optional(),
      }),
    )
    .max(50),
});

export type CreateQuizInput = z.infer<typeof createQuizSchema>;
export type SubmitAttemptInput = z.infer<typeof submitAttemptSchema>;
