import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { redis } from '../db/redis';
import { unauthorized } from './errors';

export type Role = 'student' | 'instructor' | 'admin';

export interface AccessTokenPayload {
  sub: string; // user id
  email: string;
  roles: Role[];
}

export interface RefreshTokenPayload {
  sub: string;
  jti: string; // unique token id — tracked in Redis so logout/rotation can revoke it
}

const refreshKey = (userId: string, jti: string) => `auth:refresh:${userId}:${jti}`;

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.jwt.secret, {
    expiresIn: env.jwt.accessTtl,
    issuer: 'lms-ai',
  } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    return jwt.verify(token, env.jwt.secret, { issuer: 'lms-ai' }) as AccessTokenPayload;
  } catch {
    throw unauthorized('Invalid or expired access token');
  }
}

/** Issues a refresh token and registers it in Redis (TTL = refresh window). */
export async function issueRefreshToken(userId: string): Promise<string> {
  const jti = crypto.randomUUID();
  const token = jwt.sign({ sub: userId, jti }, env.jwt.refreshSecret, {
    expiresIn: `${env.jwt.refreshTtlDays}d`,
    issuer: 'lms-ai',
  });
  await redis.set(refreshKey(userId, jti), '1', 'EX', env.jwt.refreshTtlDays * 24 * 3600);
  return token;
}

/**
 * Verifies + rotates a refresh token: the presented token is revoked and a
 * fresh pair is issued (refresh token rotation).
 */
export async function rotateRefreshToken(token: string): Promise<{ userId: string; newToken: string }> {
  let payload: RefreshTokenPayload;
  try {
    payload = jwt.verify(token, env.jwt.refreshSecret, { issuer: 'lms-ai' }) as RefreshTokenPayload;
  } catch {
    throw unauthorized('Invalid or expired refresh token');
  }

  const key = refreshKey(payload.sub, payload.jti);
  const exists = await redis.get(key);
  if (!exists) throw unauthorized('Refresh token has been revoked');

  await redis.del(key); // one-time use
  const newToken = await issueRefreshToken(payload.sub);
  return { userId: payload.sub, newToken };
}

/** Revokes a single refresh token (logout). */
export async function revokeRefreshToken(token: string): Promise<void> {
  try {
    const payload = jwt.verify(token, env.jwt.refreshSecret, {
      issuer: 'lms-ai',
      ignoreExpiration: true,
    }) as RefreshTokenPayload;
    await redis.del(refreshKey(payload.sub, payload.jti));
  } catch {
    /* already invalid — nothing to revoke */
  }
}

/** Revokes every refresh token for a user (suspend / password change). */
export async function revokeAllRefreshTokens(userId: string): Promise<void> {
  const keys = await redis.keys(`auth:refresh:${userId}:*`);
  if (keys.length) await redis.del(...keys);
}
