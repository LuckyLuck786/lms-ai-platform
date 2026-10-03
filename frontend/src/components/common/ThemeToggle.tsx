import { useEffect, useState } from 'react';

/** WCAG-friendly dark mode toggle persisted in localStorage. */
export default function ThemeToggle() {
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
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100
        dark:border-slate-700 dark:hover:bg-slate-800"
    >
      {dark ? '☀️ Light' : '🌙 Dark'}
    </button>
  );
}
