import { describe, it, expect } from 'vitest';
import { decryptPii, emailHash, encryptPii, isEncrypted } from '../src/utils/pii';

describe('PII column encryption (NFR §6)', () => {
  it('round-trips a value', () => {
    expect(decryptPii(encryptPii('ananya@example.com'))).toBe('ananya@example.com');
  });

  it('never stores the plaintext, and encrypts the same value differently each time', () => {
    const a = encryptPii('ananya@example.com');
    const b = encryptPii('ananya@example.com');
    expect(a).not.toContain('ananya');
    expect(a).not.toBe(b);
    expect(isEncrypted(a)).toBe(true);
  });

  it('rejects tampered ciphertext instead of returning garbage', () => {
    const stored = encryptPii('ananya@example.com');
    const raw = Buffer.from(stored.slice(3), 'base64');
    raw[raw.length - 1] ^= 0xff;
    expect(() => decryptPii(`v1:${raw.toString('base64')}`)).toThrow();
  });

  it('passes legacy plaintext and null through unchanged', () => {
    expect(decryptPii('legacy@example.com')).toBe('legacy@example.com');
    expect(decryptPii(null)).toBeNull();
  });

  it('builds a stable blind index that ignores case and whitespace', () => {
    expect(emailHash(' Ananya@Example.com ')).toBe(emailHash('ananya@example.com'));
    expect(emailHash('ananya@example.com')).not.toBe(emailHash('rohit@example.com'));
    expect(emailHash('ananya@example.com')).toMatch(/^[0-9a-f]{64}$/);
  });
});
