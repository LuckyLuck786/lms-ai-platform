import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiErrorMessage } from '../../services/api';
import { Alert, Card, Spinner } from '../../components/common/ui';
import { AdminOverview, AdminUser, PendingCourse, Role } from '../../utils/types';
import { useI18n } from '../../utils/i18n';

type Tab = 'overview' | 'users' | 'approvals' | 'moderation';

const TABS: { id: Tab; labelKey: string }[] = [
  { id: 'overview', labelKey: 'admin.overview' },
  { id: 'users', labelKey: 'admin.users' },
  { id: 'approvals', labelKey: 'admin.courseApprovals' },
  { id: 'moderation', labelKey: 'admin.moderation' },
];

/** Admin panel (FR-AD1..AD5): platform metrics, users, approvals, moderation. */
export default function AdminDashboard() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('overview');

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t('admin.panel')}</h1>

      <nav
        aria-label={t('admin.sections')}
        className="flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-800"
      >
        {TABS.map((item) => (
          <button
            key={item.id}
            onClick={() => setTab(item.id)}
            aria-current={tab === item.id ? 'page' : undefined}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
              tab === item.id
                ? 'border-brand-600 text-brand-700 dark:text-brand-100'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            {t(item.labelKey)}
          </button>
        ))}
      </nav>

      {tab === 'overview' && <Overview />}
      {tab === 'users' && <Users />}
      {tab === 'approvals' && <Approvals />}
      {tab === 'moderation' && <Moderation />}
    </div>
  );
}

function Overview() {
  const { t } = useI18n();
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: async () => (await api.get<AdminOverview>('/admin/analytics/overview')).data,
    refetchInterval: 30_000,
  });

  if (isLoading) return <div className="flex justify-center py-10"><Spinner /></div>;
  if (error) return <Alert>{apiErrorMessage(error)}</Alert>;
  if (!data) return null;

  const metrics: { label: string; value: string }[] = [
    { label: t('admin.dau'), value: String(data.dau) },
    { label: t('admin.totalUsers'), value: String(data.total_users) },
    { label: t('admin.enrolments'), value: String(data.total_enrollments) },
    { label: t('admin.completionRate'), value: `${data.completion_rate}%` },
    {
      label: t('dashboard.coursesCount'),
      value: t('admin.coursesApproved', {
        approved: data.approved_courses,
        total: data.total_courses,
      }),
    },
    { label: t('admin.pendingApprovals'), value: String(data.pending_courses) },
    { label: t('admin.revenue'), value: `$${data.revenue.toFixed(2)}` },
    { label: t('admin.flaggedPosts'), value: String(data.flagged_posts) },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {metrics.map((m) => (
        <Card key={m.label}>
          <div className="text-xs uppercase text-slate-400">{m.label}</div>
          <div className="mt-1 text-2xl font-bold">{m.value}</div>
        </Card>
      ))}
    </div>
  );
}

