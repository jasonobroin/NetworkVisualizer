# NetworkVisualizer

A web-based network topology visualizer for Meraki home networks.
Devices are discovered automatically via the Meraki Dashboard API, stored in a
local SQLite database, and displayed in an interactive graph using Cytoscape.js.
Rooms act as grouping containers. A manual **Rescan** button triggers fresh discovery.

---

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- A Meraki Dashboard API key with read access to your organisation
- _(Optional, for local development)_ [uv](https://docs.astral.sh/uv/) and Python 3.12

---

## Setup

```bash
git clone <your-repo-url>
cd NetworkVisualizer
cp .env.example .env
```

Edit `.env` and add your Meraki API key:

```
MERAKI_API_KEY=your_actual_key_here
```

> ⚠️ **Never commit `.env`** — it is protected by `.gitignore`.

---

## Run

```bash
docker compose up --build
```

Open [http://localhost:8000](http://localhost:8000) in your browser.

The SQLite database is stored on a named Docker volume (`network_db`) and persists
across container restarts.

---

## First Use

1. Click **Rescan Network** to trigger the initial Meraki discovery.
2. Devices appear in the graph under **Unassigned**.
3. Click a device to open the detail panel.
4. Use the **Room** dropdown to assign devices to rooms.
5. Click unknown/unmanaged devices to annotate them (name, type, port count, notes).

---

## Rescan

Click the **Rescan Network** button in the top toolbar at any time.
Existing room assignments and manual annotations are preserved — only device and
port data is refreshed from the Meraki API.

---

## Reset Database

Click **Reset Database** in the toolbar and confirm the prompt.
All data (devices, ports, links, rooms, assignments) will be deleted.
Re-run a scan to repopulate from Meraki.

> ⚠️ This is irreversible. Use with caution.

---

## Local Development (without Docker)

> Note: the path to this project contains a single quote in the username.
> Always quote the path in shell commands:
> ```bash
> cd "/Users/jason.o'broin/PycharmProjects/NetworkVisualizer"
> ```

```bash
# Ensure uv is installed — https://docs.astral.sh/uv/
uv sync
uv run uvicorn src.api.main:app --reload --port 8000
```

Set environment variables locally (or ensure `.env` is present):

```bash
export MERAKI_API_KEY=your_key_here
export DATABASE_URL=./local_network.db
```

---

## Project Structure

```
NetworkVisualizer/
├── src/
│   ├── api/          — FastAPI app and routes
│   ├── db/           — SQLAlchemy models and utilities
│   └── discovery/    — Meraki API client
├── frontend/         — HTML/JS/CSS (Cytoscape.js)
├── plan/             — Project plan, decisions, agent task files
│   ├── AGENTS.md     — Rules for AI agent development
│   ├── PLAN.md       — Feature checklist and status
│   ├── DECISIONS.md  — Architectural decision log
│   └── tasks/        — Numbered agent task files
├── .github/
│   └── instructions/ — Scoped GitHub Copilot instruction files
├── Dockerfile
├── docker-compose.yml
├── pyproject.toml    — uv-managed dependencies
└── .env.example      — Required environment variable template
```

---

## Agent-Assisted Development

This project uses **GitHub Copilot Agent mode** in PyCharm for AI-assisted development.

### How it works

1. Each feature is defined as a task file in `plan/tasks/NN-<name>.md`.
2. Open the GitHub Copilot panel in PyCharm and switch to **Agent mode**.
3. Paste the task file contents as the prompt, prefixed with:
   > _"Following the rules in plan/AGENTS.md and the relevant .github/instructions/ files, please complete the following task:"_
4. Review all generated files before accepting.
5. Mark the task `[x] Complete` in the task file.
6. Update `plan/PLAN.md` status.

### Key files for agents

| File | Purpose |
|---|---|
| `plan/AGENTS.md` | Global agent rules (path escaping, secret safety, filesystem boundaries) |
| `.github/instructions/general.instructions.md` | Applies to all files |
| `.github/instructions/backend.instructions.md` | FastAPI + SQLAlchemy conventions |
| `.github/instructions/frontend.instructions.md` | Cytoscape.js conventions |

---

## Future Development

- **Cisco Catalyst support** — SSH/NETCONF discovery for Catalyst switches
- **Drag-and-drop room layout** — reposition rooms on the graph manually
- **Continuous background polling** — optional periodic topology refresh
- **MCP server integration** — richer AI agent tooling via Model Context Protocol
- **Port utilisation history** — track port state changes over time
- **Export topology** — save graph as image or PDF
- **PoE budget visualisation** — show per-switch PoE budget and utilisation

---

## Tech Stack

| Concern | Choice |
|---|---|
| Language | Python 3.12 |
| Package management | `uv` |
| Backend | FastAPI |
| ORM / Database | SQLAlchemy 2.x + SQLite |
| Meraki API | `meraki` Python SDK |
| Frontend | HTML/JS + Cytoscape.js |
| Container | Single Docker container |

