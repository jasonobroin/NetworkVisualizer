# Task 03 — SQLite Database Schema & Utilities

## Goal
Define the full SQLAlchemy ORM schema for the network topology database, and provide
utilities for resetting the database and seeding it from discovery data.

## Inputs
- `plan/AGENTS.md` — rules to follow
- `src/discovery/models.py` — Pydantic models from Task 02 (used as input to seed_from_discovery)
- SQLAlchemy (already in `pyproject.toml`)

## Expected Outputs
- `src/db/models.py` — SQLAlchemy ORM models
- `src/db/database.py` — engine setup, session factory, DB path from env/config
- `src/db/utils.py` — `reset_db()` and `seed_from_discovery()` functions

## Schema

### `rooms` table
| Column    | Type    | Notes                        |
|-----------|---------|------------------------------|
| id        | Integer | PK                           |
| name      | String  | e.g. "Living Room"           |
| notes     | String  | optional                     |

### `devices` table
| Column      | Type    | Notes                                              |
|-------------|---------|--------------------------------------------------  |
| id          | Integer | PK                                                 |
| serial      | String  | Meraki serial (null for unmanaged)                 |
| name        | String  | Display name (from Meraki or user-set)             |
| model       | String  | e.g. MS120-8FP                                     |
| device_type | String  | mx / ms / mr / router / other                      |
| is_managed  | Boolean | True if discovered via Meraki API                  |
| mac         | String  | MAC address                                        |
| ip          | String  | LAN IP                                             |
| port_count  | Integer | For unmanaged devices — user-supplied              |
| notes       | String  | Free text annotation                               |
| network_id  | String  | Meraki network ID                                  |

### `ports` table
| Column        | Type    | Notes                                        |
|---------------|---------|----------------------------------------------|
| id            | Integer | PK                                           |
| device_id     | Integer | FK → devices.id                              |
| port_id       | String  | Port number/name as string (e.g. "1", "SFP") |
| name          | String  | Port description/label                       |
| enabled       | Boolean |                                              |
| link_state    | String  | up / down / unknown                          |
| speed         | String  | e.g. "1 Gbps"                                |
| vlan          | Integer | Access VLAN                                  |
| poe_capable   | Boolean | Derived from switch model                    |
| poe_enabled   | Boolean | From port config                             |
| poe_active    | Boolean | From port status                             |
| poe_power_mw  | Float   | Power draw in milliwatts (if available)      |

### `links` table
| Column          | Type    | Notes                           |
|-----------------|---------|----------------------------------|
| id              | Integer | PK                               |
| src_device_id   | Integer | FK → devices.id                  |
| src_port_id     | Integer | FK → ports.id (nullable)         |
| dst_device_id   | Integer | FK → devices.id (nullable)       |
| dst_port_id     | Integer | FK → ports.id (nullable)         |
| link_type       | String  | cdp / lldp / manual / unknown   |
| notes           | String  |                                  |

### `device_rooms` table
| Column    | Type    | Notes              |
|-----------|---------|--------------------|
| id        | Integer | PK                 |
| device_id | Integer | FK → devices.id    |
| room_id   | Integer | FK → rooms.id      |

## Utility Functions

### `reset_db()`
- Drops all tables and recreates them (schema only, no data)
- Must print a warning log before executing
- Must only be callable from within the Docker container (check env var `RUNNING_IN_DOCKER=true`)

### `seed_from_discovery(discovery_result)`
- Takes the output of `meraki_client.run_discovery()` (list of Pydantic models)
- Upserts devices, ports, and links into the DB
- Does not delete existing rooms or device→room assignments (preserve user annotations)
- Returns a summary dict: `{devices_added, devices_updated, ports_added, links_added}`

## Constraints
- DB file path: read from env var `DATABASE_URL`, default `/data/network.db`
- All models must use SQLAlchemy 2.x declarative style
- All functions must have type hints and docstrings
- `reset_db()` must be protected — raise an error if `RUNNING_IN_DOCKER` env var is not `"true"`

## Status
[ ] Not started

