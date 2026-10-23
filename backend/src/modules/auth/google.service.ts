import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { env } from '../../config/env';
import { withTransaction } from '../../db/pool';
import { hashPassword } from '../../utils/password';
import { badRequest, forbidden, serviceUnavailable, unauthorized } from '../../utils/errors';
import { emailHash, encryptPii, normaliseEmail } from '../../utils/pii';
import { logger } from '../../utils/logger';
import { AuthResponse, issueTokens, UserRow } from './auth.service';

/**
 * Sign in with Google (Google Identity Services, ID-token flow).
 *
 * The browser gets a Google-signed ID token; we verify its signature,
 * audience (our client id) and expiry with Google's library, then:
 *   1. an account already linked to this Google subject signs in;
 *   2. otherwise an account with the same, Google-verified email is linked;
 *   3. otherwise a new student account is created, already email-verified.
 * The link is keyed on Google's stable `sub`, never on the email alone, so a
 * later email change on either side cannot hijack the account.
 */

let client: OAuth2Client | null = null;

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
}

/** Overridable in tests; production verifies against Google's public keys. */
export let verifyGoogleToken = async (credential: string): Promise<GoogleIdentity> => {
  client ??= new OAuth2Client(env.google.clientId);
  try {
    const ticket = await client.verifyIdToken({ idToken: credential, audience: env.google.clientId });
    const p = ticket.getPayload();
    if (!p?.sub || !p.email) throw new Error('token has no subject or email');
    return { sub: p.sub, email: p.email, emailVerified: !!p.email_verified, name: p.name, picture: p.picture };
  } catch (err) {
    logger.warn('google_token_rejected', { error: err instanceof Error ? err.message : String(err) });
    throw unauthorized('Google sign-in could not be verified — please try again');
  }
};

export function setGoogleVerifierForTests(fn: typeof verifyGoogleToken): void {
  verifyGoogleToken = fn;
}

export function googleEnabled(): boolean {
  return Boolean(env.google.clientId);
}

export async function signInWithGoogle(credential: string): Promise<AuthResponse> {
  if (!googleEnabled()) throw serviceUnavailable('Sign in with Google is not configured on this deployment');
  const id = await verifyGoogleToken(credential);
  if (!id.emailVerified) throw badRequest('Your Google account email is not verified', 'credential');

  const user = await withTransaction(async (c) => {
    const bySub = await c.query<UserRow & { deleted_at: Date | null }>('SELECT * FROM users WHERE google_sub = $1', [id.sub]);
    if (bySub.rows[0]) return bySub.rows[0];

    const byEmail = await c.query<UserRow & { google_sub: string | null }>(
      'SELECT * FROM users WHERE email_hash = $1 FOR UPDATE',
      [emailHash(id.email)],
    );
    const existing = byEmail.rows[0];
    if (existing) {
      if (existing.google_sub && existing.google_sub !== id.sub) {
        throw forbidden('This email is linked to a different Google account');
      }
      const linked = await c.query<UserRow>(
        `UPDATE users SET google_sub = $2, email_verified_at = COALESCE(email_verified_at, now()),
                avatar_url = COALESCE(avatar_url, $3), updated_at = now()
         WHERE id = $1 RETURNING *`,
        [existing.id, id.sub, id.picture ?? null],
      );
      return linked.rows[0];
    }

    // New account. It has no usable password (random, unknown to anyone);
    // the learner can set one later through "Forgot password".
    const created = await c.query<UserRow>(
      `INSERT INTO users (full_name, email, email_hash, password_hash, avatar_url, google_sub, email_verified_at)
       VALUES ($1, $2, $3, $4, $5, $6, now()) RETURNING *`,
      [
        (id.name ?? normaliseEmail(id.email).split('@')[0]).slice(0, 150),
        encryptPii(normaliseEmail(id.email)),
        emailHash(id.email),
        await hashPassword(crypto.randomBytes(32).toString('hex')),
        id.picture ?? null,
        id.sub,
      ],
    );
    await c.query("INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name = 'student'", [
      created.rows[0].id,
    ]);
    logger.info('google_account_created', { user_id: created.rows[0].id });
    return created.rows[0];
  });

  if (!user.is_active || (user as { deleted_at?: Date | null }).deleted_at) {
    throw forbidden('This account has been suspended');
  }
  return issueTokens(user);
}
