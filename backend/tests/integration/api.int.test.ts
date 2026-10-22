import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { pool, query } from '../../src/db/pool';
import { redis } from '../../src/db/redis';
import { closeQueues } from '../../src/jobs/queues';

/**
 * Integration suite: the real app against a real, freshly migrated and seeded
 * Postgres + Redis. The unit suite mocks both, so these are the only tests
 * that catch SQL errors, migration drift and Redis-backed behaviour.
 */

const app = createApp();

// The app trusts one proxy hop, so X-Forwarded-For is the client IP. Giving
// each request its own address keeps the real /auth/* limit (10/min/IP) out
// of tests that are not about it; the rate-limit test pins a single IP.
let ipSeq = 0;
const nextIp = () => `198.51.100.${(ipSeq++ % 250) + 1}`;
const api = () => {
  const agent = request(app);
  const ip = nextIp();
  const wrap =
    (method: 'get' | 'post' | 'put' | 'delete') =>
    (url: string) =>
      agent[method](url).set('x-forwarded-for', ip);
  return { get: wrap('get'), post: wrap('post'), put: wrap('put'), delete: wrap('delete') };
};
const PASSWORD = 'DemoPass123!';

async function login(email: string): Promise<string> {
  const res = await api().post('/api/v1/auth/login').send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return res.body.access_token as string;
}

afterAll(async () => {
  await closeQueues().catch(() => undefined);
  await redis.quit().catch(() => undefined);
  await pool.end().catch(() => undefined);
});

describe('schema', () => {
  it('applies every migration on a fresh database', async () => {
    const rows = await query<{ n: number }>('SELECT count(*)::int AS n FROM schema_migrations');
    expect(rows[0].n).toBeGreaterThanOrEqual(14);
  });

  it('has pgvector and the ivfflat index the retriever depends on', async () => {
    const ext = await query("SELECT 1 FROM pg_extension WHERE extname = 'vector'");
    expect(ext).toHaveLength(1);
    const idx = await query(
      "SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_document_chunks_embedding'",
    );
    expect(String((idx[0] as { indexdef: string }).indexdef)).toMatch(/ivfflat/);
  });
});

describe('indexing (PRD §7.3)', () => {
  it('has a B-tree index leading with every foreign-key column', async () => {
    const unindexed = await query<{ fk: string }>(
      `SELECT c.conrelid::regclass || '.' || a.attname AS fk
       FROM pg_constraint c
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
       WHERE c.contype = 'f'
         AND NOT EXISTS (SELECT 1 FROM pg_index i
                         WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1])`,
    );
    expect(unindexed.map((r) => r.fk)).toEqual([]);
  });
});

describe('PII encryption at rest (NFR §6)', () => {
  it('stores every email as ciphertext with a blind index', async () => {
    const rows = await query<{ email: string; email_hash: string | null }>(
      'SELECT email, email_hash FROM users',
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.email.startsWith('v1:')).toBe(true);
      expect(r.email).not.toContain('@');
      expect(r.email_hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('still logs in by email and returns the decrypted address', async () => {
    const res = await api()
      .post('/api/v1/auth/login')
      .send({ email: 'STUDENT@vertexon.demo', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('student@vertexon.demo');
  });

  it('rejects a duplicate registration through the blind index', async () => {
    const res = await api()
      .post('/api/v1/auth/register')
      .send({ full_name: 'Dup', email: 'Student@Vertexon.demo', password: 'SecurePass123!' });
    expect(res.status).toBe(409);
  });

  it('lets an admin find a user by exact email', async () => {
    const token = await login('admin@vertexon.demo');
    const res = await api()
      .get('/api/v1/admin/users?q=student@vertexon.demo')
      .set('authorization', `Bearer ${token}`);
    expect(res.body.items.map((u: { email: string }) => u.email)).toEqual(['student@vertexon.demo']);
  });
});

describe('auth lifecycle', () => {
  const email = `it-${Date.now()}@example.com`;
  let refresh = '';

  it('registers a student and returns tokens', async () => {
    const res = await api()
      .post('/api/v1/auth/register')
      .send({ full_name: 'Integration Learner', email, password: 'SecurePass123!' });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('student');
    refresh = res.body.refresh_token;
  });

  it('rotates the refresh token, and logout revokes it', async () => {
    const rotated = await api().post('/api/v1/auth/refresh').send({ refresh_token: refresh });
    expect(rotated.status).toBe(200);
    const next = rotated.body.refresh_token as string;

    // The rotated-away token must be dead.
    const reused = await api().post('/api/v1/auth/refresh').send({ refresh_token: refresh });
    expect(reused.status).toBe(401);

    expect((await api().post('/api/v1/auth/logout').send({ refresh_token: next })).status).toBe(200);
    expect((await api().post('/api/v1/auth/refresh').send({ refresh_token: next })).status).toBe(401);
  });
});

describe('learning flow', () => {
  it('serves the public catalog with a total', async () => {
    const res = await api().get('/api/v1/courses?page=1&limit=5');
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
  });

  it('enrols a new learner in a free approved course', async () => {
    const email = `enrol-${Date.now()}@example.com`;
    const reg = await api()
      .post('/api/v1/auth/register')
      .send({ full_name: 'Enrol Learner', email, password: 'SecurePass123!' });
    const token = reg.body.access_token as string;

    const catalog = await api().get('/api/v1/courses?limit=50');
    const free = (catalog.body.items as { id: string; price: string }[]).find(
      (c) => Number(c.price) === 0,
    );
    expect(free).toBeDefined();

    const enrol = await api()
      .post(`/api/v1/courses/${free!.id}/enroll`)
      .set('authorization', `Bearer ${token}`);
    expect(enrol.status).toBe(201);

    const mine = await api().get('/api/v1/enrollments/me').set('authorization', `Bearer ${token}`);
    expect(mine.body.items.map((e: { course_id?: string; id: string }) => e.course_id ?? e.id)).toContain(
      free!.id,
    );
  });
});

describe('PRD §8.6 paths', () => {
  it('serves GET /recommendations/me behind auth', async () => {
    expect((await api().get('/api/v1/recommendations/me')).status).toBe(401);
    const token = await login('student@vertexon.demo');
    const res = await api().get('/api/v1/recommendations/me').set('authorization', `Bearer ${token}`);
    // No AI service in this suite: 502 proves the route is mounted and proxies.
    expect(res.status).toBe(502);
  });
});

describe('pagination against real rows', () => {
  it('pages admin users and reports the full total', async () => {
    const token = await login('admin@vertexon.demo');
    const res = await api().get('/api/v1/admin/users?limit=2').set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.total).toBeGreaterThan(2);
  });

  it('counts unread notifications across every page', async () => {
    const token = await login('student@vertexon.demo');
    const res = await api()
      .get('/api/v1/users/me/notifications?limit=1')
      .set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.unread).toBe('number');
    expect(res.body.unread).toBeLessThanOrEqual(res.body.total);
  });
});

describe('Redis-backed rate limiting (PRD §8.9)', () => {
  it('limits /auth/* to 10 per minute and keeps the counter in Redis', async () => {
    await redis.del(...((await redis.keys('rl:auth:*')) as string[]), 'rl:auth:none');
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .set('x-forwarded-for', '203.0.113.99')
        .send({ email: 'nobody@example.com', password: 'x' });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s !== 429)).toBe(true);
    expect(statuses[10]).toBe(429);
    expect((await redis.keys('rl:auth:*')).length).toBeGreaterThan(0);
  });
});
