import { CourseDetail, Lecture, Quiz } from '../../utils/types';
import { DemoState, nextId } from './seed';

/**
 * Deterministic stand-ins for the Phase 3 AI endpoints.
 *
 * The real implementation calls Groq (falling back to Gemini) over transcripts
 * retrieved with pgvector. In demo mode there is no network and no vector
 * index, so this module reproduces the same *shapes* — including grounded
 * citations — by scoring the seeded transcripts with plain lexical overlap.
 * Every reply is prefixed so nobody mistakes it for live model output.
 */

export interface ChatSource {
  lecture_id: string;
  lecture_title: string | null;
  timestamp_seconds: number | null;
}

const STOP = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'of', 'to', 'in', 'on',
  'for', 'and', 'or', 'it', 'this', 'that', 'what', 'when', 'how', 'why', 'do', 'does',
  'did', 'should', 'would', 'could', 'can', 'i', 'you', 'my', 'me', 'we', 'with', 'as',
]);

const tokenise = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));

interface Chunk {
  lecture: Lecture;
  text: string;
  start: number;
}

function chunksOf(course: CourseDetail): Chunk[] {
  const out: Chunk[] = [];

  for (const mod of course.modules) {
    for (const lecture of mod.lectures) {
      const transcript = lecture.transcript ?? '';
      if (!transcript) continue;
      const sentences = transcript.match(/[^.]+\./g) ?? [transcript];
      // Estimate a timestamp from sentence position so citations look real.
      const perSentence = Math.floor((lecture.duration_seconds ?? 600) / sentences.length);
      sentences.forEach((sentence, i) => {
        const text = sentence.trim();
        if (text) out.push({ lecture, text, start: i * perSentence });
      });
    }
  }
  return out;
}

function overlapScore(chunk: Chunk, questionTokens: Set<string>): number {
  const tokens = tokenise(chunk.text);
  if (!tokens.length) return 0;
  let hits = 0;
  for (const t of tokens) if (questionTokens.has(t)) hits += 1;
  return hits / Math.sqrt(tokens.length);
}

function firstSentences(text: string, n: number): string {
  const sentences = text.match(/[^.]+\./g) ?? [];
  return sentences
    .slice(0, n)
    .map((s) => s.trim())
    .join(' ');
}

/** Lexical "RAG": pick the best-matching transcript chunks and cite them. */
export function tutorReply(
  course: CourseDetail,
  question: string,
  mode: string,
): { reply: string; sources: ChatSource[]; mode: string } {
  const tokens = new Set(tokenise(question));
  const chunks = chunksOf(course);
  const ranked = chunks
    .map((c) => ({ c, score: overlapScore(c, tokens) }))
    .sort((a, b) => b.score - a.score);
  const hits = ranked.filter((r) => r.score > 0.04).slice(0, 2);
  const best = hits.length ? hits : ranked.slice(0, 1);

  const sources: ChatSource[] = best.map(({ c }) => ({
    lecture_id: c.lecture.id,
    lecture_title: c.lecture.title,
    timestamp_seconds: c.start,
  }));

  const depth =
    mode === 'beginner'
      ? 'Here is the plain version:'
      : mode === 'advanced'
        ? 'Formally, and with the caveats:'
        : 'In short:';

  const quoted = best
    .map(({ c }) => `“${firstSentences(c.text, 1)}” — ${c.lecture.title}`)
    .join('\n\n');

  const keyTerms = [...tokens]
    .filter((t) => best.some(({ c }) => tokenise(c.text).includes(t)))
    .slice(0, 4);

  const body = [
    'Demo answer — no language model is being called in demo mode, so this is a lexical match over the course transcripts.',
    '',
    `${depth} the course material addresses ${keyTerms.length ? keyTerms.join(', ') : 'this topic'} like this:`,
    '',
    quoted,
    '',
    best[0]
      ? `Read it alongside the surrounding examples in ${course.title} rather than as an isolated rule.`
      : 'This course does not appear to cover that topic in its published transcripts.',
  ].join('\n');

  return { reply: body, sources, mode };
}

