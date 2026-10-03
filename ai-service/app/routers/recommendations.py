from typing import Optional

from fastapi import APIRouter, Header, HTTPException

from ..recommendation.engine import build_recommendations

router = APIRouter()


@router.get("/recommendations")
def recommendations(x_user_id: Optional[str] = Header(default=None)) -> dict:
    """GET /api/v1/ai/recommendations — personalized course suggestions (FR-S10)."""
    if not x_user_id:
        raise HTTPException(status_code=400, detail="X-User-Id header is required")
    return build_recommendations(x_user_id)
