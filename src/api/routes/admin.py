"""
Admin routes — database reset.
"""

import logging

from fastapi import APIRouter, HTTPException
from fastapi.requests import Request

from src.api.schemas import ResetResponse
from src.db.utils import reset_db

logger = logging.getLogger(__name__)
router = APIRouter()

_CONFIRM_HEADER = "X-Confirm-Reset"
_CONFIRM_VALUE = "yes-delete-everything"


@router.delete("/db", response_model=ResetResponse, summary="Reset the database")
def delete_database(request: Request) -> ResetResponse:
    """
    Drop and recreate all database tables, deleting ALL data.

    Requires the header:
        X-Confirm-Reset: yes-delete-everything

    Also requires the app to be running inside Docker
    (RUNNING_IN_DOCKER=true environment variable must be set).

    ⚠️ This is irreversible.
    """
    confirm = request.headers.get(_CONFIRM_HEADER, "")
    if confirm != _CONFIRM_VALUE:
        raise HTTPException(
            status_code=400,
            detail={
                "error": (
                    f"Missing or incorrect confirmation header. "
                    f"Send '{_CONFIRM_HEADER}: {_CONFIRM_VALUE}' to confirm."
                )
            },
        )

    try:
        reset_db()
    except RuntimeError as exc:
        raise HTTPException(status_code=403, detail={"error": str(exc)})
    except Exception as exc:
        logger.exception("Database reset failed: %s", exc)
        raise HTTPException(status_code=500, detail={"error": f"Reset failed: {exc}"})

    logger.warning("Database reset completed via API")
    return ResetResponse(reset=True)

