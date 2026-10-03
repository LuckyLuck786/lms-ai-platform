-- 002_courses.sql — courses, modules, lectures (PRD §7.2)

CREATE TABLE IF NOT EXISTS courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instructor_id UUID REFERENCES users(id),
    title VARCHAR(200) NOT NULL,
    description TEXT,
    category VARCHAR(80),
    difficulty VARCHAR(20), -- beginner/intermediate/advanced
    thumbnail_url TEXT,
    price NUMERIC(10,2) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'pending', -- pending/approved/rejected/archived
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS modules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    order_index INT NOT NULL
);

CREATE TABLE IF NOT EXISTS lectures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    module_id UUID REFERENCES modules(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    video_url TEXT,
    transcript TEXT,
    duration_seconds INT,
    order_index INT NOT NULL,
    resource_urls TEXT[] -- PDFs, slides
);

-- Indexing strategy (PRD §7.3)
CREATE INDEX IF NOT EXISTS idx_courses_instructor_id ON courses(instructor_id);
CREATE INDEX IF NOT EXISTS idx_courses_category ON courses(category);
CREATE INDEX IF NOT EXISTS idx_courses_difficulty ON courses(difficulty);
CREATE INDEX IF NOT EXISTS idx_courses_status_pending ON courses(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_modules_course_id ON modules(course_id);
CREATE INDEX IF NOT EXISTS idx_lectures_module_id ON lectures(module_id);
