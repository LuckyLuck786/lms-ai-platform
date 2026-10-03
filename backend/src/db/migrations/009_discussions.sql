-- 009_discussions.sql — threads, posts, announcements, notifications (PRD §7.2)

CREATE TABLE IF NOT EXISTS discussion_threads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID REFERENCES courses(id),
    created_by UUID REFERENCES users(id),
    title VARCHAR(200),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS discussion_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id UUID REFERENCES discussion_threads(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    content TEXT,
    is_flagged BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID REFERENCES courses(id),
    posted_by UUID REFERENCES users(id),
    content TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    title VARCHAR(150),
    body TEXT,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_discussion_threads_course_id ON discussion_threads(course_id);
CREATE INDEX IF NOT EXISTS idx_discussion_posts_thread_id ON discussion_posts(thread_id);
CREATE INDEX IF NOT EXISTS idx_discussion_posts_user_id ON discussion_posts(user_id);
CREATE INDEX IF NOT EXISTS idx_announcements_course_id ON announcements(course_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
