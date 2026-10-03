from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .core.config import get_settings
from .routers import chat, flashcards, ingest, quiz_gen, recommendations, study_plan, summarize

settings = get_settings()

app = FastAPI(
    title="LMS-AI Tutor Service",
    version="0.1.0",
    description="RAG pipelines, embeddings, and Claude-powered tutoring (PRD §9.1).",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.cors_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat.router, prefix="/api/v1/ai/chat", tags=["ai-chat"])
app.include_router(summarize.router, prefix="/api/v1/ai", tags=["ai-summarize"])
app.include_router(quiz_gen.router, prefix="/api/v1/ai", tags=["ai-quiz-gen"])
app.include_router(flashcards.router, prefix="/api/v1/ai", tags=["ai-flashcards"])
app.include_router(study_plan.router, prefix="/api/v1/ai", tags=["ai-study-plan"])
app.include_router(ingest.router, prefix="/api/v1/ai/internal", tags=["ai-ingest"])
app.include_router(recommendations.router, prefix="/api/v1/ai", tags=["ai-recommendations"])


@app.get("/health", tags=["health"])
def health() -> dict:
    return {"status": "ok", "service": "ai-service"}
