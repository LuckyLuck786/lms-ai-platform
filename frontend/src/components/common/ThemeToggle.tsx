import { useEffect, useState } from 'react';
import { useI18n } from '../../utils/i18n';
import { Moon, Sun } from './Icon';

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
      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm transition
        hover:bg-slate-100 dark:border-white/10 dark:hover:bg-white/[0.06]"
    >
      {dark ? <Sun /> : <Moon />}
      {dark ? t('theme.light') : t('theme.dark')}
    </button>
  );
}
