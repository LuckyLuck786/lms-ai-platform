import { z } from 'zod';

export const createAssignmentSchema = z.object({
  course_id: z.string().uuid(),
  title: z.string().trim().min(2).max(200),
  instructions: z.string().max(8000).optional(),
  rubric: z.array(z.object({ criterion: z.string(), weight: z.number().min(0).max(100) })).optional(),
  due_date: z.string().datetime({ offset: true }).optional().or(z.string().datetime()),
});

export const gradeSubmissionSchema = z.object({
  grade: z.coerce.number().min(0).max(100),
  feedback: z.string().max(4000).optional(),
});

export type CreateAssignmentInput = z.infer<typeof createAssignmentSchema>;
