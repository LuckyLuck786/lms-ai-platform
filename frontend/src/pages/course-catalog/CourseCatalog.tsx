import { FormEvent, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, apiErrorMessage } from '../../services/api';
import { Alert, Card, RatingStars, SkeletonCard } from '../../components/common/ui';
import { Course } from '../../utils/types';
import { useI18n } from '../../utils/i18n';
import { GraduationCap } from '../../components/common/Icon';

interface CatalogPage {
  items: Course[];
  total: number;
  page: number;
  limit: number;
}

const CATEGORIES = ['Computer Science', 'Data Science', 'Mathematics', 'Business', 'Design'];
const RATING_STEPS = ['4', '3', '2'];

export default function CourseCatalog() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const category = params.get('category') ?? '';
  const difficulty = params.get('difficulty') ?? '';
  const minRating = params.get('minRating') ?? '';
  const page = Number(params.get('page') ?? 1);

  const query = useQuery({
    queryKey: ['catalog', q, category, difficulty, minRating, page],
    queryFn: async () => {
      const { data } = await api.get<CatalogPage>('/courses', {
        params: {
          q: q || undefined,
          category: category || undefined,
          difficulty: difficulty || undefined,
          minRating: minRating || undefined,
          page,
        },
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
      <div>
        <p className="eyebrow mb-1">{t('catalog.subtitle')}</p>
        <h1 className="font-display text-3xl text-ink-950 dark:text-white">{t('catalog.title')}</h1>
      </div>

      <form onSubmit={onSubmit} className="card flex flex-wrap items-end gap-3 py-4" role="search">
        <div className="min-w-[200px] flex-1">
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
        <div>
          <label className="label" htmlFor="minRating">{t('catalog.rating')}</label>
          <select id="minRating" className="input" value={minRating} onChange={(e) => update({ minRating: e.target.value })}>
            <option value="">{t('catalog.ratingAny')}</option>
            {RATING_STEPS.map((r) => (
              <option key={r} value={r}>{t('catalog.ratingAtLeast', { rating: r })}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-primary">{t('common.search')}</button>
      </form>

      {query.error && <Alert>{apiErrorMessage(query.error)}</Alert>}
      {query.isLoading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : query.data?.items?.length === 0 ? (
        <Card className="text-center text-slate-500">{t('catalog.empty')}</Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {query.data?.items.map((c) => {
            const rating = Number(c.avg_rating ?? 0);
            const reviews = Number(c.rating_count ?? 0);
            return (
              <Link
                key={c.id}
                to={`/catalog/${c.id}`}
                className="card card-hover grid grid-cols-[120px_1fr] overflow-hidden p-0"
              >
                {/* Cover: instructor thumbnail, or a quiet generated plate. */}
                <div className="relative overflow-hidden border-r border-slate-300/70 bg-paper-sunk dark:border-white/10 dark:bg-ink-800">
                  {c.thumbnail_url ? (
                    <img
                      src={c.thumbnail_url}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-slate-400/60">
                      <GraduationCap size={26} />
                    </span>
                  )}
                </div>

                <div className="flex flex-col p-4">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="chip capitalize">{c.difficulty ?? t('course.allLevels')}</span>
                    {c.category && <span className="text-[11px] text-slate-400">{c.category}</span>}
                  </div>
                  <h2 className="font-semibold leading-snug text-ink-950 dark:text-white">{c.title}</h2>
                  {reviews > 0 ? (
                    <RatingStars value={rating} count={reviews} className="mt-1.5" />
                  ) : (
                    <span className="mt-1.5 text-xs text-slate-400">{t('catalog.unrated')}</span>
                  )}
                  <p className="mb-3 mt-1.5 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">
                    {c.description ?? ''}
                  </p>
                  <div className="mt-auto flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                    <span>{c.instructor_name}</span>
                    <span className="font-semibold">{Number(c.price) > 0 ? `$${c.price}` : t('catalog.free')}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400">
                    {t('catalog.enrolledCount', { count: c.enrollment_count ?? 0 })}
                  </div>
                </div>
              </Link>
            );
          })}
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
