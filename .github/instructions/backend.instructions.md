---
applyTo: "src/**"
---

# Backend Instructions — NetworkVisualizer

## Framework
- **FastAPI** with **SQLAlchemy 2.x** (declarative ORM style)
- **Pydantic v2** for all request/response schemas
- **SQLite** database at path from `DATABASE_URL` env var (default `/data/network.db`)

## FastAPI Conventions
- All route functions must have docstrings.
- Use FastAPI dependency injection for DB sessions:
  ```python
  def get_db():
      with SessionLocal() as session:
          yield session
  ```
- All error responses must be structured JSON: `{"error": "<message>"}`
- Enable CORS for all origins (development mode).
- API routes are prefixed with `/api/`.
- Static frontend files are served at `/` via `StaticFiles`.

## SQLAlchemy Conventions
- Use SQLAlchemy 2.x `DeclarativeBase` style:
  ```python
  from sqlalchemy.orm import DeclarativeBase
  class Base(DeclarativeBase):
      pass
  ```
- Always use `Session` context managers (`with SessionLocal() as session:`).
- Never use `session.execute(text(...))` for schema operations — use ORM.

## Pydantic Conventions
- Use `model_config = ConfigDict(from_attributes=True)` on all ORM-mapped schemas.
- Separate `Create`, `Update`, and `Read` schemas where appropriate.

## Meraki SDK
- Always initialise with `suppress_logging=True` to avoid SDK printing the API key.
- Read API key exclusively from `os.environ["MERAKI_API_KEY"]`.
- Use `meraki.DashboardAPI(api_key, suppress_logging=True)`.

## Logging
- Use Python `logging` module (not `print`).
- Log to stdout only.
- Never log the API key or any secret value.

