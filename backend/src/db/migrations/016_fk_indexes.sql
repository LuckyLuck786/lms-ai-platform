-- 016_fk_indexes.sql — PRD §7.3: B-tree indexes on all foreign keys.
-- These eleven were missed by earlier migrations (found by a pg_constraint
-- scan against production). Without them, deleting or joining through the
-- parent row scans the child table.

CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON user_roles(role_id);
CREATE INDEX IF NOT EXISTS idx_quizzes_generated_from_lecture_id ON quizzes(generated_from_lecture_id);
CREATE INDEX IF NOT EXISTS idx_quiz_answers_question_id ON quiz_answers(question_id);
CREATE INDEX IF NOT EXISTS idx_user_badges_badge_id ON user_badges(badge_id);
CREATE INDEX IF NOT EXISTS idx_study_plans_course_id ON study_plans(course_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_recommended_course_id ON recommendations(recommended_course_id);
CREATE INDEX IF NOT EXISTS idx_discussion_threads_created_by ON discussion_threads(created_by);
CREATE INDEX IF NOT EXISTS idx_announcements_posted_by ON announcements(posted_by);
CREATE INDEX IF NOT EXISTS idx_course_approvals_reviewed_by ON course_approvals(reviewed_by);
CREATE INDEX IF NOT EXISTS idx_topic_mastery_module_id ON topic_mastery(module_id);
CREATE INDEX IF NOT EXISTS idx_course_ratings_user_id ON course_ratings(user_id);
