import { z } from 'zod';

export const registerSchema = z.object({
  full_name: z.string().trim().min(2, 'full_name must be at least 2 characters').max(150),
  email: z.string().trim().email('email must be a valid email address').max(180),
  password: z
    .string()
    .min(8, 'password must be at least 8 characters')
    .max(128, 'password must be at most 128 characters'),
  // Self-registration is always "student"; role assignment is admin-only (FR-AD4).
  role: z.enum(['student', 'instructor']).optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().email('email must be a valid email address'),
  password: z.string().min(1, 'password is required'),
});

export const refreshSchema = z.object({
  refresh_token: z.string().min(1, 'refresh_token is required'),
});

export const logoutSchema = z.object({
  refresh_token: z.string().min(1, 'refresh_token is required'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
