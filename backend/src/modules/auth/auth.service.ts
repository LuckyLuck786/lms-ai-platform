import { query, queryOne, withTransaction } from '../../db/pool';
import { hashPassword, verifyPassword } from '../../utils/password';
import {
  Role,
  issueRefreshToken,
  revokeAllRefreshTokens,
  revokeRefreshToken,
  rotateRefreshToken,
  signAccessToken,
} from '../../utils/jwt';
import { badRequest, conflict, unauthorized, forbidden, notFound } from '../../utils/errors';
import { LoginInput, RegisterInput } from './auth.schemas';

export interface UserRow {
  id: string;
  full_name: string;
  email: string;
  password_hash: string;
  avatar_url: string | null;
  is_active: boolean;
}

export interface PublicUser {
  id: string;
  full_name: string;
  email: string;
  avatar_url: string | null;
  role: Role;
  roles: Role[];
}

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  user: PublicUser;
}

async function getRoles(userId: string): Promise<Role[]> {
  const rows = await query<{ name: Role }>(
    `SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1 ORDER BY r.id`,
    [userId],
  );
  return rows.map((r) => r.name);
}

export async function toPublicUser(user: UserRow): Promise<PublicUser> {
  const roles = await getRoles(user.id);
  return {
    id: user.id,
    full_name: user.full_name,
    email: user.email,
    avatar_url: user.avatar_url,
    role: roles[0] ?? 'student',
    roles: roles.length ? roles : ['student'],
  };
}

async function issueTokens(user: UserRow): Promise<AuthResponse> {
  const publicUser = await toPublicUser(user);
  const access_token = signAccessToken({
    sub: user.id,
    email: user.email,
    roles: publicUser.roles,
  });
  const refresh_token = await issueRefreshToken(user.id);
  return { access_token, refresh_token, user: publicUser };
}

export async function register(input: RegisterInput): Promise<AuthResponse> {
  const existing = await queryOne('SELECT id FROM users WHERE email = $1', [input.email.toLowerCase()]);
  if (existing) throw conflict('An account with this email already exists', 'email');

  const password_hash = await hashPassword(input.password);
  const roleName = input.role ?? 'student';

  const full = await withTransaction(async (client) => {
    const role = await client.query<{ id: number }>('SELECT id FROM roles WHERE name = $1', [roleName]);
    if (!role.rowCount) throw badRequest(`Unknown role: ${roleName}`, 'role');

    const user = await client.query<UserRow>(
      'INSERT INTO users (full_name, email, password_hash) VALUES ($1, $2, $3) RETURNING *',
      [input.full_name, input.email.toLowerCase(), password_hash],
    );
    await client.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [
      user.rows[0].id,
      role.rows[0].id,
    ]);
    return user.rows[0];
  });

  return issueTokens(full);
}

export async function login(input: LoginInput): Promise<AuthResponse> {
  const user = await queryOne<UserRow>('SELECT * FROM users WHERE email = $1', [
    input.email.toLowerCase(),
  ]);
  if (!user) throw unauthorized('Invalid email or password');

  const ok = await verifyPassword(input.password, user.password_hash);
  if (!ok) throw unauthorized('Invalid email or password');
  if (!user.is_active) throw forbidden('This account has been suspended');

  return issueTokens(user);
}

export async function refresh(refreshToken: string): Promise<AuthResponse> {
  const { userId, newToken } = await rotateRefreshToken(refreshToken);
  const user = await queryOne<UserRow>('SELECT * FROM users WHERE id = $1', [userId]);
  if (!user) throw unauthorized('Invalid refresh token');
  if (!user.is_active) throw forbidden('This account has been suspended');

  const publicUser = await toPublicUser(user);
  const access_token = signAccessToken({
    sub: user.id,
    email: user.email,
    roles: publicUser.roles,
  });
  return { access_token, refresh_token: newToken, user: publicUser };
}

export async function logout(refreshToken: string): Promise<{ ok: true }> {
  await revokeRefreshToken(refreshToken);
  return { ok: true };
}

export async function getMe(userId: string): Promise<PublicUser> {
  const user = await queryOne<UserRow>('SELECT * FROM users WHERE id = $1', [userId]);
  if (!user) throw notFound('User not found');
  return toPublicUser(user);
}

export async function suspendUser(userId: string, active: boolean): Promise<{ ok: true }> {
  const updated = await queryOne(
    'UPDATE users SET is_active = $2, updated_at = now() WHERE id = $1 RETURNING id',
    [userId, active],
  );
  if (!updated) throw notFound('User not found');
  if (!active) await revokeAllRefreshTokens(userId);
  return { ok: true };
}
