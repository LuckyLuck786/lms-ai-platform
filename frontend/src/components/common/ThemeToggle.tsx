import { useEffect, useState } from 'react';
import { useI18n } from '../../utils/i18n';

/** WCAG-friendly dark mode toggle persisted in localStorage. */
export default function ThemeToggle() {
  const { t } = useI18n();
  const [dark, setDark] = useState(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark'),
  );

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem('theme', dark ? 'dark' : 'light');
    } catch {
      /* storage unavailable */
    }
  }, [dark]);

  return (
    <button
      type="button"
      onClick={() => setDark((d) => !d)}
      aria-pressed={dark}
      aria-label={t('theme.toggle')}
      className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100
        dark:border-slate-700 dark:hover:bg-slate-800"
    >
      {dark ? `☀️ ${t('theme.light')}` : `🌙 ${t('theme.dark')}`}
    </button>
  );
}
