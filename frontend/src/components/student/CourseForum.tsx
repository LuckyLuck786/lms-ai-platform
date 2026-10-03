import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiErrorMessage } from '../../services/api';
import { Alert, Card, Spinner } from '../common/ui';
import { Announcement, DiscussionPost, DiscussionThread } from '../../utils/types';

interface Props {
  courseId: string;
  /** Enrolled student (or staff) may post. */
  canPost: boolean;
  /** Course instructor or admin may remove posts. */
  canModerate: boolean;
}

/**
 * Per-course threaded discussion forum (read + post + flag + moderate)
 * plus the announcement feed (FR-I6, FR-AD5).
 */
export default function CourseForum({ courseId, canPost, canModerate }: Props) {
  const queryClient = useQueryClient();
  const [newThread, setNewThread] = useState('');
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [error, setError] = useState<string | null>(null);

  const threads = useQuery({
    queryKey: ['threads', courseId],
    queryFn: async () => (await api.get<{ items: DiscussionThread[] }>(`/courses/${courseId}/threads`)).data,
  });

  const announcements = useQuery({
    queryKey: ['announcements', courseId],
    queryFn: async () => (await api.get<{ items: Announcement[] }>(`/courses/${courseId}/announcements`)).data,
    retry: false,
  });

  const posts = useQuery({
    queryKey: ['posts', openThread],
    queryFn: async () => (await api.get<{ items: DiscussionPost[] }>(`/threads/${openThread}/posts`)).data,
    enabled: !!openThread,
  });

  const createThread = useMutation({
    mutationFn: async () => (await api.post(`/courses/${courseId}/threads`, { title: newThread })).data,
    onSuccess: () => {
      setNewThread('');
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['threads', courseId] });
    },
    onError: (e) => setError(apiErrorMessage(e)),
  });

  const addReply = useMutation({
    mutationFn: async () => (await api.post(`/threads/${openThread}/posts`, { content: reply })).data,
    onSuccess: () => {
      setReply('');
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['posts', openThread] });
      queryClient.invalidateQueries({ queryKey: ['threads', courseId] });
    },
    onError: (e) => setError(apiErrorMessage(e)),
  });

  const flag = useMutation({
    mutationFn: async (id: string) => (await api.post(`/posts/${id}/flag`)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['posts', openThread] }),
    onError: (e) => setError(apiErrorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/posts/${id}`)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['posts', openThread] }),
    onError: (e) => setError(apiErrorMessage(e)),
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <section aria-label="Discussion forum" className="space-y-4">
        <h2 className="text-lg font-semibold">💬 Discussion forum</h2>
        {error && <Alert>{error}</Alert>}

        {canPost && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (newThread.trim()) createThread.mutate();
            }}
          >
            <label htmlFor="new-thread" className="sr-only">New thread title</label>
            <input
              id="new-thread"
              className="input flex-1"
              placeholder="Start a discussion…"
              value={newThread}
              onChange={(e) => setNewThread(e.target.value)}
            />
            <button type="submit" className="btn-primary" disabled={!newThread.trim()}>
              Post
            </button>
          </form>
        )}

        {threads.isLoading && <div className="flex justify-center py-6"><Spinner /></div>}
        {threads.data?.items?.length === 0 && (
          <Card className="text-slate-500">No discussions yet — start one!</Card>
        )}

        {threads.data?.items.map((t) => (
          <Card key={t.id} className="cursor-pointer" >
            <button
              className="w-full text-left"
              onClick={() => setOpenThread(openThread === t.id ? null : t.id)}
              aria-expanded={openThread === t.id}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium">{t.title}</span>
                <span className="shrink-0 text-xs text-slate-400">
                  {t.post_count} post{t.post_count === 1 ? '' : 's'}
                </span>
              </div>
              <div className="mt-1 text-xs text-slate-400">
                started by {t.created_by_name} · {new Date(t.created_at).toLocaleDateString()}
              </div>
            </button>

            {openThread === t.id && (
              <div className="mt-4 space-y-3 border-t border-slate-100 pt-3 dark:border-slate-800">
                {posts.isLoading && <Spinner className="h-4 w-4" />}
                {posts.data?.items.map((p) => (
                  <div key={p.id} className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{p.author_name}</span>
                      <span className="text-xs text-slate-400">
                        {new Date(p.created_at).toLocaleString()}
                      </span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap">{p.content}</p>
                    <div className="mt-2 flex gap-3 text-xs">
                      {!p.is_flagged ? (
                        <button className="text-slate-400 hover:text-amber-600" onClick={() => flag.mutate(p.id)}>
                          🚩 Flag
                        </button>
                      ) : (
                        <span className="text-amber-600">🚩 flagged for review</span>
                      )}
                      {canModerate && (
                        <button
                          className="text-slate-400 hover:text-red-600"
                          onClick={() => remove.mutate(p.id)}
                        >
                          🗑 Remove
                        </button>
                      )}
                    </div>
                  </div>
                ))}

                {canPost && (
                  <form
                    className="flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (reply.trim()) addReply.mutate();
                    }}
                  >
                    <label htmlFor={`reply-${t.id}`} className="sr-only">Reply</label>
                    <input
                      id={`reply-${t.id}`}
                      className="input flex-1"
                      placeholder="Write a reply…"
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                    />
                    <button type="submit" className="btn-secondary" disabled={!reply.trim()}>
                      Reply
                    </button>
                  </form>
                )}
              </div>
            )}
          </Card>
        ))}
      </section>

      <aside aria-label="Announcements" className="space-y-3">
        <h2 className="text-lg font-semibold">📣 Announcements</h2>
        {announcements.data?.items?.length === 0 && (
          <Card className="text-sm text-slate-500">No announcements.</Card>
        )}
        {announcements.data?.items.map((a) => (
          <Card key={a.id}>
            <p className="whitespace-pre-wrap text-sm">{a.content}</p>
            <p className="mt-2 text-xs text-slate-400">
              {a.posted_by_name} · {new Date(a.created_at).toLocaleString()}
            </p>
          </Card>
        ))}
      </aside>
    </div>
  );
}
