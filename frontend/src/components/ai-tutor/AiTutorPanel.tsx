import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiErrorMessage } from '../../services/api';
import { Alert, Spinner } from '../common/ui';
import { useI18n } from '../../utils/i18n';

interface ChatSource {
  lecture_id: string;
  lecture_title: string | null;
  timestamp_seconds: number | null;
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'ai';
  content: string;
  sources: ChatSource[] | null;
}

const MODES = [
  { value: 'beginner', labelKey: 'player.mode.beginner' },
  { value: 'intermediate', labelKey: 'player.mode.intermediate' },
  { value: 'advanced', labelKey: 'player.mode.advanced' },
  { value: 'auto', labelKey: 'player.mode.auto' },
] as const;

/**
 * AI Tutor chat (FR-A1/FR-A2/A6/A8): session per course, RAG-grounded replies
 * with lecture citations, beginner/intermediate/advanced depth switcher,
 * plus an adaptive mode that picks the depth from topic mastery.
 */
export default function AiTutorPanel({ courseId }: { courseId: string }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [mode, setMode] = useState<string>('intermediate');
  const [depth, setDepth] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const sessions = useQuery({
    queryKey: ['ai-sessions', courseId],
    queryFn: async () =>
      (await api.get<{ items: { id: string; mode: string }[] }>('/ai/chat/sessions', {
        params: { course_id: courseId },
      })).data,
  });

  // Adopt an existing session for this course, or lazily create one on first send.
  useEffect(() => {
    const first = sessions.data?.items?.[0];
    if (first && !sessionId) {
      setSessionId(first.id);
      setMode(first.mode || 'intermediate');
    }
  }, [sessions.data, sessionId]);

  const messages = useQuery({
    queryKey: ['ai-messages', sessionId],
    queryFn: async () =>
      (await api.get<{ items: ChatMessage[]; mode: string }>(`/ai/chat/sessions/${sessionId}/messages`))
        .data,
    enabled: !!sessionId,
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.data?.items.length]);

  const send = useMutation({
    mutationFn: async (text: string) => {
      let sid = sessionId;
      if (!sid) {
        const created = await api.post<{ id: string }>('/ai/chat/sessions', { course_id: courseId });
        sid = created.data.id;
        setSessionId(sid);
      }
      const { data } = await api.post<{
        reply: string;
        sources: ChatSource[];
        mode: string;
        depth?: string;
      }>(`/ai/chat/sessions/${sid}/messages`, { message: text });
      return data;
    },
    onSuccess: (data) => {
      setInput('');
      setError(null);
      setMode(data.mode);
      setDepth(data.depth ?? null);
      queryClient.invalidateQueries({ queryKey: ['ai-messages', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['ai-sessions', courseId] });
    },
    onError: (err) => setError(apiErrorMessage(err)),
  });

  const switchMode = async (next: string) => {
    setMode(next);
    if (!sessionId) return;
    try {
      await api.put(`/ai/chat/sessions/${sessionId}/mode`, { mode: next });
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  };

  const items = messages.data?.items ?? [];

  return (
    <section aria-label={t('player.aiTutor')} className="card flex h-[540px] flex-col">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-semibold">✨ {t('player.aiTutor')}</h2>
        <label htmlFor="ai-mode" className="sr-only">{t('player.depthLabel')}</label>
        <select
          id="ai-mode"
          className="input w-36 py-1.5 text-xs"
          value={mode}
          onChange={(e) => void switchMode(e.target.value)}
        >
          {MODES.map((m) => (
            <option key={m.value} value={m.value}>{t(m.labelKey)}</option>
          ))}
        </select>
      </div>

      {mode === 'auto' && depth && (
        <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
          🎯 {t('ai.depthAdjusted', { depth: t(`player.mode.${depth}`) })}
        </p>
      )}

      {error && <div className="mb-2"><Alert>{error}</Alert></div>}

      <div className="mb-3 flex-1 space-y-3 overflow-y-auto pr-1">
        {messages.isLoading && <div className="flex justify-center py-6"><Spinner /></div>}
        {items.length === 0 && !messages.isLoading && (
          <p className="text-sm text-slate-400">{t('player.askAnything')}</p>
        )}
        {items.map((m) => (
          <div
            key={m.id}
            className={`max-w-[90%] rounded-2xl px-4 py-2.5 text-sm ${
              m.sender === 'user'
                ? 'ml-auto bg-brand-600 text-white'
                : 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100'
            }`}
          >
            <p className="whitespace-pre-wrap">{m.content}</p>
            {m.sender === 'ai' && m.sources && m.sources.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {m.sources.map((s) => (
                  <span
                    key={s.lecture_id}
                    className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                    title={
                      s.timestamp_seconds != null
                        ? t('ai.citationTitle', { seconds: s.timestamp_seconds })
                        : undefined
                    }
                  >
                    📎 {s.lecture_title ?? 'lecture'}
                    {s.timestamp_seconds != null && ` @ ${Math.floor(s.timestamp_seconds / 60)}:${String(s.timestamp_seconds % 60).padStart(2, '0')}`}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
        {send.isPending && (
          <div className="w-fit rounded-2xl bg-slate-100 px-4 py-2.5 dark:bg-slate-800">
            <Spinner className="h-4 w-4" />
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const text = input.trim();
          if (text && !send.isPending) send.mutate(text);
        }}
      >
        <label htmlFor="ai-input" className="sr-only">{t('ai.askTheTutor')}</label>
        <input
          id="ai-input"
          className="input flex-1"
          placeholder={t('player.askPlaceholder')}
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button type="submit" className="btn-primary" disabled={!input.trim() || send.isPending}>
          {t('player.send')}
        </button>
      </form>
    </section>
  );
}
