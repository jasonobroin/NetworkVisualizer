---
applyTo: "**"
---

# General Coding Instructions — NetworkVisualizer

These instructions apply to all files in this project.

## Path Handling
The project path may contain special characters (e.g. a single quote in a username).
**Always quote paths in shell commands** — double quotes are simplest:
```bash
cd "/path/to/NetworkVisualizer"
```
If using single quotes, a literal `'` must be escaped as `'\''`.
Never use an unquoted path in any shell command or script.

## Secrets & API Keys
- Never hardcode API keys, tokens, or passwords.
- Always read secrets from environment variables: `os.environ["MERAKI_API_KEY"]`
- Never log, print, or include `.env` contents in any output.
- `.env` is gitignored — never commit it.

## Package Management
- Use `uv` for all dependency management.
- Add dependencies via `uv add <package>`, not `pip install`.
- `pyproject.toml` is the single source of truth for dependencies.

## Python Style
- Python 3.12+
- PEP 8 formatting
- Type hints on all function signatures
- Docstrings on all public functions and classes
- No commented-out dead code in committed files

## Docker
- The app runs in a single Docker container.
- SQLite DB is at `/data/network.db` inside the container (named volume).
- `RUNNING_IN_DOCKER=true` environment variable is set inside the container.
- Never bake `.env` into the Docker image.

