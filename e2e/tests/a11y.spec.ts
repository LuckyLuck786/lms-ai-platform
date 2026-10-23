import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'fs';
import { SESSIONS_FILE } from '../global-setup';

/**
 * Accessibility gate (PRD §6: WCAG 2.1 AA). Every main screen, for every role,
 * in light and dark theme, must have zero axe violations at the WCAG 2.0/2.1
 * A and AA levels.
 *
 * Sessions come from global-setup.ts (one API login per role) and are
 * injected into localStorage, so pages load already signed in.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

type Session = { access_token: string; refresh_token: string; user: unknown };
// Read lazily: test files are collected before global setup has written it.
type Fixtures = { sessions: Record<string, Session>; ids: { course: string; lecture: string; quiz: string | null } };
let cached: Fixtures | null = null;
const fixtures = (): Fixtures => (cached ??= JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8')));

async function open(page: Page, path: string, role: string | null, theme: 'light' | 'dark') {
  const session = role ? fixtures().sessions[role] : null;
  await page.addInitScript(
    ([s, t]) => {
      localStorage.setItem('theme', t as string);
      if (s) {
        const sess = s as Session;
        localStorage.setItem('lms.access_token', sess.access_token);
        localStorage.setItem('lms.refresh_token', sess.refresh_token);
        localStorage.setItem('lms.user', JSON.stringify(sess.user));
      }
    },
    [session, theme] as const,
  );
  await page.goto(path);
  await page.waitForLoadState('networkidle');
}

async function expectNoViolations(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const report = result.violations.map(
    (v) =>
      `[${v.impact}] ${v.id}: ${v.help}\n` +
      v.nodes
        .slice(0, 40)
        .map((n) => `    ${n.target.join(' ')} — ${n.failureSummary?.split('\n').slice(1).join(' ').trim()}`)
        .join('\n'),
  );
  expect(report, `${label}\n${report.join('\n')}`).toEqual([]);
}

const screens: { name: string; role: string | null; path: () => string }[] = [
  { name: 'login', role: null, path: () => '/login' },
  { name: 'register', role: null, path: () => '/register' },
  { name: 'catalog', role: null, path: () => '/catalog' },
  { name: 'course detail', role: 'student', path: () => `/catalog/${fixtures().ids.course}` },
  { name: 'student dashboard', role: 'student', path: () => '/' },
  { name: 'course player', role: 'student', path: () => `/learn/${fixtures().ids.course}/${fixtures().ids.lecture}` },
  { name: 'quiz', role: 'student', path: () => (fixtures().ids.quiz ? `/quiz/${fixtures().ids.quiz}` : '/') },
  { name: 'account', role: 'student', path: () => '/account' },
  { name: 'instructor dashboard', role: 'instructor', path: () => '/instructor' },
  { name: 'admin panel', role: 'admin', path: () => '/admin' },
  { name: 'terms', role: null, path: () => '/terms' },
];

for (const theme of ['light', 'dark'] as const) {
  for (const s of screens) {
    test(`${s.name} (${theme}) has no WCAG 2.1 AA violations`, async ({ page }) => {
      await open(page, s.path(), s.role, theme);
      await expectNoViolations(page, `${s.name} (${theme})`);
    });
  }
}
