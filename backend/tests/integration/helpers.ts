import request from 'supertest';
import { expect } from 'vitest';
import { Queue } from 'bullmq';
import { createApp } from '../../src/app';
import { queueConnection } from '../../src/jobs/queues';

/** Shared by the integration suites: the app, a per-request client IP, logins. */
export function makeHelpers() {
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
      (method: 'get' | 'post' | 'put' | 'patch' | 'delete') =>
      (url: string) =>
        agent[method](url).set('x-forwarded-for', ip);
    return { get: wrap('get'), post: wrap('post'), put: wrap('put'), patch: wrap('patch'), delete: wrap('delete') };
  };
  const PASSWORD = 'DemoPass123!';

  async function login(email: string): Promise<string> {
    const res = await api().post('/api/v1/auth/login').send({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    return res.body.access_token as string;
  }

  /** Pull the newest verification link for `to` out of the real email queue. */
  async function latestVerificationToken(to: string, path = '/verify-email'): Promise<string> {
    const q = new Queue('notifications', { connection: queueConnection() });
    try {
      for (let i = 0; i < 20; i++) {
        const jobs = await q.getJobs(['waiting', 'delayed', 'completed', 'failed', 'active']);
        const hit = jobs
          .filter(
            (j) =>
              j.data?.kind === 'account' &&
              j.data.recipients?.includes(to) &&
              String(j.data.cta?.path ?? '').startsWith(path),
          )
          .sort((a, b) => b.timestamp - a.timestamp)[0];
        const token = hit?.data.cta?.path?.split('token=')[1];
        if (token) return token;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error(`no verification email queued for ${to}`);
    } finally {
      await q.close();
    }
  }

  return { app, api, login, PASSWORD, latestVerificationToken };
}
