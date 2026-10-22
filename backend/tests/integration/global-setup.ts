import { execSync } from 'child_process';

/**
 * Migrate and seed a fresh database before the integration suite.
 *
 * Migrations and the seeder each close the shared pool when they finish, so
 * they run as child processes rather than in the test process. The guard
 * below refuses anything that is not plainly a local throwaway database: this
 * suite registers users and enrols them.
 */
export default function setup(): void {
  const url = process.env.DATABASE_URL ?? '';
  const parsed = new URL(url.replace(/^postgresql:/, 'http:'));
  const local = ['localhost', '127.0.0.1', 'postgres'].includes(parsed.hostname);
  const throwaway = /_(it|test)$/.test(parsed.pathname.slice(1));
  if (!local || !throwaway) {
    throw new Error(
      `Refusing to run integration tests against ${parsed.hostname}${parsed.pathname}: ` +
        'use a local database whose name ends in _it or _test.',
    );
  }
  const opts = { stdio: 'inherit' as const, env: process.env };
  execSync('npx tsx src/db/migrate.ts', opts);
  execSync('npx tsx src/db/seeders/seed-demo.ts', opts);
}
