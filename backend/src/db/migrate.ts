import fs from 'fs';
import path from 'path';
import { pool } from './pool';

/**
 * Minimal forward-only SQL migration runner.
 * Files in ./migrations are applied in lexicographic order exactly once,
 * tracked in schema_migrations.
 */
async function migrate(): Promise<void> {
  let dir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(dir)) {
    // Running compiled from dist/ — fall back to the source tree.
    dir = path.join(process.cwd(), 'src', 'db', 'migrations');
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT now()
      )
    `);

    for (const file of files) {
      const applied = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
      if (applied.rowCount) continue;

      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      // eslint-disable-next-line no-console
      console.log(`Applying migration ${file}...`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
    // eslint-disable-next-line no-console
    console.log('Migrations up to date.');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Migration failed:', err);
  process.exit(1);
});
