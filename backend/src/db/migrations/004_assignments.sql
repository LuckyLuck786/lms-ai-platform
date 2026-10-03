-- 004_assignments.sql — assignments, assignment_submissions (PRD §7.2)

CREATE TABLE IF NOT EXISTS assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID REFERENCES courses(id),
    title VARCHAR(200),
    instructions TEXT,
    rubric JSONB,
    due_date TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS assignment_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id UUID REFERENCES assignments(id),
    user_id UUID REFERENCES users(id),
    file_url TEXT,
    submitted_at TIMESTAMPTZ DEFAULT now(),
    grade NUMERIC(5,2),
    feedback TEXT
);

CREATE INDEX IF NOT EXISTS idx_assignments_course_id ON assignments(course_id);
CREATE INDEX IF NOT EXISTS idx_submissions_assignment_id ON assignment_submissions(assignment_id);
CREATE INDEX IF NOT EXISTS idx_submissions_user_id ON assignment_submissions(user_id);
