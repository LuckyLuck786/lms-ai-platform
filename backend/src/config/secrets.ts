/**
 * Production secret resolution.
 *
 * `NODE_ENV=production` used to fall back to the same placeholders that ship in
 * `.env.example`. That is the exact failure mode this module exists to prevent:
 * an operator forgets one variable, the app boots happily, and every access
 * token in that deployment becomes forgeable by anyone who has read the
 * repository — the placeholder is public, so the signing key is effectively
 * public too.
 *
 * Two distinct cases are rejected in production:
 *   1. the variable is missing entirely, and
 *   2. the variable is set to a known dev placeholder (someone copy-pasted
 *      `.env.example` into production).
 *
 * Both are ordinary local-development defaults outside production, so `npm run
 * dev` keeps working with no configuration at all.
 *
 * Deliberately pure — it takes the raw value rather than reading
 * `process.env` — so the production rules are unit-testable without
 * reloading a module that reads the environment at import time.
 */

/** Values that ship in `.env.example`; never acceptable in production. */
export const DEV_SECRET_PLACEHOLDERS: readonly string[] = [
  'dev-only-change-me-jwt-secret-32-chars-min',
  'dev-only-change-me-refresh-secret-32-chars',
  'postgresql://lms:lms_dev_password@localhost:5432/lms',
];

const PLACEHOLDER_SET = new Set(DEV_SECRET_PLACEHOLDERS);

/** True when a value is empty, whitespace, or a known dev placeholder. */
export function isDevPlaceholder(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  return PLACEHOLDER_SET.has(trimmed);
}

/**
 * Resolve a required secret.
 *
 * @throws when `isProd` and the value is missing or a dev placeholder.
 */
export function resolveSecret(
  name: string,
  raw: string | undefined,
  options: { isProd: boolean; devDefault?: string },
): string {
  const value = raw?.trim();

  if (value && !isDevPlaceholder(value)) return value;

  if (options.isProd) {
    if (!value) {
      throw new Error(
        `Missing required secret in production: ${name}. ` +
          'Set it before deploying — see docs/deploy-cloud-run.md.',
      );
    }
    throw new Error(
      `Refusing to start: ${name} is set to the public development placeholder. ` +
        'Generate a real value (e.g. `openssl rand -base64 48`) before deploying to production.',
    );
  }

  // Local development only: an unset secret falls back so `npm run dev` works
  // with no configuration, and a partially-filled placeholder stays usable.
  if (value) return value;
  return options.devDefault ?? '';
}
