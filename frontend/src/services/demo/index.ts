import { demoAdapter, resetDemoState } from './server';
import { DEMO_PASSWORD } from './seed';

export { demoAdapter, resetDemoState, DEMO_PASSWORD };

/** Accounts the demo login screen offers as one-click entry points. */
export const DEMO_ACCOUNTS = [
  { email: 'student@vertexon.demo', label: 'Student', hint: 'dashboard, course player, AI tutor, quiz' },
  { email: 'instructor@vertexon.demo', label: 'Instructor', hint: 'authoring, quizzes, announcements' },
  { email: 'admin@vertexon.demo', label: 'Admin', hint: 'metrics, approvals, moderation' },
] as const;

/**
 * Should the app answer API calls from the in-browser demo backend?
 *
 * Precedence:
 *   1. `?demo=on|off` in the URL — a runtime escape hatch on deployed sites.
 *   2. `VITE_DEMO_MODE=true|false` — explicit build-time override.
 *   3. Otherwise: on in a production build with no absolute API base URL
 *      (i.e. static hosting), off during `vite dev` where the dev proxy to
 *      localhost:4000 is expected to be running.
 */
export const isDemoMode = (): boolean => {
  if (typeof window !== 'undefined') {
    const flag = new URLSearchParams(window.location.search).get('demo');
    if (flag === 'on' || flag === 'true') return true;
    if (flag === 'off' || flag === 'false') return false;
  }

  const configured = import.meta.env.VITE_DEMO_MODE;
  if (configured === 'true') return true;
  if (configured === 'false') return false;

  if (import.meta.env.DEV) return false;

  const base = import.meta.env.VITE_API_BASE_URL ?? '';
  return !/^https?:\/\//i.test(base);
};