export function lectureSummary(lecture: Lecture): { summary: string; key_points: string[] } {
  const transcript = lecture.transcript ?? '';
  const sentences = (transcript.match(/[^.]+\./g) ?? []).map((s) => s.trim()).filter(Boolean);
  const summary = sentences.slice(0, 3).join(' ');

  const freq = new Map<string, number>();
  for (const word of tokenise(transcript)) freq.set(word, (freq.get(word) ?? 0) + 1);
  const keyPoints = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([word, count]) => `${word} (${count}×)`);

  return { summary, key_points: keyPoints };
}

export function moduleFlashcards(course: CourseDetail, moduleId: string) {
  const cards: { question: string; answer: string }[] = [];
  for (const mod of course.modules) {
    if (mod.id !== moduleId) continue;
    for (const lecture of mod.lectures) {
      const sentences = (lecture.transcript ?? '').match(/[^.]+\./g) ?? [];
      for (const sentence of sentences) {
        const text = sentence.trim();
        if (text.length < 60) continue;
        const [head, ...rest] = text.split(/,\s|\.\s|:\s|—\s/).filter(Boolean);
        if (!rest.length) continue;
        cards.push({
          question: `${head}. Expand on that — what follows and why does it matter?`,
          answer: rest.join(', ').replace(/\.$/, '') + '.',
        });
        if (cards.length >= 8) return { cards, module_title: mod.title };
      }
    }
  }
  return { cards, module_title: 'module' };
}

export function studyPlan(state: DemoState, userId: string | null) {
  const enrolled = state.enrollments.filter((e) => !userId || e.user_id === userId);
  const quizByCourse = new Map<string, string>();
  for (const quiz of state.quizzes) {
    const owner = state.courses.find((c) => c.modules.some((m) => m.id === quiz.module_id));
    if (owner) quizByCourse.set(owner.id, quiz.id);
  }

  const items = enrolled.map((e) => {
    const pct = Number(e.progress_percent);

    if (pct >= 100) {
      return {
        module_title: `${e.title} — review`,
        reason: 'Course complete; a spaced repetition pass consolidates the material.',
        priority: 'low',
      };
    }
    if (pct === 0) {
      return {
        module_title: `${e.title} — start`,
        reason: 'Not started yet. Book a 25-minute session today to build momentum.',
        priority: 'high',
      };
    }

    const quizId = quizByCourse.get(e.course_id);
    const weakest = quizId
      ? state.attempts
          .filter((a) => a.user_id === userId && a.quiz_id === quizId && a.score !== null)
          .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))[0]
      : undefined;

    return {
      module_title: `${e.title} — continue (${pct}% done)`,
      reason: weakest
        ? `Your last quiz here scored ${weakest.score}%. Revisit that module before moving on.`
        : `Pick up where you stopped at ${pct}% and finish the remaining lectures.`,
      priority: pct < 50 ? 'high' : 'medium',
    };
  });

  return {
    plan: {
      generated_at: new Date().toISOString(),
      items,
      disclaimer: 'Demo mode — generated locally, no language model was called.',
    },
  };
}

// ---------------------------------------------------------------------------
// topic mastery (FR-A8) — mirrors backend/src/utils/mastery.ts and
// ai-service/app/core/mastery.py so demo mode bands identically.
// ---------------------------------------------------------------------------

export type Depth = 'beginner' | 'intermediate' | 'advanced';

export interface MasteryRow {
  course_id: string;
  module_id: string;
  module_title: string;
  mastery_score: string;
  quiz_avg: string | null;
  completion_percent: string;
  attempts: number;
  updated_at: string;
  depth: Depth;
}

