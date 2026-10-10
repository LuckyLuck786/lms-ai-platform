import { FormEvent, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, apiErrorMessage } from '../../services/api';
import { Alert, Card, Spinner } from '../../components/common/ui';
import { Course } from '../../utils/types';
import { useI18n } from '../../utils/i18n';

interface CatalogPage {
  items: Course[];
  total: number;
  page: number;
  limit: number;
}

const CATEGORIES = ['Computer Science', 'Data Science', 'Mathematics', 'Business', 'Design'];

export default function CourseCatalog() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const category = params.get('category') ?? '';
  const difficulty = params.get('difficulty') ?? '';
  const page = Number(params.get('page') ?? 1);

  const query = useQuery({
    queryKey: ['catalog', q, category, difficulty, page],
    queryFn: async () => {
      const { data } = await api.get<CatalogPage>('/courses', {
        params: { q: q || undefined, category: category || undefined, difficulty: difficulty || undefined, page },
      });
      return data;
    },
  });

  const update = (next: Record<string, string>) => {
    const merged = new URLSearchParams(params);
    Object.entries(next).forEach(([k, v]) => (v ? merged.set(k, v) : merged.delete(k)));
    if (!('page' in next)) merged.delete('page');
    setParams(merged);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    update({ q });
  };

  const totalPages = query.data?.total && query.data?.limit
    ? Math.max(1, Math.ceil(Number(query.data.total) / Number(query.data.limit)))
    : 1;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t('catalog.title')}</h1>

      <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3" role="search">
        <div className="min-w-[220px] flex-1">
          <label className="label" htmlFor="q">{t('common.search')}</label>
          <input
            id="q"
            className="input"
            placeholder={t('catalog.searchPlaceholder')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="category">{t('catalog.category')}</label>
          <select id="category" className="input" value={category} onChange={(e) => update({ category: e.target.value })}>
            <option value="">{t('catalog.allCategories')}</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="difficulty">{t('catalog.difficulty')}</label>
          <select id="difficulty" className="input" value={difficulty} onChange={(e) => update({ difficulty: e.target.value })}>
            <option value="">{t('catalog.allLevels')}</option>
            <option value="beginner">{t('catalog.difficulty.beginner')}</option>
            <option value="intermediate">{t('catalog.difficulty.intermediate')}</option>
            <option value="advanced">{t('catalog.difficulty.advanced')}</option>
          </select>
        </div>
        <button type="submit" className="btn-primary">{t('common.search')}</button>
      </form>

      {query.error && <Alert>{apiErrorMessage(query.error)}</Alert>}
      {query.isLoading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : query.data?.items?.length === 0 ? (
        <Card className="text-center text-slate-500">{t('catalog.empty')}</Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {query.data?.items.map((c) => (
            <Link key={c.id} to={`/catalog/${c.id}`} className="card transition hover:shadow-md">
              <div className="mb-2 flex items-start justify-between gap-2">
                <h2 className="font-semibold">{c.title}</h2>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs uppercase dark:bg-slate-800">
                  {c.difficulty ?? '—'}
                </span>
              </div>
              <p className="mb-3 line-clamp-2 min-h-[2.5rem] text-sm text-slate-500">
                {c.description ?? 'No description yet.'}
              </p>
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>{c.instructor_name}</span>
                <span>
                  {Number(c.price) > 0 ? `$${c.price}` : t('catalog.free')} ·{' '}
                  {t('catalog.enrolledCount', { count: c.enrollment_count ?? 0 })}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button className="btn-secondary" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>
            {t('catalog.previous')}
          </button>
          <span className="text-sm text-slate-500">
            {t('catalog.pageOf', { page, total: totalPages })}
          </span>
          <button className="btn-secondary" disabled={page >= totalPages} onClick={() => update({ page: String(page + 1) })}>
            {t('common.next')}
          </button>
        </div>
      )}
    </div>
  );
}
