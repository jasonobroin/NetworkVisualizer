# AGENTS.md — Agent Rules & Conventions

This file governs all AI agent behaviour for the NetworkVisualizer project.
Every agent working on this project **must** read and follow these rules before taking any action.

---

## 1. Path Handling

The project owner's username contains a single quote (`o'broin`), which **will break shell commands if not escaped properly**.

**Always escape paths in shell commands** using one of these forms:

```bash
# Correct — wrap in single quotes with escaped quote
cd '/Users/jason.o'\''broin/PycharmProjects/NetworkVisualizer'

# Correct — use double quotes
cd "/Users/jason.o'broin/PycharmProjects/NetworkVisualizer"
```

**Never** use unescaped single quotes in any shell command, script, Dockerfile, or Makefile.

---

## 2. API Key & Secret Safety

- **Never** read, print, log, echo, or include the contents of `.env` in any output, task result, or code comment.
- **Never** hardcode API keys, tokens, or passwords anywhere in source code.
- **Never** commit `.env` — it is protected by `.gitignore`.
- `.env.example` is the only secrets-related file that may be committed; it must contain only placeholder values.
- If an agent needs the API key, it must read it at runtime via environment variable (`os.environ["MERAKI_API_KEY"]`).

---

## 3. Filesystem Boundaries

- Agents **must only** read or write files within the project directory:
  `/Users/jason.o'broin/PycharmProjects/NetworkVisualizer/`
- **Never** write to, delete from, or modify any path outside this directory.
- **Never** run `rm -rf` on any path without explicit human confirmation.

---

## 4. Destructive Operations

- Database resets (`DELETE /db`, `reset_db()`) must only be run **inside the Docker container**.
- Any migration or schema-altering operation must be preceded by a comment in code explaining what it does.
- Always confirm before dropping tables or deleting data.

---

## 5. Docker & Environment

- The application runs in a **single Docker container** (`docker compose up`).
- The SQLite database is stored on a **named Docker volume** — never in the image itself.
- The `.env` file is injected at runtime via `docker-compose.yml` — never baked into the image.
- Agents should not assume any global Python environment; all dependencies are managed by `uv`.

---

## 6. Task File Format

All agent tasks live in `plan/tasks/`. Each file follows this format:

```markdown
# Task NN — <Short Title>

## Goal
One paragraph describing what this task achieves.

## Inputs
- List of files, data, or context the agent needs

## Expected Outputs
- List of files to create or modify

## Constraints
- Rules specific to this task (in addition to global AGENTS.md rules)

## Status
[ ] Not started / [ ] In progress / [x] Complete
```

Tasks are numbered sequentially: `01-scaffold.md`, `02-discovery.md`, etc.

---

## 7. Copilot Agent Workflow (PyCharm)

1. Open the GitHub Copilot panel in PyCharm and switch to **Agent mode**.
2. Open the relevant `plan/tasks/NN-<name>.md` file.
3. Paste the full contents of the task file as your prompt, prefixed with:
   > "Following the rules in plan/AGENTS.md and the relevant .github/instructions/ files, please complete the following task:"
4. Review all generated files before accepting.
5. Mark the task `[x] Complete` in the task file once accepted.
6. Update `plan/PLAN.md` status checklist.

---

## 8. Code Style

- Python: follow PEP 8; use type hints throughout.
- All functions must have docstrings.
- No commented-out dead code in committed files.
- Keep modules small and single-purpose.

