import crypto from 'crypto';
import { query, queryOne, withTransaction } from '../../db/pool';
import { queueEmail } from '../../jobs/queues';
import { hashPassword, verifyPassword } from '../../utils/password';
import { revokeAllRefreshTokens } from '../../utils/jwt';
import { badRequest, conflict, notFound, unauthorized } from '../../utils/errors';
import { decryptPii, emailHash, encryptPii, normaliseEmail } from '../../utils/pii';
import { logger } from '../../utils/logger';
import { AuthResponse, issueTokens, PublicUser, toPublicUser, UserRow } from '../auth/auth.service';

/**
 * Self-service account management: profile, password, email address and
 * email verification.
 *
 * Verification links carry a random 256-bit token; only its SHA-256 hash is
 * stored, the link works once, and it expires after 24 hours. Changing the
 * address sends the link to the *new* address and only swaps it on click, so
 * a typo or a hijacked session cannot silently take over the account.
 */

const TOKEN_TTL_HOURS = 24;

const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

async function issueVerification(
  userId: string,
  recipient: string,
  purpose: 'verify' | 'change',
): Promise<void> {
  const token = crypto.randomBytes(32).toString('base64url');
  // Only the newest link per purpose stays valid.
  await query(
    'UPDATE email_verifications SET used_at = now() WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL',
    [userId, purpose],
  );
  await query(
    `INSERT INTO email_verifications (user_id, token_hash, purpose, new_email, new_email_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(hours => $6))`,
    [
      userId,
      hashToken(token),
      purpose,
      purpose === 'change' ? encryptPii(normaliseEmail(recipient)) : null,
      purpose === 'change' ? emailHash(recipient) : null,
      TOKEN_TTL_HOURS,
    ],
  );
  await queueEmail({
    kind: 'account',
    subject: purpose === 'verify' ? 'Verify your Vertexon LMS-AI email' : 'Confirm your new email address',
    body:
      purpose === 'verify'
        ? 'Confirm this is your email address to finish setting up your Vertexon LMS-AI account.\n\n' +
          `The link expires in ${TOKEN_TTL_HOURS} hours. If you did not create an account, ignore this email.`
        : 'Confirm this address to make it the email on your Vertexon LMS-AI account.\n\n' +
          `The link expires in ${TOKEN_TTL_HOURS} hours. If you did not ask for this, ignore this email — ` +
          'your account keeps its current address.',
    recipients: [recipient],
    cta: { label: 'Verify email', path: `/verify-email?token=${token}` },
  });
}

/** Called right after registration. */
export async function sendSignupVerification(userId: string, email: string): Promise<void> {
  await issueVerification(userId, email, 'verify');
}

export async function resendVerification(userId: string): Promise<{ sent: boolean }> {
  const user = await queryOne<{ email: string; email_verified_at: Date | null }>(
    'SELECT email, email_verified_at FROM users WHERE id = $1',
    [userId],
  );
  if (!user) throw notFound('User not found');
  if (user.email_verified_at) return { sent: false };
  await issueVerification(userId, decryptPii(user.email), 'verify');
  return { sent: true };
}

export async function verifyEmail(token: string): Promise<{ verified: true; email: string }> {
  return withTransaction(async (client) => {
    const row = (
      await client.query<{
        id: string;
        user_id: string;
        purpose: 'verify' | 'change';
        new_email: string | null;
        new_email_hash: string | null;
      }>(
        `SELECT id, user_id, purpose, new_email, new_email_hash FROM email_verifications
         WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
         FOR UPDATE`,
        [hashToken(token)],
      )
    ).rows[0];
    if (!row) throw badRequest('This verification link is invalid or has expired', 'token');

    await client.query('UPDATE email_verifications SET used_at = now() WHERE id = $1', [row.id]);

    if (row.purpose === 'change') {
      const taken = await client.query('SELECT 1 FROM users WHERE email_hash = $1 AND id <> $2', [
        row.new_email_hash,
        row.user_id,
      ]);
      if (taken.rowCount) throw conflict('That email address is already in use', 'email');
      await client.query(
        `UPDATE users SET email = $2, email_hash = $3, email_verified_at = now(), updated_at = now()
         WHERE id = $1`,
        [row.user_id, row.new_email, row.new_email_hash],
      );
      return { verified: true as const, email: decryptPii(row.new_email!) };
    }

    const user = await client.query<{ email: string }>(
      'UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1 RETURNING email',
      [row.user_id],
    );
    return { verified: true as const, email: decryptPii(user.rows[0].email) };
  });
}

export interface ProfileUpdate {
  full_name?: string;
  phone?: string | null;
  avatar_url?: string | null;
}

export async function updateProfile(userId: string, input: ProfileUpdate): Promise<PublicUser> {
  const user = await queryOne<UserRow>(
    `UPDATE users SET
       full_name = COALESCE($2, full_name),
       phone = CASE WHEN $3::boolean THEN $4 ELSE phone END,
       avatar_url = CASE WHEN $5::boolean THEN $6 ELSE avatar_url END,
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [
      userId,
      input.full_name ?? null,
      input.phone !== undefined,
      input.phone ? encryptPii(input.phone) : null,
      input.avatar_url !== undefined,
      input.avatar_url || null,
    ],
  );
  if (!user) throw notFound('User not found');
  return toPublicUser(user);
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<AuthResponse> {
  const user = await queryOne<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [
    userId,
  ]);
  if (!user) throw notFound('User not found');
  if (!(await verifyPassword(currentPassword, user.password_hash))) {
    throw unauthorized('Current password is incorrect');
  }
  await query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [
    userId,
    await hashPassword(newPassword),
  ]);
  // Every session is revoked, then this one gets fresh tokens: other devices
  // must sign in with the new password, the device that changed it stays in.
  await revokeAllRefreshTokens(userId);
  logger.info('password_changed', { user_id: userId });
  const fresh = await queryOne<UserRow>('SELECT * FROM users WHERE id = $1', [userId]);
  return issueTokens(fresh!);
}

export async function requestEmailChange(
  userId: string,
  newEmail: string,
  password: string,
): Promise<{ sent: true; to: string }> {
  const user = await queryOne<{ password_hash: string; email_hash: string }>(
    'SELECT password_hash, email_hash FROM users WHERE id = $1',
    [userId],
  );
  if (!user) throw notFound('User not found');
  if (!(await verifyPassword(password, user.password_hash))) throw unauthorized('Password is incorrect');
  if (emailHash(newEmail) === user.email_hash) throw badRequest('That is already your email address', 'email');
  const taken = await queryOne('SELECT 1 FROM users WHERE email_hash = $1', [emailHash(newEmail)]);
  if (taken) throw conflict('That email address is already in use', 'email');
  await issueVerification(userId, normaliseEmail(newEmail), 'change');
  return { sent: true, to: normaliseEmail(newEmail) };
}
