import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiErrorMessage } from '../../services/api';
import { Alert, Card, ProgressBar, Spinner } from '../../components/common/ui';
import { Bookmark, CourseDetail, Enrollment, Lecture, LectureProgress, Note } from '../../utils/types';
import AiTutorPanel from '../../components/ai-tutor/AiTutorPanel';
import AiTools from '../../components/ai-tutor/AiTools';
import { useI18n } from '../../utils/i18n';

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
const SAVE_INTERVAL_MS = 10_000;

const fmt = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

const RESOURCE_ICONS: Record<string, string> = {
  pdf: '📄',
  ppt: '📊',
  pptx: '📊',
  doc: '📝',
  docx: '📝',
  xls: '📈',
  xlsx: '📈',
  zip: '🗜️',
  txt: '🗒️',
  md: '🗒️',
  png: '🖼️',
  jpg: '🖼️',
  jpeg: '🖼️',
  mp4: '🎬',
};

/**
 * Friendly label for an uploaded resource.
 *
 * Files are stored as "<uuid>-<slug>.<ext>", so the random prefix is dropped.
 * Demo-mode uploads are blob URLs and carry the original name in the hash.
 */
export function resourceLabel(url: string): string {
  const hashName = /#name=([^&]+)/.exec(url);
  if (hashName) return decodeURIComponent(hashName[1]);
  const segment = url.split('?')[0].split('#')[0].split('/').pop() ?? url;
  const withoutId = segment.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-?/i, '');
  return decodeURIComponent(withoutId || segment);
}

function resourceIcon(url: string): string {
  const ext = url.split('?')[0].split('#')[0].split('.').pop()?.toLowerCase() ?? '';
  return RESOURCE_ICONS[ext] ?? '📎';
}

/**
 * Course player (FR-S4/S5): resume-from-position, playback speed,
 * timestamped notes and bookmarks, watched-seconds reporting.
 */
