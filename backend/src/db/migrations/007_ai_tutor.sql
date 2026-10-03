-- 007_ai_tutor.sql — chat sessions/messages + pgvector document_chunks (PRD §7.2)

CREATE TABLE IF NOT EXISTS ai_chat_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    course_id UUID REFERENCES courses(id),
    mode VARCHAR(20) DEFAULT 'intermediate',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES ai_chat_sessions(id) ON DELETE CASCADE,
    sender VARCHAR(10), -- user/ai
    content TEXT,
    source_lecture_ids UUID[],
    created_at TIMESTAMPTZ DEFAULT now()
);

-- VECTOR STORE (pgvector)
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS document_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID REFERENCES courses(id),
    lecture_id UUID REFERENCES lectures(id),
    chunk_text TEXT,
    embedding VECTOR(1536),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding ON document_chunks USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_document_chunks_course_id ON document_chunks(course_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_lecture_id ON document_chunks(lecture_id);
CREATE INDEX IF NOT EXISTS idx_ai_chat_sessions_user_id ON ai_chat_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_chat_sessions_course_id ON ai_chat_sessions(course_id);
CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_session_id ON ai_chat_messages(session_id);