export function resolveDepth(mastery: number | null): Depth {
  if (mastery === null || Number.isNaN(mastery)) return 'intermediate';
  if (mastery < 55) return 'beginner';
  if (mastery < 80) return 'intermediate';
  return 'advanced';
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Per-module mastery rows for one learner + course (quiz avg 70% + completion 30%). */
export function topicMastery(state: DemoState, userId: string, courseId: string): MasteryRow[] {
  const course = state.courses.find((c) => c.id === courseId);
  if (!course) return [];

  return course.modules.map((mod) => {
    const quizIds = new Set(state.quizzes.filter((q) => q.module_id === mod.id).map((q) => q.id));
    const attempts = state.attempts.filter(
      (a) => a.user_id === userId && quizIds.has(a.quiz_id) && a.score !== null,
    );
    const quizAvg = attempts.length
      ? attempts.reduce((sum, a) => sum + (a.score ?? 0), 0) / attempts.length
      : null;

    const lectures = mod.lectures ?? [];
    const completed = lectures.filter((l) => state.progress[`${userId}:${l.id}`]?.completed).length;
    const completion = lectures.length ? (completed / lectures.length) * 100 : 0;

    const score =
      quizAvg !== null && attempts.length > 0
        ? quizAvg * 0.7 + completion * 0.3
        : completion * 0.3;
    const mastery = Math.min(100, Math.max(0, round2(score)));

    return {
      course_id: courseId,
      module_id: mod.id,
      module_title: mod.title,
      mastery_score: mastery.toFixed(2),
      quiz_avg: quizAvg === null ? null : round2(quizAvg).toFixed(2),
      completion_percent: round2(completion).toFixed(2),
      attempts: attempts.length,
      updated_at: new Date().toISOString(),
      depth: resolveDepth(mastery),
    };
  });
}

/** Mean mastery across rows (None-equivalent: null when there are no rows). */
export function averageMastery(rows: MasteryRow[]): number | null {
  if (!rows.length) return null;
  return round2(rows.reduce((sum, r) => sum + Number(r.mastery_score), 0) / rows.length);
}

/** Difficulty band for an auto-generated quiz: module row first, else course average. */
export function quizDifficulty(
  state: DemoState,
  userId: string,
  courseId: string,
  moduleId: string,
): Depth {
  const rows = topicMastery(state, userId, courseId);
  const moduleRow = rows.find((r) => r.module_id === moduleId);
  if (moduleRow) return resolveDepth(Number(moduleRow.mastery_score));
  const avg = averageMastery(rows);
  return avg === null ? 'intermediate' : resolveDepth(avg);
}

/** Creates a real draft quiz in the demo store so the refresh link has something to show. */
export function generateQuizDraft(
  state: DemoState,
  course: CourseDetail,
  lecture: Lecture,
): { quiz_id: string; question_count: number } {
  const sentences = (lecture.transcript ?? '').match(/[^.]+\./g) ?? [];
  const picked = sentences.map((s) => s.trim()).filter((s) => s.length > 60).slice(0, 3);

  const quiz: Quiz = {
    id: nextId('q'),
    module_id: lecture.module_id,
    title: `${lecture.title} — AI draft`,
    show_answers: true,
    questions: picked.map((sentence, i) => {
      const [head, ...rest] = sentence.split(/,\s|\.\s|:\s|—\s/).filter(Boolean);
      return {
        id: nextId('qq'),
        question_text: `Which statement best completes: “${head.trim()}…”`,
        question_type: 'mcq' as const,
        order_index: i,
        options: [
          { id: nextId('qo'), option_text: rest.join(', ').replace(/\.$/, '') + '.' },
          { id: nextId('qo'), option_text: 'It is unrelated to the rest of the lecture.' },
          { id: nextId('qo'), option_text: 'It contradicts the previous statement.' },
        ],
      };
    }),
  };

  if (!quiz.questions.length) {
    quiz.questions.push({
      id: nextId('qq'),
      question_text: `Summarise the main idea of “${lecture.title}”.`,
      question_type: 'short_answer',
      order_index: 0,
      options: [],
    });
  }

  for (const q of quiz.questions) state.answerKey[q.id] = q.options[0]?.id ? [q.options[0].id] : [];

  const module = course.modules.find((m) => m.id === lecture.module_id);
  if (module) {
    module.quizzes = [
      ...(module.quizzes ?? []),
      { id: quiz.id, module_id: module.id, title: quiz.title, question_count: quiz.questions.length },
    ];
  }
  state.quizzes.push(quiz);

  return { quiz_id: quiz.id, question_count: quiz.questions.length };
}