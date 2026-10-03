from fastapi import APIRouter
from pydantic import BaseModel

from ..rag.ingest import ingest_lecture

router = APIRouter()


class IngestRequest(BaseModel):
    lecture_id: str


@router.post("/ingest")
def ingest(req: IngestRequest) -> dict:
    """POST /api/v1/ai/internal/ingest — chunk + embed a lecture transcript.

    Called by the Node backend whenever a lecture with a transcript is
    created (fire-and-forget) or manually for re-ingestion.
    """
    return ingest_lecture(req.lecture_id)
