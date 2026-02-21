"""
NetworkVisualizer — FastAPI application entry point.

Serves the REST API under /api and static frontend files at /.
"""

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from src.db.utils import init_db
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

FRONTEND_DIR = Path(__file__).parent.parent.parent / "frontend"


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan — runs startup and shutdown logic."""
    logger.info("NetworkVisualizer starting up")
    init_db()
    yield
    logger.info("NetworkVisualizer shutting down")


app = FastAPI(
    title="NetworkVisualizer",
    description="Meraki home network topology visualizer",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", tags=["meta"])
async def health_check() -> dict:
    """Health check endpoint — returns OK if the server is running."""
    return {"status": "ok", "version": "0.1.0"}


# Mount static frontend files — must be last so API routes take priority
if FRONTEND_DIR.exists() and any(FRONTEND_DIR.iterdir()):
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
    logger.info("Frontend static files mounted from %s", FRONTEND_DIR)
else:
    logger.warning("Frontend directory empty or missing — UI not available yet")


@app.exception_handler(Exception)
async def global_exception_handler(request, exc: Exception) -> JSONResponse:
    """Return structured JSON for all unhandled exceptions."""
    logger.exception("Unhandled exception: %s", exc)
    return JSONResponse(status_code=500, content={"error": str(exc)})



