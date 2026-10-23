/**
 * Spaced repetition — the SM-2 algorithm (Wozniak, 1990), as used by Anki.
 *
 * Each card carries an ease factor (how easy the learner finds it), a
 * repetition count and the current interval. A correct answer stretches the
 * interval (1 day, then 6, then interval × ease); a miss resets the card to
 * be seen again within the session. Ease never drops below 1.3, so a hard
 * card still comes back, just more often.
 */

export type Rating = 'again' | 'hard' | 'good' | 'easy';

/** SM-2 quality grade (0–5) for each button. */
const QUALITY: Record<Rating, number> = { again: 1, hard: 3, good: 4, easy: 5 };

export interface CardState {
  repetitions: number;
  intervalDays: number;
  ease: number;
}

export interface Scheduled extends CardState {
  dueAt: Date;
}

/** A missed card returns this soon, inside the same study session. */
const RELEARN_MINUTES = 10;

export function schedule(state: CardState, rating: Rating, now = new Date()): Scheduled {
  const q = QUALITY[rating];
  const ease = Math.max(1.3, Number((state.ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))).toFixed(2)));

  if (q < 3) {
    return { repetitions: 0, intervalDays: 0, ease, dueAt: new Date(now.getTime() + RELEARN_MINUTES * 60_000) };
  }

  const repetitions = state.repetitions + 1;
  let intervalDays: number;
  if (repetitions === 1) intervalDays = 1;
  else if (repetitions === 2) intervalDays = 6;
  else intervalDays = Math.round(state.intervalDays * ease);
  // "Easy" earns a little extra distance, "hard" a little less (Anki-style).
  if (rating === 'easy') intervalDays = Math.round(intervalDays * 1.3);
  if (rating === 'hard') intervalDays = Math.max(1, Math.round(intervalDays * 0.8));

  return { repetitions, intervalDays, ease, dueAt: new Date(now.getTime() + intervalDays * 86_400_000) };
}

export const NEW_CARD: CardState = { repetitions: 0, intervalDays: 0, ease: 2.5 };
