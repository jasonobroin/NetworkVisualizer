"""
Database engine and session factory.

The database path is read from the DATABASE_URL environment variable.
Default: /data/network.db (the Docker named volume path).
For local development without Docker, set DATABASE_URL=./local_network.db
"""

import logging
import os
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

logger = logging.getLogger(__name__)

_DEFAULT_DB_PATH = "/data/network.db"


def get_database_url() -> str:
    """Return the SQLite database URL, reading from DATABASE_URL env var."""
    db_path = os.environ.get("DATABASE_URL", _DEFAULT_DB_PATH)
    # If it looks like a raw file path rather than a URL, convert it
    if not db_path.startswith("sqlite"):
        db_path = f"sqlite:///{db_path}"
    return db_path


def _ensure_db_dir(url: str) -> None:
    """Create the parent directory for the SQLite file if it doesn't exist."""
    if url.startswith("sqlite:///"):
        path = Path(url.replace("sqlite:///", ""))
        path.parent.mkdir(parents=True, exist_ok=True)


DATABASE_URL = get_database_url()
_ensure_db_dir(DATABASE_URL)

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
    echo=False,
)

SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


def get_db():
    """
    FastAPI dependency that yields a database session.

    Usage:
        @app.get("/example")
        def route(db: Session = Depends(get_db)):
            ...
    """
    with SessionLocal() as session:
        yield session

