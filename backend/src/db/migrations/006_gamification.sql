-- 006_gamification.sql — certificates, badges, user_badges, streaks (PRD §7.2)

CREATE TABLE IF NOT EXISTS certificates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    course_id UUID REFERENCES courses(id),
    certificate_url TEXT,
    issued_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS badges (
    id SERIAL PRIMARY KEY,
    name VARCHAR(80),
    description TEXT,
    icon_url TEXT
);

CREATE TABLE IF NOT EXISTS user_badges (
    user_id UUID REFERENCES users(id),
    badge_id INT REFERENCES badges(id),
    earned_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (user_id, badge_id)
);

CREATE TABLE IF NOT EXISTS streaks (
    user_id UUID PRIMARY KEY REFERENCES users(id),
    current_streak INT DEFAULT 0,
    longest_streak INT DEFAULT 0,
    last_active_date DATE
);

CREATE INDEX IF NOT EXISTS idx_certificates_user_id ON certificates(user_id);
CREATE INDEX IF NOT EXISTS idx_certificates_course_id ON certificates(course_id);
