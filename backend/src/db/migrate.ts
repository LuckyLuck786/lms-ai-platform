import fs from 'fs';
import path from 'path';
import { pool } from './pool';
import { emailHash, encryptPii, isEncrypted } from '../utils/pii';

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
     
    console.log('Migrations up to date.');

    // Encrypt any email still stored in plaintext (migration 015). Done here,
    // in the application, because the database never holds the key. Each row
    // is rewritten in a single UPDATE, so a crash mid-way leaves every row
    // either fully plaintext or fully encrypted — and the next boot resumes.
    const pending = await client.query<{ id: string; email: string }>(
      "SELECT id, email FROM users WHERE email IS NOT NULL AND email NOT LIKE 'v1:%'",
    );
    for (const row of pending.rows) {
      if (isEncrypted(row.email)) continue;
      await client.query('UPDATE users SET email = $2, email_hash = $3 WHERE id = $1', [
        row.id,
        encryptPii(row.email),
        emailHash(row.email),
      ]);
    }
    if (pending.rowCount) {
       
      console.log(`Encrypted ${pending.rowCount} plaintext email(s).`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err) => {
   
  console.error('Migration failed:', err);
  process.exit(1);
});
