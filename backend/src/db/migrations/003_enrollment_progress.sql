-- 003_enrollment_progress.sql — enrollment, progress, notes, bookmarks (PRD §7.2)

CREATE TABLE IF NOT EXISTS enrollments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    course_id UUID REFERENCES courses(id),
    enrolled_at TIMESTAMPTZ DEFAULT now(),
    progress_percent NUMERIC(5,2) DEFAULT 0,
    UNIQUE (user_id, course_id)
);

CREATE TABLE IF NOT EXISTS lecture_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enrollment_id UUID REFERENCES enrollments(id) ON DELETE CASCADE,
    lecture_id UUID REFERENCES lectures(id),
    watched_seconds INT DEFAULT 0,
    completed BOOLEAN DEFAULT FALSE,
    last_watched_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    lecture_id UUID REFERENCES lectures(id),
    timestamp_seconds INT,
    content TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bookmarks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    lecture_id UUID REFERENCES lectures(id),
    timestamp_seconds INT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_enrollments_user_id ON enrollments(user_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_course_id ON enrollments(course_id);
CREATE INDEX IF NOT EXISTS idx_lecture_progress_enrollment_id ON lecture_progress(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_lecture_progress_lecture_id ON lecture_progress(lecture_id);
CREATE INDEX IF NOT EXISTS idx_notes_user_id ON notes(user_id);
CREATE INDEX IF NOT EXISTS idx_notes_lecture_id ON notes(lecture_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_user_id ON bookmarks(user_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_lecture_id ON bookmarks(lecture_id);
