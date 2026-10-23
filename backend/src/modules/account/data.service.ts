import crypto from 'crypto';
import { query, queryOne, withTransaction } from '../../db/pool';
import { hashPassword, verifyPassword } from '../../utils/password';
import { revokeAllRefreshTokens } from '../../utils/jwt';
import { badRequest, conflict, notFound, unauthorized } from '../../utils/errors';
import { emailHash, encryptPii } from '../../utils/pii';
import { persistFile } from '../../utils/storage';
import { logger } from '../../utils/logger';
import { PublicUser, toPublicUser, UserRow } from '../auth/auth.service';

/**
 * Data rights: download everything we hold about you, and delete your account.
 *
 * Deletion pseudonymises rather than removing the user row. Personal content
 * (notes, bookmarks, AI chats, notifications, flashcard history, attendance)
 * is deleted outright; records others depend on — grades, quiz attempts,
 * payments, certificates, forum posts — stay, attached to an anonymous
 * "Deleted user" whose email, phone, photo and password are destroyed. That
 * keeps course analytics and payment history consistent while nothing left
 * identifies the person.
 */

/** Tables exported as-is, keyed by the column that names the owner. */
const OWNED_TABLES: [table: string, column: string][] = [
  ['enrollments', 'user_id'],
  ['notes', 'user_id'],
  ['bookmarks', 'user_id'],
  ['assignment_submissions', 'user_id'],
  ['quiz_attempts', 'user_id'],
  ['certificates', 'user_id'],
  ['user_badges', 'user_id'],
  ['streaks', 'user_id'],
  ['course_ratings', 'user_id'],
  ['topic_mastery', 'user_id'],
  ['study_plans', 'user_id'],
  ['recommendations', 'user_id'],
  ['discussion_threads', 'created_by'],
  ['discussion_posts', 'user_id'],
  ['notifications', 'user_id'],
  ['payments', 'user_id'],
  ['flashcard_reviews', 'user_id'],
  ['live_attendance', 'user_id'],
];

export async function exportMyData(userId: string): Promise<Record<string, unknown>> {
  const user = await queryOne<UserRow & { created_at: Date; google_sub: string | null }>(
    'SELECT * FROM users WHERE id = $1',
    [userId],
  );
  if (!user) throw notFound('User not found');
  const profile = await toPublicUser(user);

  const data: Record<string, unknown> = {
    exported_at: new Date().toISOString(),
    profile: { ...profile, created_at: user.created_at, google_linked: !!user.google_sub },
  };
  for (const [table, column] of OWNED_TABLES) {
    data[table] = await query(`SELECT * FROM ${table} WHERE ${column} = $1`, [userId]);
  }
  data.quiz_answers = await query(
    `SELECT qa.* FROM quiz_answers qa JOIN quiz_attempts a ON a.id = qa.attempt_id WHERE a.user_id = $1`,
    [userId],
  );
  data.ai_chat_sessions = await query('SELECT * FROM ai_chat_sessions WHERE user_id = $1', [userId]);
  data.ai_chat_messages = await query(
    `SELECT m.* FROM ai_chat_messages m JOIN ai_chat_sessions s ON s.id = m.session_id
     WHERE s.user_id = $1 ORDER BY m.created_at`,
    [userId],
  );
  logger.info('data_exported', { user_id: userId });
  return data;
}

export async function deleteMyAccount(
  userId: string,
  input: { confirm: string; password?: string },
): Promise<{ deleted: true }> {
  if (input.confirm !== 'DELETE') throw badRequest('Type DELETE to confirm', 'confirm');

  const user = await queryOne<{ password_hash: string; google_sub: string | null }>(
    'SELECT password_hash, google_sub FROM users WHERE id = $1 AND deleted_at IS NULL',
    [userId],
  );
  if (!user) throw notFound('User not found');
  // Google-only accounts never chose a password; their signed-in session is the proof.
  if (!user.google_sub || input.password) {
    if (!input.password || !(await verifyPassword(input.password, user.password_hash))) {
      throw unauthorized('Password is incorrect');
    }
  }

  const admins = await queryOne<{ n: number; me: boolean }>(
    `SELECT count(*)::int AS n, bool_or(ur.user_id = $1) AS me
     FROM user_roles ur JOIN roles r ON r.id = ur.role_id JOIN users u ON u.id = ur.user_id
     WHERE r.name = 'admin' AND u.is_active AND u.deleted_at IS NULL`,
    [userId],
  );
  if (admins?.me && admins.n <= 1) {
    throw conflict('You are the only admin — make someone else an admin before deleting your account');
  }

  const placeholder = `deleted+${userId}@deleted.invalid`;
  await withTransaction(async (c) => {
    for (const table of ['notes', 'bookmarks', 'ai_chat_sessions', 'notifications', 'flashcard_reviews',
      'live_attendance', 'study_plans', 'recommendations', 'email_verifications']) {
      await c.query(`DELETE FROM ${table} WHERE user_id = $1`, [userId]);
    }
    await c.query(
      `UPDATE users SET full_name = 'Deleted user', email = $2, email_hash = $3, phone = NULL,
              avatar_url = NULL, google_sub = NULL, password_hash = $4, is_active = FALSE,
              email_verified_at = NULL, deleted_at = now(), updated_at = now()
       WHERE id = $1`,
      [userId, encryptPii(placeholder), emailHash(placeholder), await hashPassword(crypto.randomBytes(32).toString('hex'))],
    );
  });
  await revokeAllRefreshTokens(userId);
  logger.info('account_deleted', { user_id: userId });
  return { deleted: true };
}

// --- Profile photo ----------------------------------------------------------

export const AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

export async function setAvatar(
  userId: string,
  file: { path: string; originalname: string; mimetype: string },
): Promise<PublicUser> {
  const stored = await persistFile(file.path, file.originalname, 'avatars', file.mimetype);
  const user = await queryOne<UserRow>(
    'UPDATE users SET avatar_url = $2, updated_at = now() WHERE id = $1 RETURNING *',
    [userId, stored.url],
  );
  if (!user) throw notFound('User not found');
  return toPublicUser(user);
}

export async function removeAvatar(userId: string): Promise<PublicUser> {
  const user = await queryOne<UserRow>(
    'UPDATE users SET avatar_url = NULL, updated_at = now() WHERE id = $1 RETURNING *',
    [userId],
  );
  if (!user) throw notFound('User not found');
  return toPublicUser(user);
}
