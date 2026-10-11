import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../utils/i18n';

/**
 * Shared shell for the legal documents (terms, privacy).
 *
 * Long-form legal text is published in English only, which is standard for
 * this kind of document; the surrounding chrome stays translated.
 */
export function LegalPage({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="mx-auto max-w-3xl">
      <p className="eyebrow mb-1">{t('legal.title')}</p>
      <h1 className="font-display text-3xl text-ink-950 dark:text-white">{title}</h1>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('legal.updated')}</p>
      <p className="mt-5 text-slate-700 dark:text-slate-300">{intro}</p>

      <div className="mt-8 space-y-7 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
        {children}
      </div>

      <nav aria-label={t('legal.title')} className="mt-10 flex gap-5 border-t border-slate-300/70 pt-5 text-sm dark:border-white/10">
        <Link to="/terms" className="link-quiet">{t('legal.terms')}</Link>
        <Link to="/privacy" className="link-quiet">{t('legal.privacy')}</Link>
      </nav>
    </div>
  );
}

export function LegalSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-base font-semibold text-slate-900 dark:text-white">{heading}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

export function LegalList({ items }: { items: string[] }) {
  return (
    <ul className="ml-5 list-disc space-y-1">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}
