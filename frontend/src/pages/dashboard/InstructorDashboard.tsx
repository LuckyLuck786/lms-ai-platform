import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiErrorMessage } from '../../services/api';
import { Alert, Card, Spinner } from '../../components/common/ui';
import { Course } from '../../utils/types';
import { GraduationCap } from '../../components/common/Icon';
import InstructorContentTools from './InstructorContentTools';
import InstructorAnalytics from './InstructorAnalytics';
import { useI18n } from '../../utils/i18n';

/** Instructor workspace — create courses and inspect approval status (FR-I1). */
export default function InstructorDashboard() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: '',
    description: '',
    category: 'Computer Science',
    difficulty: 'beginner',
    thumbnail_url: '',
    price: '0',
  });

  const myCourses = useQuery({
    queryKey: ['courses', 'mine'],
    queryFn: async () =>
      (await api.get<{ items: Course[] }>('/courses', { params: { limit: 50, mine: '1' } })).data,
  });

  const create = useMutation({
    mutationFn: async () =>
      (await api.post('/courses', {
        ...form,
        // Empty string means "no thumbnail" — the schema accepts '' literally.
        thumbnail_url: form.thumbnail_url.trim() || '',
        price: Number(form.price),
      })).data,
    onSuccess: () => {
      setFormError(null);
      setForm({
        title: '',
        description: '',
        category: 'Computer Science',
        difficulty: 'beginner',
        thumbnail_url: '',
        price: '0',
      });
      queryClient.invalidateQueries({ queryKey: ['courses', 'mine'] });
      queryClient.invalidateQueries({ queryKey: ['catalog'] });
    },
    onError: (err) => setFormError(apiErrorMessage(err)),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t('instructor.title')}</h1>

      <Card>
        <h2 className="mb-3 font-semibold">{t('instructor.createCourse')}</h2>
        {formError && <div className="mb-3"><Alert>{formError}</Alert></div>}
        <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="title">{t('instructor.courseTitle')}</label>
            <input id="title" className="input" required minLength={3} value={form.title} onChange={set('title')} />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="description">{t('instructor.description')}</label>
            <textarea id="description" className="input" rows={3} value={form.description} onChange={set('description')} />
          </div>
          <div>
            <label className="label" htmlFor="category">{t('catalog.category')}</label>
            <input id="category" className="input" value={form.category} onChange={set('category')} />
          </div>
          <div>
            <label className="label" htmlFor="difficulty">{t('catalog.difficulty')}</label>
            <select id="difficulty" className="input" value={form.difficulty} onChange={set('difficulty')}>
              <option value="beginner">{t('catalog.difficulty.beginner')}</option>
              <option value="intermediate">{t('catalog.difficulty.intermediate')}</option>
              <option value="advanced">{t('catalog.difficulty.advanced')}</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="thumbnail_url">{t('instructor.thumbnail')}</label>
            <input
              id="thumbnail_url"
              type="url"
              className="input"
              placeholder="https://…/cover.jpg"
              value={form.thumbnail_url}
              onChange={set('thumbnail_url')}
            />
          </div>
          <div>
            <label className="label" htmlFor="price">{t('instructor.price')}</label>
            <input id="price" type="number" min={0} step="0.01" className="input" value={form.price} onChange={set('price')} />
          </div>
          <div className="flex items-end">
            <button type="submit" className="btn-primary" disabled={create.isPending}>
              {create.isPending ? t('common.creating') : t('instructor.createCoursePending')}
            </button>
          </div>
        </form>
      </Card>

      <section aria-label={t('dashboard.myCoursesInstructor')}>
        <h2 className="mb-3 font-semibold">{t('dashboard.myCoursesInstructor')}</h2>
        {myCourses.isLoading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {myCourses.data?.items.map((c) => (
              <Link key={c.id} to={`/catalog/${c.id}`} className="card card-hover overflow-hidden p-0">
                <div className="relative aspect-[16/9] bg-paper-sunk dark:bg-ink-800">
                  {c.thumbnail_url ? (
                    <img src={c.thumbnail_url} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-white/25">
                      <GraduationCap size={30} />
                    </span>
                  )}
                </div>
                <div className="p-5">
                  <h3 className="font-semibold leading-snug">{c.title}</h3>
                  <p className="mt-1.5 text-xs">
                    <span className="chip capitalize">
                      <span
                        aria-hidden="true"
                        className={`h-1.5 w-1.5 rounded-sm ${
                          c.status === 'approved' ? 'bg-emerald-800' : 'bg-gold-500'
                        }`}
                      />
                      {c.status}
                    </span>
                  </p>
                </div>
              </Link>
            ))}
            {myCourses.data?.items.length === 0 && (
              <Card className="text-slate-600 dark:text-slate-400">{t('instructor.firstCourse')}</Card>
            )}
          </div>
        )}
      </section>

      <InstructorAnalytics courses={myCourses.data?.items ?? []} />

      <section aria-label={t('dashboard.instructorTools')} className="space-y-3">
        <h2 className="text-lg font-semibold">{t('instructor.contentAndAssessments')}</h2>
        <InstructorContentTools courses={myCourses.data?.items ?? []} />
      </section>
    </div>
  );
}
