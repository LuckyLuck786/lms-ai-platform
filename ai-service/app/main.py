import hmac

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .core.config import get_settings
from .routers import (
    chat,
    flashcards,
    ingest,
    quiz_gen,
    recommendations,
    study_plan,
    summarize,
    transcribe,
)

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

@app.middleware("http")
async def require_internal_token(request: Request, call_next):
    """Reject unauthenticated calls to the AI API (service-to-service auth).

    The backend is the only intended caller, so it presents a shared secret in
    `X-Internal-Token`. Health and docs stay open for probes and humans; every
    /api/v1/ai route — chat, generation and the RAG ingest — requires the token
    whenever one is configured. Comparison is constant-time so the secret
    cannot be recovered a byte at a time.
    """
    expected = settings.internal_api_token
    if expected and request.url.path.startswith("/api/v1/ai"):
        provided = request.headers.get("x-internal-token", "")
        if not hmac.compare_digest(provided, expected):
            return JSONResponse(
                status_code=401,
                content={"detail": "Invalid or missing X-Internal-Token"},
            )
    return await call_next(request)


app.include_router(chat.router, prefix="/api/v1/ai/chat", tags=["ai-chat"])
app.include_router(summarize.router, prefix="/api/v1/ai", tags=["ai-summarize"])
app.include_router(quiz_gen.router, prefix="/api/v1/ai", tags=["ai-quiz-gen"])
app.include_router(flashcards.router, prefix="/api/v1/ai", tags=["ai-flashcards"])
app.include_router(study_plan.router, prefix="/api/v1/ai", tags=["ai-study-plan"])
app.include_router(ingest.router, prefix="/api/v1/ai/internal", tags=["ai-ingest"])
# Transcription is an internal job endpoint too: the backend worker calls it,
# and the internal-token guard covers it as part of /api/v1/ai.
app.include_router(transcribe.router, prefix="/api/v1/ai/internal", tags=["ai-transcription"])
app.include_router(recommendations.router, prefix="/api/v1/ai", tags=["ai-recommendations"])


@app.get("/health", tags=["health"])
def health() -> dict:
    return {"status": "ok", "service": "ai-service"}


@app.get("/", tags=["health"])
def root() -> dict:
    """Landing response — the API lives under /api/v1/ai; without this the
    root URL looks broken to anyone checking the service by hand."""
    return {
        "service": "ai-service",
        "status": "ok",
        "version": "0.1.0",
        "api": "/api/v1/ai",
        "docs": "/docs",
        "health": "/health",
    }
