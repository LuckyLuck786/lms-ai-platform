-- 011_badges_seed.sql — milestone badges (FR-S9)

INSERT INTO badges (name, description, icon_url) VALUES
    ('first_course_completed', 'Completed your first course end to end', NULL),
    ('seven_day_streak', 'Studied 7 days in a row', NULL),
    ('quiz_perfect_score', 'Scored 100% on a quiz', NULL)
ON CONFLICT DO NOTHING;
