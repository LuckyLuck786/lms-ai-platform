from typing import Optional

from fastapi import APIRouter, Header, HTTPException

from ..recommendation.engine import build_recommendations, recompute_all

router = APIRouter()
internal_router = APIRouter()


@router.get("/recommendations")
def recommendations(x_user_id: Optional[str] = Header(default=None)) -> dict:
    """GET /api/v1/ai/recommendations — personalized course suggestions (FR-S10)."""
    if not x_user_id:
        raise HTTPException(status_code=400, detail="X-User-Id header is required")
    return build_recommendations(x_user_id)


@internal_router.post("/recommendations/recompute")
def recompute() -> dict:
    """POST /api/v1/ai/internal/recommendations/recompute — nightly batch.

    Called by the backend's scheduled job; guarded by the internal token like
    every other /api/v1/ai route.
    """
    return recompute_all()