function Users() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const users = useQuery({
    queryKey: ['admin', 'users', q],
    queryFn: async () => (await api.get<{ items: AdminUser[] }>('/admin/users', { params: { q } })).data,
  });

  const changeRole = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: Role }) =>
      (await api.put(`/admin/users/${id}/role`, { role })).data,
    onSuccess: () => {
      setMessage(null);
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (e) => setMessage(apiErrorMessage(e)),
  });

  const toggleSuspend = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) =>
      (await api.put(`/admin/users/${id}/suspend`, { is_active })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }),
    onError: (e) => setMessage(apiErrorMessage(e)),
  });

  return (
    <div className="space-y-4">
      {message && <Alert>{message}</Alert>}
      <form
        className="flex gap-2"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(search);
        }}
      >
        <label htmlFor="user-search" className="sr-only">{t('admin.searchUsers')}</label>
        <input
          id="user-search"
          className="input max-w-sm flex-1"
          placeholder={t('admin.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button type="submit" className="btn-secondary">{t('common.search')}</button>
      </form>

      {users.isLoading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-400 dark:border-slate-800">
                <th className="px-4 py-3">{t('admin.user')}</th>
                <th className="px-4 py-3">{t('admin.role')}</th>
                <th className="px-4 py-3">{t('admin.enrolments')}</th>
                <th className="px-4 py-3">{t('admin.status')}</th>
                <th className="px-4 py-3">{t('admin.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {users.data?.items.map((u) => (
                <tr key={u.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800/60">
                  <td className="px-4 py-3">
                    <div className="font-medium">{u.full_name}</div>
                    <div className="text-xs text-slate-400">{u.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      className="input w-32 py-1 text-xs"
                      value={u.roles[0] ?? 'student'}
                      onChange={(e) => changeRole.mutate({ id: u.id, role: e.target.value as Role })}
                      aria-label={t('admin.roleFor', { name: u.full_name })}
                    >
                      <option value="student">student</option>
                      <option value="instructor">instructor</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">{u.enrollment_count}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        u.is_active
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                          : 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
                      }`}
                    >
                      {u.is_active ? t('admin.active') : t('admin.suspended')}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      className="btn-secondary py-1 text-xs"
                      onClick={() => toggleSuspend.mutate({ id: u.id, is_active: !u.is_active })}
                    >
                      {u.is_active ? t('admin.suspend') : t('admin.restore')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function Approvals() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [comment, setComment] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const queue = useQuery({
    queryKey: ['admin', 'pending'],
    queryFn: async () => (await api.get<{ items: PendingCourse[] }>('/admin/courses/pending')).data,
  });

  const decide = useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: 'approved' | 'rejected' }) =>
      (
        await api.post(`/courses/${id}/approve`, {
          decision,
          comment: comment[id] || undefined,
        })
      ).data,
    onSuccess: () => {
      setMessage(null);
      queryClient.invalidateQueries({ queryKey: ['admin', 'pending'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'overview'] });
      queryClient.invalidateQueries({ queryKey: ['catalog'] });
    },
    onError: (e) => setMessage(apiErrorMessage(e)),
  });

  if (queue.isLoading) return <div className="flex justify-center py-10"><Spinner /></div>;

  return (
    <div className="space-y-4">
      {message && <Alert>{message}</Alert>}
      {queue.data?.items.length === 0 && (
        <Card className="text-slate-500">{t('admin.approvalsEmpty')}</Card>
      )}
      {queue.data?.items.map((c) => (
        <Card key={c.id}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold">{c.title}</h3>
              <p className="text-sm text-slate-500">
                {t('course.by', { name: c.instructor_name ?? '' })} ·{' '}
                {c.category ?? t('admin.uncategorized')} · {c.difficulty ?? '—'} ·{' '}
                {t('admin.moduleCount', { count: c.module_count })}
              </p>
              <p className="mt-1 line-clamp-2 text-sm text-slate-500">{c.description}</p>
            </div>
            <div className="flex gap-2">
              <button className="btn-primary" onClick={() => decide.mutate({ id: c.id, decision: 'approved' })}>
                {t('admin.approve')}
              </button>
              <button
                className="btn-secondary"
                onClick={() => decide.mutate({ id: c.id, decision: 'rejected' })}
              >
                {t('admin.reject')}
              </button>
            </div>
          </div>
          <input
            className="input mt-3"
            placeholder={t('admin.reviewerComment')}
            value={comment[c.id] ?? ''}
            onChange={(e) => setComment((m) => ({ ...m, [c.id]: e.target.value }))}
            aria-label={t('admin.reviewerCommentFor', { title: c.title })}
          />
        </Card>
      ))}
    </div>
  );
}

interface FlaggedPost {
  id: string;
  content: string;
  created_at: string;
  author_name: string;
  thread_title: string;
  course_title: string;
}

function Moderation() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);

  const flagged = useQuery({
    queryKey: ['admin', 'flagged'],
    queryFn: async () => (await api.get<{ items: FlaggedPost[] }>('/admin/moderation/flagged-posts')).data,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/admin/moderation/posts/${id}`)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'flagged'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'overview'] });
    },
    onError: (e) => setMessage(apiErrorMessage(e)),
  });

  return (
    <div className="space-y-4">
      {message && <Alert>{message}</Alert>}
      {flagged.isLoading ? (
        <div className="flex justify-center py-10"><Spinner /></div>
      ) : flagged.data?.items.length === 0 ? (
        <Card className="text-slate-500">{t('admin.flaggedEmpty')}</Card>
      ) : (
        flagged.data?.items.map((p) => (
          <Card key={p.id}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm">{p.content}</p>
                <p className="mt-2 text-xs text-slate-400">
                  {p.author_name} in “{p.thread_title}” ({p.course_title}) ·{' '}
                  {new Date(p.created_at).toLocaleString()}
                </p>
              </div>
              <button className="btn-secondary text-red-600" onClick={() => remove.mutate(p.id)}>
                {t('admin.remove')}
              </button>
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
