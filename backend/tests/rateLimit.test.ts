import { describe, it, expect, vi } from 'vitest';
import type { Request } from 'express';

vi.mock('../src/db/redis', () => ({ redis: { call: vi.fn() } }));
vi.mock('../src/db/pool', () => ({ query: vi.fn(), queryOne: vi.fn(), pool: {} }));

import { userOrIpKey } from '../src/middleware/rateLimit';
import { signAccessToken } from '../src/utils/jwt';

const req = (authorization?: string) =>
  ({ headers: authorization ? { authorization } : {}, ip: '203.0.113.7' }) as unknown as Request;

describe('userOrIpKey (PRD §8.9 per-user limits)', () => {
  it('keys a valid bearer token by user id, not IP', () => {
    const token = signAccessToken({ sub: 'user-42', email: 'a@b.c', roles: ['student'] });
    expect(userOrIpKey(req(`Bearer ${token}`))).toBe('u:user-42');
  });

  it('falls back to the IP when there is no token', () => {
    expect(userOrIpKey(req())).toBe('ip:203.0.113.7');
  });

  it('falls back to the IP for a forged token instead of trusting its subject', () => {
    expect(userOrIpKey(req('Bearer not.a.jwt'))).toBe('ip:203.0.113.7');
  });
});
