-- 012_topic_mastery.sql — per-topic mastery scores (FR-A8, PRD §7.2/§9.2 step 5)
--
-- One row per (user, module). "Topic" granularity is the course module: quiz
-- scores and lecture completion are both natural at module level, and the AI
-- tutor's difficulty adjustment acts on module-sized topics.

CREATE TABLE IF NOT EXISTS topic_mastery (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    module_id UUID NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
    -- 0-100 blend of quiz performance and lecture completion.
    mastery_score NUMERIC(5,2) NOT NULL DEFAULT 0,
    -- Component breakdown, kept for explainability in the UI.
    quiz_avg NUMERIC(5,2),
    completion_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
    attempts INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, module_id)
);

CREATE INDEX IF NOT EXISTS idx_topic_mastery_user_course
    ON topic_mastery (user_id, course_id);
CREATE INDEX IF NOT EXISTS idx_topic_mastery_course
    ON topic_mastery (course_id);
