---
applyTo: "**"
---

# General Coding Instructions — NetworkVisualizer

These instructions apply to all files in this project.

## Path Handling
The project owner's username contains a single quote (`o'broin`).
**Always escape paths in shell commands:**
```bash
# Correct
cd '/Users/jason.o'\''broin/PycharmProjects/NetworkVisualizer'
# Also correct
cd "/Users/jason.o'broin/PycharmProjects/NetworkVisualizer"
```
Never use an unescaped single quote inside a single-quoted shell string.

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