export default function CoursePlayer() {
  const { t } = useI18n();
  const { courseId = '', lectureId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const videoRef = useRef<HTMLVideoElement>(null);
  const lastSaved = useRef(0);
  const [speed, setSpeed] = useState(1);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteAt, setNoteAt] = useState(0);

  const course = useQuery({
    queryKey: ['course', courseId],
    queryFn: async () => (await api.get<CourseDetail>(`/courses/${courseId}`)).data,
    enabled: !!courseId,
  });

  const progress = useQuery({
    queryKey: ['progress', lectureId],
    queryFn: async () => (await api.get<LectureProgress>(`/lectures/${lectureId}/progress`)).data,
    enabled: !!lectureId,
  });

  const notes = useQuery({
    queryKey: ['notes', lectureId],
    queryFn: async () => (await api.get<{ items: Note[] }>(`/lectures/${lectureId}/notes`)).data,
    enabled: !!lectureId,
  });

  const bookmarks = useQuery({
    queryKey: ['bookmarks', lectureId],
    queryFn: async () => (await api.get<{ items: Bookmark[] }>(`/lectures/${lectureId}/bookmarks`)).data,
    enabled: !!lectureId,
  });

  const courseProgress = useQuery({
    queryKey: ['enrollments', 'me'],
    queryFn: async () => (await api.get<{ items: Enrollment[] }>('/enrollments/me')).data,
    select: (data) =>
      Number(data.items.find((e) => e.course_id === courseId)?.progress_percent ?? 0),
  });

  const flatLectures: Lecture[] = useMemo(
    () => course.data?.modules.flatMap((m) => m.lectures) ?? [],
    [course.data],
  );
  const currentIndex = flatLectures.findIndex((l) => l.id === lectureId);
  const lecture = flatLectures[currentIndex];

  const saveProgress = useMutation({
    mutationFn: async ({ watched, completed }: { watched: number; completed?: boolean }) =>
      (
        await api.post(`/lectures/${lectureId}/progress`, {
          watched_seconds: Math.floor(watched),
          ...(completed !== undefined ? { completed } : {}),
        })
      ).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['progress', lectureId] }),
  });

  // Resume from last saved position once metadata loads.
  const onLoadedMetadata = () => {
    const video = videoRef.current;
    const saved = progress.data?.watched_seconds ?? 0;
    if (video && saved > 2 && saved < (video.duration || Infinity) - 2) {
      video.currentTime = saved;
    }
  };

  // Persist watched-seconds periodically while playing + on unmount.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !lectureId) return;

    const interval = setInterval(() => {
      if (!video.paused && video.currentTime - lastSaved.current >= 5) {
        lastSaved.current = video.currentTime;
        saveProgress.mutate({ watched: video.currentTime });
      }
    }, SAVE_INTERVAL_MS);

    const flush = () => {
      if (video.currentTime > 2) saveProgress.mutate({ watched: video.currentTime });
    };
    window.addEventListener('beforeunload', flush);
    return () => {
      clearInterval(interval);
      window.removeEventListener('beforeunload', flush);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lectureId]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed;
  }, [speed]);

  const seekTo = (seconds: number) => {
    if (videoRef.current) videoRef.current.currentTime = seconds;
    setNoteAt(seconds);
  };

  const addNote = async () => {
    if (!noteDraft.trim()) return;
    const at = videoRef.current?.currentTime ?? noteAt;
    try {
      await api.post(`/lectures/${lectureId}/notes`, {
        timestamp_seconds: Math.floor(at),
        content: noteDraft,
      });
      setNoteDraft('');
      queryClient.invalidateQueries({ queryKey: ['notes', lectureId] });
    } catch (err) {
      alert(apiErrorMessage(err));
    }
  };

  const addBookmark = async () => {
    const at = videoRef.current?.currentTime ?? 0;
    try {
      await api.post(`/lectures/${lectureId}/bookmarks`, { timestamp_seconds: Math.floor(at) });
      queryClient.invalidateQueries({ queryKey: ['bookmarks', lectureId] });
    } catch (err) {
      alert(apiErrorMessage(err));
    }
  };

  const deleteNote = async (id: string) => {
    await api.delete(`/notes/${id}`);
    queryClient.invalidateQueries({ queryKey: ['notes', lectureId] });
  };

  const deleteBookmark = async (id: string) => {
    await api.delete(`/bookmarks/${id}`);
    queryClient.invalidateQueries({ queryKey: ['bookmarks', lectureId] });
  };

  const markComplete = () => {
    const video = videoRef.current;
    saveProgress.mutate({ watched: video?.duration ?? lecture?.duration_seconds ?? 0, completed: true });
  };

  if (course.isLoading) return <div className="flex justify-center py-12"><Spinner /></div>;
  if (course.error) return <Alert>{apiErrorMessage(course.error)}</Alert>;
  if (!lecture) return <Alert>{t('player.lectureNotFound')}</Alert>;

  const next = flatLectures[currentIndex + 1];

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-500">
          <Link to={`/catalog/${courseId}`} className="hover:underline">{course.data?.title}</Link>
          <span className="mx-2">/</span>
          <span>{lecture.title}</span>
        </nav>

        {lecture.video_url ? (
          <video
            ref={videoRef}
            key={lecture.id}
            src={lecture.video_url}
            controls
            preload="metadata"
            onLoadedMetadata={onLoadedMetadata}
            className="aspect-video w-full rounded-xl bg-black"
          >
            Your browser does not support HTML5 video.
          </video>
        ) : (
          <Card className="aspect-video flex flex-col items-center justify-center text-slate-500">
            <p className="mb-2">🎬 {t('player.noVideo')}</p>
            <p className="max-w-xl text-sm">{lecture.transcript ?? ''}</p>
          </Card>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="speed" className="text-sm text-slate-500">{t('player.speed')}</label>
          <select
            id="speed"
            className="input w-24"
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
          >
            {SPEEDS.map((s) => <option key={s} value={s}>{s}x</option>)}
          </select>
          <button className="btn-secondary" onClick={addBookmark}>🔖 {t('player.bookmark')}</button>
          <button className="btn-secondary" onClick={markComplete}>✓ {t('player.markComplete')}</button>
          {next && (
            <button className="btn-primary" onClick={() => navigate(`/learn/${courseId}/${next.id}`)}>
              {t('player.nextLecture')}
            </button>
          )}
          {progress.data && (
            <span className="text-xs text-slate-400">
              {progress.data.completed
                ? t('player.completed')
                : t('player.resumeAt', { time: fmt(progress.data.watched_seconds) })}
            </span>
          )}
        </div>

        {/* Instructor-uploaded material (FR-I2) */}
        {lecture.resource_urls && lecture.resource_urls.length > 0 && (
          <Card>
            <h2 className="mb-3 font-semibold">📎 {t('player.material')}</h2>
            <ul className="space-y-2">
              {lecture.resource_urls.map((url) => (
                <li key={url}>
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 text-sm text-brand-600 hover:underline"
                  >
                    <span aria-hidden="true">{resourceIcon(url)}</span>
                    <span>{resourceLabel(url)}</span>
                  </a>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {/* AI tutor + generation tools (Phase 3) */}
      <div className="grid gap-4 lg:grid-cols-2">
        <AiTutorPanel courseId={courseId} />
        <AiTools lectureId={lectureId} moduleId={lecture.module_id} courseId={courseId} />
      </div>

      {/* Notes */}
        <Card>
          <h2 className="mb-3 font-semibold">{t('player.notes')}</h2>
          <div className="mb-3 flex gap-2">
            <input
              className="input flex-1"
              placeholder={t('player.notePlaceholder')}
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addNote()}
              aria-label={t('player.newNote')}
            />
            <button className="btn-primary" onClick={addNote} disabled={!noteDraft.trim()}>
              {t('common.add')}
            </button>
          </div>
          <ul className="space-y-2">
            {notes.data?.items.map((n) => (
              <li key={n.id} className="flex items-start justify-between gap-3 text-sm">
                <button
                  className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700"
                  onClick={() => seekTo(n.timestamp_seconds)}
                >
                  {fmt(n.timestamp_seconds)}
                </button>
                <span className="flex-1">{n.content}</span>
                <button aria-label={t('player.deleteNote')} className="text-slate-400 hover:text-red-500" onClick={() => deleteNote(n.id)}>✕</button>
              </li>
            ))}
            {notes.data?.items.length === 0 && (
              <li className="text-sm text-slate-400">{t('player.noNotes')}</li>
            )}
          </ul>
        </Card>

        {/* Bookmarks */}
        <Card>
          <h2 className="mb-3 font-semibold">{t('player.bookmarks')}</h2>
          <ul className="flex flex-wrap gap-2">
            {bookmarks.data?.items.map((b) => (
              <li key={b.id} className="flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs dark:bg-slate-800">
                <button className="font-mono hover:underline" onClick={() => seekTo(b.timestamp_seconds)}>
                  ⏱ {fmt(b.timestamp_seconds)}
                </button>
                <button aria-label={t('player.removeBookmark')} className="text-slate-400 hover:text-red-500" onClick={() => deleteBookmark(b.id)}>✕</button>
              </li>
            ))}
            {bookmarks.data?.items.length === 0 && (
              <li className="text-sm text-slate-400">{t('player.noBookmarks')}</li>
            )}
          </ul>
        </Card>
      </div>

      {/* Sidebar: course outline */}
      <aside aria-label={t('player.courseOutline')} className="space-y-3">
        <Card>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">{course.data?.title}</h2>
          </div>
        </Card>
        {course.data?.modules.map((m) => (
          <Card key={m.id}>
            <h3 className="mb-2 text-sm font-semibold text-slate-500">{m.title}</h3>
            <ul className="space-y-1">
              {m.lectures.map((l) => (
                <li key={l.id}>
                  <button
                    className={`w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800 ${
                      l.id === lectureId ? 'bg-brand-50 font-medium text-brand-700 dark:bg-slate-800 dark:text-brand-100' : ''
                    }`}
                    onClick={() => navigate(`/learn/${courseId}/${l.id}`)}
                  >
                    🎬 {l.title}
                  </button>
                </li>
              ))}
            </ul>
            {m.quizzes?.length > 0 && (
              <div className="mt-2 border-t border-slate-100 pt-2 dark:border-slate-800">
                {m.quizzes.map((q) => (
                  <Link
                    key={q.id}
                    to={`/quiz/${q.id}`}
                    className="block rounded-lg px-2 py-1.5 text-sm text-brand-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    📝 {q.title} ({q.question_count} Qs)
                  </Link>
                ))}
              </div>
            )}
          </Card>
        ))}
        <Card>
          <div className="mb-1 text-xs uppercase text-slate-400">Course progress</div>
          <ProgressBar percent={courseProgress.data ?? 0} />
          <p className="mt-1 text-xs text-slate-400">{Math.round(courseProgress.data ?? 0)}% complete</p>
        </Card>
      </aside>
    </div>
  );
}
