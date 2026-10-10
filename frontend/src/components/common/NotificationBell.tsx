import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiErrorMessage } from '../../services/api';
import { AppNotification } from '../../utils/types';
import { useI18n } from '../../utils/i18n';

/** In-app notification bell (PRD §3.1 notifications): unread badge + list. */
export default function NotificationBell() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data, error } = useQuery({
    queryKey: ['notifications'],
    queryFn: async () =>
      (await api.get<{ items: AppNotification[]; unread: number }>('/users/me/notifications')).data,
    refetchInterval: 30_000,
  });

  const markRead = useMutation({
    mutationFn: async (id: string) => (await api.put(`/notifications/${id}/read`)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markAll = useMutation({
    mutationFn: async () => (await api.post('/users/me/notifications/read-all')).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const unread = data?.unread ?? 0;

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={unread ? `${t('notifications.title')} (${unread})` : t('notifications.title')}
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100
          dark:border-slate-700 dark:hover:bg-slate-800"
      >
        🔔
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <div
            role="menu"
            aria-label={t('notifications.title')}
            className="absolute right-0 z-20 mt-2 max-h-96 w-80 overflow-y-auto rounded-xl border
              border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="flex items-center justify-between px-2 py-1">
              <span className="text-sm font-semibold">{t('notifications.title')}</span>
              {unread > 0 && (
                <button
                  className="text-xs text-brand-600 hover:underline"
                  onClick={() => markAll.mutate()}
                  disabled={markAll.isPending}
                >
                  {t('notifications.markAllRead')}
                </button>
              )}
            </div>

            {error && <p className="px-2 py-2 text-xs text-red-500">{apiErrorMessage(error)}</p>}
            {data?.items.length === 0 && (
              <p className="px-2 py-3 text-xs text-slate-400">{t('notifications.empty')}</p>
            )}

            {data?.items.map((n) => (
              <button
                key={n.id}
                role="menuitem"
                onClick={() => {
                  if (!n.is_read) markRead.mutate(n.id);
                }}
                className={`w-full rounded-lg px-2 py-2 text-left text-sm hover:bg-slate-50
                  dark:hover:bg-slate-800 ${n.is_read ? 'opacity-60' : ''}`}
              >
                <div className="flex items-start gap-2">
                  {!n.is_read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-600" />}
                  <div>
                    <div className="font-medium">{n.title}</div>
                    <div className="line-clamp-2 text-xs text-slate-500">{n.body}</div>
                    <div className="mt-0.5 text-[10px] text-slate-400">
                      {new Date(n.created_at).toLocaleString()}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
