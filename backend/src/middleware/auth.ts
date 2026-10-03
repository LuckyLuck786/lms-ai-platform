import { NextFunction, Request, Response } from 'express';
import { verifyAccessToken, Role } from '../utils/jwt';
import { unauthorized, forbidden } from '../utils/errors';

export interface AuthUser {
  id: string;
  email: string;
  roles: Role[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      requestId?: string;
    }
  }
}

/** Requires `Authorization: Bearer <JWT>`; attaches req.user on success. */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return next(unauthorized('Missing Authorization: Bearer <JWT> header'));
  }
  try {
    const payload = verifyAccessToken(header.slice(7));
    req.user = { id: payload.sub, email: payload.email, roles: payload.roles };
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Attaches req.user when a valid token is present, but allows anonymous
 * requests (used by the public catalog so staff see extra visibility).
 */
export function optionalAuthenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next();
  try {
    const payload = verifyAccessToken(header.slice(7));
    req.user = { id: payload.sub, email: payload.email, roles: payload.roles };
  } catch {
    /* anonymous */
  }
  next();
}

/**
 * requireRole('admin') / requireRole('instructor', 'admin')
 * Must run after authenticate.
 */
export function requireRole(...allowed: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(unauthorized());
    if (!req.user.roles.some((r) => allowed.includes(r))) {
      return next(forbidden(`Requires one of roles: ${allowed.join(', ')}`));
    }
    next();
  };
}

export function hasRole(user: AuthUser | undefined, ...roles: Role[]): boolean {
  return !!user && user.roles.some((r) => roles.includes(r));
}
