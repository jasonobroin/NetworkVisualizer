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
git clone https://github.com/jasonobroin/NetworkVisualizer.git
cd NetworkVisualizer
cp .env.example .env
```

Edit `.env` and add your Meraki API key:

```
MERAKI_API_KEY=your_actual_key_here
```

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

> Note: if your username or path contains special characters (e.g. a single quote),
> always quote the full path in shell commands:
> ```bash
> cd "/path/to/NetworkVisualizer"
> ```

```bash
# Ensure uv is installed — https://docs.astral.sh/uv/
uv sync
```

Start the server — note `DATABASE_URL` is required locally because `/data` only exists inside Docker:

```bash
DATABASE_URL="sqlite:///./local_network.db" uv run uvicorn src.api.main:app --port 8000 --reload
```

`--reload` causes the server to automatically restart whenever a Python source file changes,
so you never need to manually restart after editing code.

> **PyCharm users:** After running `uv sync`, configure the project interpreter to use
> `.venv/bin/python3.12` inside the project directory. Go to
> *Settings → Python Interpreter → Add → Existing Environment* and point it at
> `.venv/bin/python3.12`. This resolves all "Unresolved reference" warnings.

Or with a `.env` file — set:

```
MERAKI_API_KEY=your_key_here
DATABASE_URL=sqlite:///./local_network.db
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


