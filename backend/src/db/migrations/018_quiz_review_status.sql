-- 018_quiz_review_status.sql — FR-A5 / FR-I4: AI-generated quizzes are drafts
-- for instructor review, and must not reach students until approved.
--
-- Manual quizzes are published on creation. Existing AI quizzes that learners
-- have already attempted stay published (hiding them would orphan the
-- attempts); untouched AI drafts become drafts.
ALTER TABLE quizzes
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'published'
  CHECK (status IN ('draft', 'published'));

UPDATE quizzes q SET status = 'draft'
WHERE q.is_ai_generated
  AND NOT EXISTS (SELECT 1 FROM quiz_attempts a WHERE a.quiz_id = q.id);

CREATE INDEX IF NOT EXISTS idx_quizzes_status ON quizzes(status);
