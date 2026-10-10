import { z } from 'zod';

/** Treats `undefined`/empty-string query params as absent (forms send ""). */
const optionalStr = z.preprocess(
  (v) => (v === undefined || v === '' ? undefined : v),
  z.string().trim().max(200).optional(),
);

const difficulty = z.enum(['beginner', 'intermediate', 'advanced']).optional();

export const createCourseSchema = z.object({
  title: z.string().trim().min(3, 'title must be at least 3 characters').max(200),
  description: z.string().max(5000).optional(),
  category: z.string().trim().max(80).optional(),
  difficulty,
  thumbnail_url: z.string().url().optional().or(z.literal('')),
  price: z.coerce.number().min(0).max(9_999_999).optional(),
});

export const updateCourseSchema = createCourseSchema.partial();

export const catalogQuerySchema = z.object({
  q: optionalStr,
  category: z.preprocess(
    (v) => (v === undefined || v === '' ? undefined : v),
    z.string().trim().max(80).optional(),
  ),
  difficulty: z.preprocess(
    (v) => (v === undefined || v === '' ? undefined : v),
    z.enum(['beginner', 'intermediate', 'advanced']).optional(),
  ),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
  mine: z.preprocess(
    (v) => (v === undefined || v === '' || v === '0' || v === 'false' ? undefined : v),
    z.union([z.literal('1'), z.literal('true')]).optional(),
  ),
});

export const createModuleSchema = z.object({
  title: z.string().trim().min(2).max(200),
  order_index: z.coerce.number().int().min(0).optional(),
});

export const createLectureSchema = z.object({
  title: z.string().trim().min(2).max(200),
  video_url: z.string().url().optional().or(z.literal('')),
  transcript: z.string().optional(),
  duration_seconds: z.coerce.number().int().min(0).optional(),
  order_index: z.coerce.number().int().min(0).optional(),
  // JSON callers send an array; multipart callers can only send strings, so
  // accept a JSON array or a comma-separated list too (FR-I2 uploads).
  resource_urls: z
    .union([z.array(z.string().max(500)), z.string().max(5000)])
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      if (Array.isArray(value)) return value;
      const trimmed = value.trim();
      if (!trimmed) return [];
      if (trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) return parsed.map(String);
        } catch {
          // not JSON — fall through to comma splitting
        }
      }
      return trimmed
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
    }),
});

export const approveCourseSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  comment: z.string().max(1000).optional(),
});

export type CatalogQuery = z.infer<typeof catalogQuerySchema>;
export type CreateCourseInput = z.infer<typeof createCourseSchema>;
export type CreateModuleInput = z.infer<typeof createModuleSchema>;
export type CreateLectureInput = z.infer<typeof createLectureSchema>;
export type ApproveCourseInput = z.infer<typeof approveCourseSchema>;
