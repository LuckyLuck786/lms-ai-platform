import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/utils/password';

describe('password hashing', () => {
  it('hashes and verifies a password', async () => {
    const hash = await hashPassword('SecurePass123');
    expect(hash).not.toBe('SecurePass123');
    expect(await verifyPassword('SecurePass123', hash)).toBe(true);
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });
});
