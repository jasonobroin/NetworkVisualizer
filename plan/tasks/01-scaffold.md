# Task 01 — Project Scaffold

## Goal
Create the complete project skeleton for NetworkVisualizer. This includes the Python
package configuration (uv), Docker setup, directory structure, and a README.
After this task, `docker compose up --build` should start a running (empty) FastAPI server.

## Inputs
- `plan/AGENTS.md` — rules to follow
- `plan/DECISIONS.md` — rationale for stack choices
- `.env.example` — shows required environment variables

## Expected Outputs
- `pyproject.toml` — uv-managed, Python 3.12, dependencies: fastapi, uvicorn, sqlalchemy, meraki, python-dotenv
- `src/__init__.py`
- `src/discovery/__init__.py`
- `src/db/__init__.py`
- `src/api/__init__.py`
- `frontend/.gitkeep`
- `Dockerfile` — python:3.12-slim base, uv install, app runs on port 8000
- `docker-compose.yml` — named volume for SQLite, .env injected, port 8000 exposed
- `README.md` — see constraints below

## Constraints
- Use `uv` for all dependency management — no pip directly
- Dockerfile must use `python:3.12-slim`, install `uv`, run `uv sync`, then start with `uvicorn`
- SQLite DB file path must be `/data/network.db` inside the container (mounted volume)
- `.env` must NOT be copied into the Docker image; it is injected via docker-compose `env_file`
- All shell commands and scripts must escape paths containing single quotes (see AGENTS.md §1)
- FastAPI app entry point: `src/api/main.py` with a basic health check `GET /health`
- README.md must include: Prerequisites, Setup, Run, Rescan, Reset DB, and Future Development sections

## Status
[ ] Not started

