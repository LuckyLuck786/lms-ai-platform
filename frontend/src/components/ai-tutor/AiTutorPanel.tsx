import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiErrorMessage } from '../../services/api';
import { Alert, Spinner } from '../common/ui';

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
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
] as const;

/**
 * AI Tutor chat (FR-A1/FR-A2/A6): session per course, RAG-grounded replies
 * with lecture citations, beginner/intermediate/advanced depth switcher.
 */
export default function AiTutorPanel({ courseId }: { courseId: string }) {
  const queryClient = useQueryClient();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [mode, setMode] = useState<string>('intermediate');
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
    const first = sessions.data?.items[0];
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
      const { data } = await api.post<{ reply: string; sources: ChatSource[]; mode: string }>(
        `/ai/chat/sessions/${sid}/messages`,
        { message: text },
      );
      return data;
    },
    onSuccess: (data) => {
      setInput('');
      setError(null);
      setMode(data.mode);
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
    <section aria-label="AI Tutor" className="card flex h-[540px] flex-col">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-semibold">✨ AI Tutor</h2>
        <label htmlFor="ai-mode" className="sr-only">Explanation depth</label>
        <select
          id="ai-mode"
          className="input w-36 py-1.5 text-xs"
          value={mode}
          onChange={(e) => void switchMode(e.target.value)}
        >
          {MODES.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </div>

      {error && <div className="mb-2"><Alert>{error}</Alert></div>}

      <div className="mb-3 flex-1 space-y-3 overflow-y-auto pr-1">
        {messages.isLoading && <div className="flex justify-center py-6"><Spinner /></div>}
        {items.length === 0 && !messages.isLoading && (
          <p className="text-sm text-slate-400">
            Ask anything about this course — answers are grounded in the course material with
            citations to specific lectures.
          </p>
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
                    title={s.timestamp_seconds != null ? `≈ ${s.timestamp_seconds}s into the lecture` : undefined}
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
        <label htmlFor="ai-input" className="sr-only">Ask the AI tutor</label>
        <input
          id="ai-input"
          className="input flex-1"
          placeholder="Ask a question about this course…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button type="submit" className="btn-primary" disabled={!input.trim() || send.isPending}>
          Send
        </button>
      </form>
    </section>
  );
}
