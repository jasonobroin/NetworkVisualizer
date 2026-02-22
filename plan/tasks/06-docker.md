# Task 06 — Docker Finalisation & README

## Goal
Finalise the Dockerfile and docker-compose.yml, verify the full stack builds and runs
end-to-end in Docker, and complete the README.md with full setup, usage, and development notes.

## Inputs
- `plan/AGENTS.md` — rules to follow
- All files from Tasks 01–05
- `Dockerfile` and `docker-compose.yml` from Task 01

## Expected Outputs
- `Dockerfile` — finalised, serving both API and static frontend
- `docker-compose.yml` — finalised with named volume, .env injection, port 8000
- `README.md` — complete (see sections below)
- `.dockerignore` — exclude .env, .venv, __pycache__, *.db, .git

## Dockerfile Requirements
```dockerfile
FROM python:3.12-slim
# Install uv
# Copy pyproject.toml and uv.lock
# Run uv sync (no dev deps)
# Copy src/ and frontend/
# Expose 8000
# CMD: uvicorn src.api.main:app --host 0.0.0.0 --port 8000
```
- FastAPI must serve `frontend/` as static files at `/` (root)
- The API routes are under `/api/`
- Do NOT copy .env into the image

## docker-compose.yml Requirements
```yaml
services:
  app:
    build: .
    ports:
      - "8000:8000"
    env_file:
      - .env
    environment:
      - RUNNING_IN_DOCKER=true
      - DATABASE_URL=/data/network.db
    volumes:
      - network_db:/data

volumes:
  network_db:
```

## README.md Sections

### 1. Overview
Brief description of what this project does.

### 2. Prerequisites
- Docker & Docker Compose
- Meraki Dashboard API key with read access
- (Optional) uv, Python 3.12 for local development

### 3. Setup
```bash
git clone <repo>
cd NetworkVisualizer
cp .env.example .env
# Edit .env and add your MERAKI_API_KEY
```

### 4. Run
```bash
docker compose up --build
# Open http://localhost:8000
```

### 5. First Use
- Click "Rescan Network" to trigger initial Meraki discovery
- Devices will appear in the graph under "Unassigned"
- Use the room dropdown in the detail panel to assign devices to rooms
- Click unknown devices to annotate them

### 6. Rescan
Click the "Rescan Network" button in the UI at any time. Existing room assignments
and manual annotations are preserved.

### 7. Reset Database
Click "Reset Database" and confirm. All data will be deleted. Re-run a scan to repopulate.

### 8. Local Development (without Docker)
```bash
# Install uv if not already installed
# Note: path may contain special characters — use quotes
uv sync
uv run uvicorn src.api.main:app --reload --port 8000
```

### 9. Future Development
- Cisco Catalyst support (SSH/NETCONF)
- Drag-and-drop room layout repositioning
- Continuous background topology polling
- MCP server integration for AI agent tooling
- Port utilisation history and change log
- Export topology as image or PDF

### 10. Agent Development Notes
This project uses GitHub Copilot Agent mode in PyCharm for AI-assisted development.
- Agent rules: `plan/AGENTS.md`
- Task files: `plan/tasks/NN-<name>.md`
- Copilot instructions: `.github/instructions/`
- To add a new feature: create a new task file following the template in AGENTS.md,
  then open it in PyCharm Copilot Agent mode and paste as the prompt.

## Constraints
- .env must NOT be in .dockerignore — it's already excluded by not being COPYed in Dockerfile
  (it is injected at runtime via env_file, not baked in)
- Verify `docker compose up --build` completes without error
- Verify `GET /health` returns 200 after container starts
- All paths in scripts/Makefile must be properly escaped (see AGENTS.md §1)

## Status
[x] Complete

