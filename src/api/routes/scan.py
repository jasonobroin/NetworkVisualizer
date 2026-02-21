"""
Scan routes — trigger Meraki network discovery.
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from src.api.schemas import ScanResponse
from src.db.database import get_db
from src.db.utils import seed_from_discovery
from src.discovery.meraki_client import MerakiDiscoveryClient

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/scan", response_model=ScanResponse, summary="Trigger a full Meraki network scan")
def trigger_scan(db: Session = Depends(get_db)) -> ScanResponse:
    """
    Trigger a full Meraki discovery scan.

    Fetches all organisations, networks, devices, switch ports, PoE status,
    and CDP/LLDP neighbour data from the Meraki Dashboard API, then upserts
    the results into the local database.

    Existing room assignments and manual annotations are preserved.
    """
    logger.info("Discovery scan triggered")
    try:
        client = MerakiDiscoveryClient()
    except EnvironmentError as exc:
        raise HTTPException(status_code=503, detail={"error": str(exc)})

    try:
        results = client.run_discovery()
    except Exception as exc:
        logger.exception("Discovery scan failed: %s", exc)
        raise HTTPException(status_code=502, detail={"error": f"Meraki API error: {exc}"})

    all_errors: list[str] = []
    for result in results:
        all_errors.extend(result.errors)

    summary = seed_from_discovery(results, db=db)

    return ScanResponse(
        devices_added=summary["devices_added"],
        devices_updated=summary["devices_updated"],
        ports_added=summary["ports_added"],
        links_added=summary["links_added"],
        errors=all_errors,
        scanned_at=datetime.now(timezone.utc).isoformat(),
    )

