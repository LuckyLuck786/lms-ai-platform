import { request } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * Log in once per demo role before any test and save the sessions, so specs
 * reuse them instead of spending the 10/min/IP /auth budget — Playwright
 * restarts a worker after each failure, which would otherwise re-login.
 */
export const SESSIONS_FILE = path.join(__dirname, '.auth', 'sessions.json');

export default async function globalSetup(): Promise<void> {
  const API = process.env.API_URL ?? 'http://localhost:4000/api/v1';
  const ctx = await request.newContext();
  const sessions: Record<string, unknown> = {};
  for (const role of ['student', 'instructor', 'admin']) {
    const res = await ctx.post(`${API}/auth/login`, {
      data: { email: `${role}@vertexon.demo`, password: 'DemoPass123!' },
    });
    if (!res.ok()) throw new Error(`login as ${role} failed: ${res.status()} ${await res.text()}`);
    sessions[role] = await res.json();
  }
  const catalog = await (await ctx.get(`${API}/courses?limit=1`)).json();
  const token = (sessions.student as { access_token: string }).access_token;
  const detail = await (
    await ctx.get(`${API}/courses/${catalog.items[0].id}`, { headers: { authorization: `Bearer ${token}` } })
  ).json();
  const mod = detail.modules[0];
  const ids = { course: detail.id, lecture: mod.lectures[0].id, quiz: mod.quizzes[0]?.id ?? null };
  fs.mkdirSync(path.dirname(SESSIONS_FILE), { recursive: true });
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify({ sessions, ids }));
  await ctx.dispose();
}
