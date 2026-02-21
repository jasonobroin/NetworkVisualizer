# DECISIONS.md — Architectural Decision Log

Record of key decisions made during planning and development.
Add new entries at the top (most recent first).

---

## ADR-001 — Meraki-first discovery, Catalyst deferred

**Date:** 2026-02-21
**Decision:** Build Meraki API discovery first. Cisco Catalyst and other devices to be added in a future phase.
**Reason:** Owner's network is predominantly Meraki. Catalyst gear is limited and used for development only. Meraki SDK is well-documented and provides rich port/PoE/neighbour data. Keeping scope tight for v1.

---

## ADR-002 — SQLite over PostgreSQL

**Date:** 2026-02-21
**Decision:** Use SQLite (via SQLAlchemy) as the database.
**Reason:** Small scale (5–10 rooms, ~10–20 devices). Single Docker container. No concurrent write load. SQLite on a named volume is simple, portable, and zero-config. Can migrate to Postgres later if needed.

---

## ADR-003 — Single Docker container

**Date:** 2026-02-21
**Decision:** Run everything (FastAPI backend + SQLite + static frontend) in a single Docker container.
**Reason:** This is a home network tool, not a production service. Single container keeps setup simple. SQLite file lives on a named volume so data persists across container restarts.

---

## ADR-004 — FastAPI for backend

**Date:** 2026-02-21
**Decision:** Use FastAPI as the Python web framework.
**Reason:** Modern, async-capable, auto-generates OpenAPI docs, lightweight, integrates cleanly with SQLAlchemy and Pydantic. Good fit for a JSON API serving a JS frontend.

---

## ADR-005 — Cytoscape.js for frontend graph

**Date:** 2026-02-21
**Decision:** Use Cytoscape.js for the network graph UI.
**Reason:** Mature, well-documented graph library. Supports compound nodes (rooms containing devices), custom layouts, and click events for port detail panels. No framework overhead — plain HTML/JS.

---

## ADR-006 — uv for Python package management

**Date:** 2026-02-21
**Decision:** Use `uv` for dependency management and virtual environments.
**Reason:** Fast, modern, drop-in replacement for pip/venv. Works well with `pyproject.toml`. Simplifies Docker builds (single `uv sync` step).

---

## ADR-007 — Manual rescan, no continuous polling

**Date:** 2026-02-21
**Decision:** Network topology rescans are triggered manually via a UI button (`POST /scan`). No background polling.
**Reason:** Network topology changes are rare in a home environment. Continuous polling would add complexity and unnecessary Meraki API load. Manual trigger is sufficient and simpler.

---

## ADR-008 — Room assignment via dropdown (v1)

**Date:** 2026-02-21
**Decision:** Room assignment uses a dropdown selector in the UI for v1. Drag-and-drop deferred to a future phase.
**Reason:** Dropdown is simpler to implement and sufficient for a small number of rooms. Drag-and-drop is a UX improvement for a later pass.

---

## ADR-009 — Unmanaged device annotation

**Date:** 2026-02-21
**Decision:** Ports with unknown/unmanaged connected devices surface a "click to annotate" form allowing the user to set: name, type (router/switch/AP/other), port count, notes, MAC, IP.
**Reason:** The owner has misc cheap routers with no API access. Manual annotation allows them to appear correctly in the topology without auto-discovery.

---

## ADR-010 — .env never committed; .env.example committed

**Date:** 2026-02-21
**Decision:** `.env` is in `.gitignore` and must never be committed. `.env.example` with placeholder values is committed.
**Reason:** Security. The Meraki API key must not appear in version control.

