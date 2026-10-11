-- 013_course_ratings.sql
-- Learner ratings (1-5) + optional review per course. Backs the catalog
-- rating filter and course-detail rating summary (FR-S3).
-- One rating per learner per course; re-rating updates the existing row.

CREATE TABLE IF NOT EXISTS course_ratings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (course_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_course_ratings_course ON course_ratings (course_id);
