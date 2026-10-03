import { DEMO_MODE } from '../../services/api';
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '../../services/demo';

/**
 * Explains that the deployed build is running on the in-browser sample
 * backend, and points at the two ways to get real data behind it.
 * Renders nothing whenever `VITE_API_BASE_URL` points at a live API.
 */
export default function DemoBanner() {
  if (!DEMO_MODE) return null;

  return (
    <div
      role="status"
      className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1">
        <strong className="font-semibold">Demo mode.</strong>
        <span>
          No backend is configured, so this build answers API calls from a small in-browser sample
          database. Sign in with{' '}
          <code className="rounded bg-amber-100 px-1 dark:bg-amber-900">
            {DEMO_ACCOUNTS[0].email}
          </code>{' '}
          or any of {DEMO_ACCOUNTS.length} sample accounts (password{' '}
          <code className="rounded bg-amber-100 px-1 dark:bg-amber-900">{DEMO_PASSWORD}</code>).
          Sample content resets on reload; your demo sign-in is remembered.
        </span>
        <a
          className="font-medium underline underline-offset-2"
          href="https://github.com/LuckyLuck786/lms-ai-platform#readme"
          target="_blank"
          rel="noreferrer"
        >
          Run the real stack
        </a>
        <a className="font-medium underline underline-offset-2" href="?demo=off">
          Try the live API instead
        </a>
      </div>
    </div>
  );
}