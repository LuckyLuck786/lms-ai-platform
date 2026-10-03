import { describe, expect, it } from 'vitest';
import { loginSchema, registerSchema } from '../src/modules/auth/auth.schemas';

describe('auth schemas', () => {
  it('accepts a valid registration', () => {
    const parsed = registerSchema.parse({
      full_name: 'Ananya Sharma',
      email: 'ananya@example.com',
      password: 'SecurePass123',
    });
    expect(parsed.email).toBe('ananya@example.com');
    expect(parsed.role).toBeUndefined(); // defaults to student in service
  });

  it('rejects an invalid email with a field-aware message', () => {
    const result = registerSchema.safeParse({
      full_name: 'Ananya',
      email: 'not-an-email',
      password: 'SecurePass123',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain('email');
    }
  });

  it('rejects short passwords', () => {
    const result = registerSchema.safeParse({
      full_name: 'Ananya',
      email: 'a@b.co',
      password: 'short',
    });
    expect(result.success).toBe(false);
  });

  it('requires a password on login', () => {
    expect(loginSchema.safeParse({ email: 'a@b.co' }).success).toBe(false);
    expect(loginSchema.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true);
  });
});
