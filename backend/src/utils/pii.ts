import crypto from 'crypto';
import { env } from '../config/env';

/**
 * Column-level encryption for personal data (NFR §6: "Student PII encrypted
 * at rest").
 *
 * Stored form: `v1:<base64(iv | auth tag | ciphertext)>`, AES-256-GCM with a
 * fresh 96-bit IV per value — the same email encrypts differently every time,
 * so the column alone reveals nothing, not even which users share a domain.
 * That also makes it unusable for lookups, hence the blind index: an HMAC of
 * the normalised email, stored beside it and uniquely indexed.
 *
 * Keys are derived with SHA-256 so any sufficiently random secret string works
 * as configuration; they are never used raw.
 */

const PREFIX = 'v1:';
const IV_BYTES = 12;
const TAG_BYTES = 16;

const encKey = () => crypto.createHash('sha256').update(env.pii.encryptionKey).digest();
const hashKey = () => crypto.createHash('sha256').update(env.pii.hashKey).digest();

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function encryptPii(plain: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

/**
 * Decrypt a stored value. Values without the prefix are returned unchanged:
 * rows written before encryption was introduced stay readable until the
 * boot-time backfill rewrites them.
 */
export function decryptPii(stored: string): string;
export function decryptPii(stored: string | null | undefined): string | null;
export function decryptPii(stored: string | null | undefined): string | null {
  if (stored == null) return null;
  if (!stored.startsWith(PREFIX)) return stored;
  const raw = Buffer.from(stored.slice(PREFIX.length), 'base64');
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const body = raw.subarray(IV_BYTES + TAG_BYTES);
  const decipher = crypto.createDecipheriv('aes-256-gcm', encKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}

export function isEncrypted(stored: string | null | undefined): boolean {
  return !!stored && stored.startsWith(PREFIX);
}

/** Blind index for exact-match lookup and uniqueness. */
export function emailHash(email: string): string {
  return crypto.createHmac('sha256', hashKey()).update(normaliseEmail(email)).digest('hex');
}
