import { DEMO_MODE } from '../../services/api';
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '../../services/demo';
import { useI18n } from '../../utils/i18n';

/**
 * Explains that the deployed build is running on the in-browser sample
 * backend, and points at the two ways to get real data behind it.
 * Renders nothing whenever `VITE_API_BASE_URL` points at a live API.
 */
export default function DemoBanner() {
  const { t } = useI18n();
  if (!DEMO_MODE) return null;

  return (
    <div
      role="status"
      className="border-b border-slate-300/70 bg-paper-sunk px-4 py-2 text-xs text-slate-600 dark:border-white/10 dark:bg-ink-800 dark:text-slate-300"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1">
        <span className="eyebrow">{t('demo.title')}</span>
        <span>
          {t('demo.body', { email: DEMO_ACCOUNTS[0].email, password: DEMO_PASSWORD })}{' '}
          {t('demo.reset')}
        </span>
        <a
          className="font-medium underline underline-offset-2 hover:text-slate-900 dark:hover:text-white"
          href="https://github.com/LuckyLuck786/lms-ai-platform#readme"
          target="_blank"
          rel="noreferrer"
        >
          {t('demo.runReal')}
        </a>
        <a className="font-medium underline underline-offset-2" href="?demo=off">
          {t('demo.tryApi')}
        </a>
      </div>
    </div>
  );
}