-- 021_learning_features.sql — account recovery, Google sign-in, data rights,
-- spaced-repetition flashcards, quiz-mistake explanations, Socratic tutoring,
-- at-risk learner nudges and live classes.

-- Password reset reuses the hashed single-use token table (migration 020).
ALTER TABLE email_verifications DROP CONSTRAINT IF EXISTS email_verifications_purpose_check;
ALTER TABLE email_verifications ADD CONSTRAINT email_verifications_purpose_check
  CHECK (purpose IN ('verify', 'change', 'reset'));

-- Sign in with Google: Google's stable subject id, never the email, links the account.
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_key ON users (google_sub);
-- Self-service deletion pseudonymises the row (kept for payments and grades).
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Socratic tutoring is a style, independent of the explanation depth (mode).
ALTER TABLE ai_chat_sessions ADD COLUMN IF NOT EXISTS style VARCHAR(10) NOT NULL DEFAULT 'direct'
  CHECK (style IN ('direct', 'socratic'));

-- Spaced repetition (SM-2): one scheduling row per learner per card.
CREATE TABLE IF NOT EXISTS flashcard_reviews (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    flashcard_id UUID NOT NULL REFERENCES flashcards(id) ON DELETE CASCADE,
    repetitions INT NOT NULL DEFAULT 0,
    interval_days INT NOT NULL DEFAULT 0,
    ease NUMERIC(4, 2) NOT NULL DEFAULT 2.5,
    due_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_reviewed_at TIMESTAMPTZ,
    PRIMARY KEY (user_id, flashcard_id)
);
CREATE INDEX IF NOT EXISTS idx_flashcard_reviews_flashcard_id ON flashcard_reviews(flashcard_id);
CREATE INDEX IF NOT EXISTS idx_flashcard_reviews_due ON flashcard_reviews(user_id, due_at);

-- "Explain my mistake": cached so a re-read costs no LLM call.
CREATE TABLE IF NOT EXISTS quiz_explanations (
    attempt_id UUID NOT NULL REFERENCES quiz_attempts(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
    explanation TEXT NOT NULL,
    source_lecture_ids UUID[],
    created_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (attempt_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_quiz_explanations_question_id ON quiz_explanations(question_id);

-- At-risk learner nudges sent by instructors.
CREATE TABLE IF NOT EXISTS learner_nudges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sent_by UUID REFERENCES users(id) ON DELETE SET NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_learner_nudges_course_id ON learner_nudges(course_id);
CREATE INDEX IF NOT EXISTS idx_learner_nudges_user_id ON learner_nudges(user_id);
CREATE INDEX IF NOT EXISTS idx_learner_nudges_sent_by ON learner_nudges(sent_by);

-- Live classes (external meeting link) with attendance.
CREATE TABLE IF NOT EXISTS live_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL,
    duration_minutes INT NOT NULL CHECK (duration_minutes BETWEEN 5 AND 600),
    join_url TEXT NOT NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_live_sessions_course_id ON live_sessions(course_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_live_sessions_created_by ON live_sessions(created_by);

CREATE TABLE IF NOT EXISTS live_attendance (
    session_id UUID NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_live_attendance_user_id ON live_attendance(user_id);
