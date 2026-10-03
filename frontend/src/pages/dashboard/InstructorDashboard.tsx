import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiErrorMessage } from '../../services/api';
import { Alert, Card, Spinner } from '../../components/common/ui';
import { Course } from '../../utils/types';
import InstructorContentTools from './InstructorContentTools';

/** Instructor workspace — create courses and inspect approval status (FR-I1). */
export default function InstructorDashboard() {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: '',
    description: '',
    category: 'Computer Science',
    difficulty: 'beginner',
    price: '0',
  });

  const myCourses = useQuery({
    queryKey: ['courses', 'mine'],
    queryFn: async () =>
      (await api.get<{ items: Course[] }>('/courses', { params: { limit: 50, mine: '1' } })).data,
  });

  const create = useMutation({
    mutationFn: async () =>
      (await api.post('/courses', { ...form, price: Number(form.price) })).data,
    onSuccess: () => {
      setFormError(null);
      setForm({ title: '', description: '', category: 'Computer Science', difficulty: 'beginner', price: '0' });
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
      <h1 className="text-2xl font-bold">Instructor workspace</h1>

      <Card>
        <h2 className="mb-3 font-semibold">Create a course</h2>
        {formError && <div className="mb-3"><Alert>{formError}</Alert></div>}
        <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="title">Title</label>
            <input id="title" className="input" required minLength={3} value={form.title} onChange={set('title')} />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="description">Description</label>
            <textarea id="description" className="input" rows={3} value={form.description} onChange={set('description')} />
          </div>
          <div>
            <label className="label" htmlFor="category">Category</label>
            <input id="category" className="input" value={form.category} onChange={set('category')} />
          </div>
          <div>
            <label className="label" htmlFor="difficulty">Difficulty</label>
            <select id="difficulty" className="input" value={form.difficulty} onChange={set('difficulty')}>
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="price">Price (USD, 0 = free)</label>
            <input id="price" type="number" min={0} step="0.01" className="input" value={form.price} onChange={set('price')} />
          </div>
          <div className="flex items-end">
            <button type="submit" className="btn-primary" disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create course (pending approval)'}
            </button>
          </div>
        </form>
      </Card>

      <section aria-label="My courses">
        <h2 className="mb-3 font-semibold">My courses</h2>
        {myCourses.isLoading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {myCourses.data?.items.map((c) => (
              <Link key={c.id} to={`/catalog/${c.id}`} className="card transition hover:shadow-md">
                <h3 className="font-semibold">{c.title}</h3>
                <p className="mt-1 text-xs text-slate-400">
                  Status:{' '}
                  <span className={c.status === 'approved' ? 'text-emerald-600' : 'text-amber-600'}>
                    {c.status}
                  </span>
                </p>
              </Link>
            ))}
            {myCourses.data?.items.length === 0 && (
              <Card className="text-slate-500">Create your first course above.</Card>
            )}
          </div>
        )}
      </section>

      <section aria-label="Content tools" className="space-y-3">
        <h2 className="text-lg font-semibold">Content & assessments</h2>
        <InstructorContentTools courses={myCourses.data?.items ?? []} />
      </section>
    </div>
  );
}
